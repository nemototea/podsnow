package dev.nemotea.podsnow.audioengine

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.exp

/** RenderDocument（domain/render/types.ts）の Kotlin 表現。 */
class RenderClip(
  val path: String,
  val fileStart: Long,
  val fileEnd: Long,
  val tlStart: Long,
  val tlEnd: Long,
  val gain: Float,
  val fadeIn: Long,
  val fadeOut: Long,
  val duck: Boolean,
  val loop: Boolean,
) {
  val fileLength: Long get() = fileEnd - fileStart
}

class RenderDocument(
  val sampleRate: Int,
  val channels: Int,
  val totalFrames: Long,
  val voice: List<RenderClip>,
  val overlays: List<RenderClip>,
  val duckEnabled: Boolean,
  val duckDepthDb: Double,
  val duckAttackMs: Double,
  val duckReleaseMs: Double,
  val duckThresholdDb: Double,
  val loudnessEnabled: Boolean,
  val targetLufs: Double,
  val truePeakDbtp: Double,
) {
  companion object {
    fun parse(json: String): RenderDocument {
      val o = JSONObject(json)
      fun clips(arr: JSONArray, overlay: Boolean): List<RenderClip> = (0 until arr.length()).map { i ->
        val c = arr.getJSONObject(i)
        val fs = c.getLong("fileStart"); val fe = c.getLong("fileEnd"); val ts = c.getLong("tlStart")
        RenderClip(
          path = c.getString("path"), fileStart = fs, fileEnd = fe, tlStart = ts,
          tlEnd = if (overlay) c.getLong("tlEnd") else ts + (fe - fs),
          gain = dbToLinear(c.optDouble("gainDb", 0.0)),
          fadeIn = c.optLong("fadeInFrames", 0), fadeOut = c.optLong("fadeOutFrames", 0),
          duck = overlay && c.optBoolean("duck", false), loop = overlay && c.optBoolean("loop", false),
        )
      }
      val d = o.optJSONObject("ducking") ?: JSONObject()
      val l = o.optJSONObject("loudness") ?: JSONObject()
      return RenderDocument(
        sampleRate = o.getInt("sampleRate"), channels = o.optInt("channels", 1), totalFrames = o.getLong("totalFrames"),
        voice = clips(o.getJSONArray("voice"), false), overlays = clips(o.getJSONArray("overlays"), true),
        duckEnabled = d.optBoolean("enabled", true), duckDepthDb = d.optDouble("depthDb", -10.0),
        duckAttackMs = d.optDouble("attackMs", 50.0), duckReleaseMs = d.optDouble("releaseMs", 500.0),
        duckThresholdDb = d.optDouble("thresholdDb", -40.0),
        loudnessEnabled = l.optBoolean("enabled", true), targetLufs = l.optDouble("targetLufs", -16.0),
        truePeakDbtp = l.optDouble("truePeakDbtp", -1.0),
      )
    }
  }
}

/**
 * ストリーミングミキサー。render(frame, count) を昇順に呼ぶとダッキングの状態が連続する。
 * シークしたら reset() を呼ぶ。出力は doc.channels チャンネルのインターリーブ Float32。
 * モノラル素材はステレオ出力で左右に複製し、ステレオ素材はモノラル出力で平均する
 * （ステレオ録音の左右は書き出しまで保つ）。
 */
class Mixer(private val doc: RenderDocument) : AutoCloseable {
  val channels = doc.channels.coerceIn(1, 2)
  private val readers = HashMap<String, WavReader>()
  private var duckGain = 1f
  private val attackCoef = coef(doc.duckAttackMs)
  private val releaseCoef = coef(doc.duckReleaseMs)
  private val duckFloor = dbToLinear(doc.duckDepthDb)
  private val threshold = dbToLinear(doc.duckThresholdDb)
  private var voiceEnv = 0f
  private val envCoef = coef(10.0)
  private var duckCurve = FloatArray(0)
  private var voiceBuf = FloatArray(0)
  private var tmp = FloatArray(0)

  private fun coef(ms: Double): Float = if (ms <= 0) 0f else exp(-1.0 / (doc.sampleRate * ms / 1000.0)).toFloat()

  private fun reader(path: String): WavReader = readers.getOrPut(path) { WavReader(path) }

  fun reset() { duckGain = 1f; voiceEnv = 0f }

  /** out[0, count * channels) にミックス結果（インターリーブ）を書く。 */
  fun render(frame: Long, count: Int, out: FloatArray) {
    val ch = channels
    val len = count * ch
    if (duckCurve.size < count) { duckCurve = FloatArray(count); voiceBuf = FloatArray(len); tmp = FloatArray(len) }
    java.util.Arrays.fill(voiceBuf, 0, len, 0f)
    for (c in doc.voice) mixClip(c, frame, count, voiceBuf)
    // 声のエンベロープからダッキングゲインを毎フレーム更新（左右どちらかで話していれば声あり）
    java.util.Arrays.fill(out, 0, len, 0f)
    val overlays = doc.overlays
    if (overlays.isNotEmpty()) {
      for (i in 0 until count) {
        var v = 0f
        for (k in 0 until ch) v = maxOf(v, absf(voiceBuf[i * ch + k]))
        voiceEnv = if (v > voiceEnv) v else voiceEnv * envCoef + v * (1 - envCoef)
        val target = if (doc.duckEnabled && voiceEnv > threshold) duckFloor else 1f
        duckGain = if (target < duckGain) duckGain * attackCoef + target * (1 - attackCoef)
        else duckGain * releaseCoef + target * (1 - releaseCoef)
        duckCurve[i] = duckGain
      }
      for (o in overlays) mixOverlay(o, frame, count, out)
    }
    for (i in 0 until len) out[i] += voiceBuf[i]
  }

  private fun mixClip(c: RenderClip, frame: Long, count: Int, out: FloatArray) {
    val start = maxOf(frame, c.tlStart)
    val end = minOf(frame + count, c.tlEnd)
    if (end <= start) return
    val n = (end - start).toInt()
    val ch = channels
    reader(c.path).read(c.fileStart + (start - c.tlStart), n, tmp, 0, ch)
    val oi = (start - frame).toInt()
    for (i in 0 until n) {
      val pos = start - c.tlStart + i
      val g = c.gain * fade(pos, c.fileLength, c.fadeIn, c.fadeOut)
      for (k in 0 until ch) out[(oi + i) * ch + k] += tmp[i * ch + k] * g
    }
  }

  private fun mixOverlay(c: RenderClip, frame: Long, count: Int, out: FloatArray) {
    val start = maxOf(frame, c.tlStart)
    val end = minOf(frame + count, c.tlEnd)
    if (end <= start || c.fileLength <= 0) return
    val n = (end - start).toInt()
    val ch = channels
    java.util.Arrays.fill(tmp, 0, n * ch, 0f)
    val total = c.tlEnd - c.tlStart
    val r = reader(c.path)
    // ループ再生: ファイル長で折り返す
    var i = 0
    while (i < n) {
      val pos = start - c.tlStart + i
      val srcPos = if (c.loop) pos % c.fileLength else pos
      if (srcPos >= c.fileLength) break
      val run = minOf((n - i).toLong(), c.fileLength - srcPos).toInt()
      r.read(c.fileStart + srcPos, run, tmp, i, ch)
      i += run
    }
    val oi = (start - frame).toInt()
    for (j in 0 until n) {
      val pos = start - c.tlStart + j
      val g = c.gain * fade(pos, total, c.fadeIn, c.fadeOut) * (if (c.duck) duckCurve[oi + j] else 1f)
      for (k in 0 until ch) out[(oi + j) * ch + k] += tmp[j * ch + k] * g
    }
  }

  private fun fade(pos: Long, length: Long, fadeIn: Long, fadeOut: Long): Float {
    var g = 1f
    if (fadeIn > 0 && pos < fadeIn) g *= pos.toFloat() / fadeIn
    if (fadeOut > 0 && length - pos <= fadeOut) g *= ((length - pos).toFloat() / fadeOut).coerceIn(0f, 1f)
    return g
  }

  override fun close() { readers.values.forEach { it.close() }; readers.clear() }
}
