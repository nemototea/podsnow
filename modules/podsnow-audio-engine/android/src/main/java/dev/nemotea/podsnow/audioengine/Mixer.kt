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
  /**
   * 求めてあるゲイン（`loudness.gainDb`、AUDIO_DESIGN.md §8.4）。null なら未測定。
   * 書き出しはこれがあれば測定を飛ばす。試聴はこれで鳴らす（無ければ調整なし）。
   */
  val gainDb: Double? = null,
) {
  /** 音の仕上げ（ダッキング・ラウドネス）だけ。試聴で読み直さずに差し替える単位（§7.1）。 */
  val sound: TimelineSound get() = TimelineSound(
    duckEnabled, duckDepthDb, duckAttackMs, duckReleaseMs, duckThresholdDb, loudnessEnabled, truePeakDbtp, gainDb,
  )

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
        gainDb = if (l.has("gainDb") && !l.isNull("gainDb")) l.getDouble("gainDb") else null,
      )
    }
  }
}

/** 試聴の音の仕上げ（AUDIO_DESIGN.md §7.1）。`updateTimelineSound` の JSON は RenderDocument の ducking / loudness と同じ形。 */
data class TimelineSound(
  val duckEnabled: Boolean,
  val duckDepthDb: Double,
  val duckAttackMs: Double,
  val duckReleaseMs: Double,
  val duckThresholdDb: Double,
  val loudnessEnabled: Boolean,
  val truePeakDbtp: Double,
  /** 求めてあるゲイン。null なら未測定で、調整なし（ゲイン 0 dB・リミッター素通し）で鳴らす。 */
  val gainDb: Double?,
) {
  /** 試聴でかけるゲイン（dB）。書き出しの LoudnessRenderer と同じ条件。 */
  val previewGainDb: Double get() = if (loudnessEnabled && gainDb != null) gainDb else 0.0
  /** 試聴のリミッターの天井。null なら素通し。 */
  val previewCeilingDb: Double? get() = if (loudnessEnabled && gainDb != null) truePeakDbtp else null

  companion object {
    fun parse(json: String): TimelineSound {
      val o = JSONObject(json)
      val d = o.optJSONObject("ducking") ?: JSONObject()
      val l = o.optJSONObject("loudness") ?: JSONObject()
      return TimelineSound(
        duckEnabled = d.optBoolean("enabled", true), duckDepthDb = d.optDouble("depthDb", -10.0),
        duckAttackMs = d.optDouble("attackMs", 50.0), duckReleaseMs = d.optDouble("releaseMs", 500.0),
        duckThresholdDb = d.optDouble("thresholdDb", -40.0),
        loudnessEnabled = l.optBoolean("enabled", true), truePeakDbtp = l.optDouble("truePeakDbtp", -1.0),
        gainDb = if (l.has("gainDb") && !l.isNull("gainDb")) l.getDouble("gainDb") else null,
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
  /** ダッキングの係数。試聴では updateSound で差し替える（ブロックの境目で反映）。 */
  private class Duck(sampleRate: Int, s: TimelineSound) {
    private fun coef(ms: Double, fs: Int): Float = if (ms <= 0) 0f else exp(-1.0 / (fs * ms / 1000.0)).toFloat()
    val enabled = s.duckEnabled
    val attackCoef = coef(s.duckAttackMs, sampleRate)
    val releaseCoef = coef(s.duckReleaseMs, sampleRate)
    val floor = dbToLinear(s.duckDepthDb)
    val threshold = dbToLinear(s.duckThresholdDb)
  }
  private var duck = Duck(doc.sampleRate, doc.sound)
  private var voiceEnv = 0f
  private val envCoef = exp(-1.0 / (doc.sampleRate * 10.0 / 1000.0)).toFloat()
  private var duckCurve = FloatArray(0)
  private var voiceBuf = FloatArray(0)
  private var tmp = FloatArray(0)
  /** 試聴の仕上げ（ゲイン → リミッター）。null なら書き出し用で、ミックスだけを返す。 */
  private var preview: Preview? = null
  /** 別のスレッド（JS）から来た音の仕上げ。再生スレッドが次のブロックの頭で取り込む。 */
  private val pendingSound = java.util.concurrent.atomic.AtomicReference<TimelineSound?>(null)

  private fun reader(path: String): WavReader = readers.getOrPut(path) { WavReader(path) }

  fun reset() {
    duckGain = 1f; voiceEnv = 0f
    preview?.primed = false
  }

  /**
   * 試聴として使う（AUDIO_DESIGN.md §7.1）。ミックスのあとに、書き出しと同じゲイン → トゥルーピークリミッターをかける。
   * リミッターの先読みの分だけ先をミックスし、render(frame) の音を frame の位置に揃える。書き出しでは呼ばない。
   */
  fun enablePreview() {
    if (preview == null) preview = Preview(doc.sound)
  }

  /** 音の仕上げを差し替える（どのスレッドからでもよい）。読み直さないので再生は止まらない。 */
  fun updateSound(s: TimelineSound) { pendingSound.set(s) }

  private inner class Preview(s: TimelineSound) {
    val limiter = Limiter(doc.sampleRate, s.truePeakDbtp, channels).also { it.setCeiling(s.previewCeilingDb) }
    val latency = limiter.latency
    var gain = dbToLinear(s.previewGainDb)
    var target = gain
    var step = 0f
    var primed = false
    var next = 0L
    var scratch = FloatArray(0)

    fun apply(s: TimelineSound) {
      limiter.setCeiling(s.previewCeilingDb)
      target = dbToLinear(s.previewGainDb)
      if (!primed) { gain = target; step = 0f } else step = (target - gain) / (doc.sampleRate * RAMP_SECONDS)
    }

    /** ゲインを掛ける。差し替えのあとは RAMP_SECONDS かけて直線で移す（急に変えるとプツッと鳴る）。 */
    fun applyGain(buf: FloatArray, count: Int) {
      val ch = channels
      for (i in 0 until count) {
        if (step != 0f) {
          gain += step
          if ((step > 0 && gain >= target) || (step < 0 && gain <= target)) { gain = target; step = 0f }
        }
        if (gain != 1f) for (c in 0 until ch) buf[i * ch + c] *= gain
      }
    }
  }

  /**
   * out[0, count * channels) に frame からの音（インターリーブ）を書く。
   * 書き出しではミックスだけ。試聴（enablePreview）では、ゲインとリミッターをかけた音。
   */
  fun render(frame: Long, count: Int, out: FloatArray) {
    pendingSound.getAndSet(null)?.let { s ->
      duck = Duck(doc.sampleRate, s)
      preview?.apply(s)
    }
    val p = preview ?: return mix(frame, count, out)
    if (!p.primed || frame != p.next) {
      // シーク・reset のあと: リミッターを作りたてに戻し、先読みの分を流して満たす（出力は捨てる）。
      // 先頭から鳴らすと、書き出しの本番のパスと同じサンプルになる
      p.limiter.reset()
      if (p.scratch.size < p.latency * channels) p.scratch = FloatArray(p.latency * channels)
      mix(frame, p.latency, p.scratch)
      p.applyGain(p.scratch, p.latency)
      p.limiter.process(p.scratch, p.latency)
      p.primed = true
    }
    // リミッターは latency 遅れるので、その分だけ先をミックスする
    mix(frame + p.latency, count, out)
    p.applyGain(out, count)
    p.limiter.process(out, count)
    p.next = frame + count
  }

  /** out[0, count * channels) にミックス結果（インターリーブ）を書く。 */
  private fun mix(frame: Long, count: Int, out: FloatArray) {
    val ch = channels
    val duck = duck
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
        val target = if (duck.enabled && voiceEnv > duck.threshold) duck.floor else 1f
        duckGain = if (target < duckGain) duckGain * duck.attackCoef + target * (1 - duck.attackCoef)
        else duckGain * duck.releaseCoef + target * (1 - duck.releaseCoef)
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

  companion object {
    /** 試聴のゲインの差し替えにかける時間。 */
    const val RAMP_SECONDS = 0.05f
  }
}
