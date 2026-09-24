package dev.nemotea.podsnow.audioengine

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.exp
import kotlin.math.sqrt

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

/**
 * ITU-R BS.1770-4 の統合ラウドネス（K 特性 + ゲーティング）。
 * 入力はインターリーブ。L / R の重みは 1.0 で、各チャンネルの二乗和を足す（BS.1770-4 §2.4）。
 */
class LoudnessMeter(sampleRate: Int, channels: Int = 1) {
  private val ch = maxOf(1, channels)
  // K-weighting: pre-filter (high shelf) + RLB (high pass)。係数は 48 kHz 用を周波数に合わせて再計算する。
  private val shelf = Array(ch) { Biquad.highShelf(sampleRate, 1681.974450955533, 3.999843853973347, 0.7071752369554196) }
  private val hp = Array(ch) { Biquad.highPass(sampleRate, 38.13547087602444, 0.5003270373238773) }
  private val blockLen = (sampleRate * 0.4).toInt()
  private val hop = blockLen / 4
  private val hopSums = DoubleArray(4)
  private var hopIdx = 0
  private var hopsDone = 0
  private var hopSum = 0.0
  private var inHop = 0
  private val blocks = ArrayList<Double>()

  /** count はフレーム数。 */
  fun process(buf: FloatArray, count: Int) {
    for (i in 0 until count) {
      for (c in 0 until ch) {
        val y = hp[c].process(shelf[c].process(buf[i * ch + c])).toDouble()
        hopSum += y * y
      }
      inHop++
      if (inHop == hop) {
        hopSums[hopIdx] = hopSum
        hopIdx = (hopIdx + 1) % 4
        hopsDone++
        hopSum = 0.0
        inHop = 0
        if (hopsDone >= 4) blocks.add((hopSums[0] + hopSums[1] + hopSums[2] + hopSums[3]) / blockLen)
      }
    }
  }

  /** 統合ラウドネス（LUFS）。ブロックが無ければ -inf 相当として -120。 */
  fun integrated(): Double {
    if (blocks.isEmpty()) return -120.0
    val absGate = Math.pow(10.0, (-70.0 + 0.691) / 10)
    val pass1 = blocks.filter { it >= absGate }
    if (pass1.isEmpty()) return -120.0
    val mean1 = pass1.average()
    val relGate = mean1 * Math.pow(10.0, -10.0 / 10)
    val pass2 = pass1.filter { it >= relGate }
    if (pass2.isEmpty()) return -120.0
    return -0.691 + 10 * Math.log10(pass2.average())
  }
}

class Biquad(private val b0: Double, private val b1: Double, private val b2: Double, private val a1: Double, private val a2: Double) {
  private var z1 = 0.0; private var z2 = 0.0
  fun process(x: Float): Float {
    val y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    return y.toFloat()
  }
  companion object {
    fun highShelf(fs: Int, f0: Double, gainDb: Double, q: Double): Biquad {
      val a = Math.pow(10.0, gainDb / 40); val w0 = 2 * Math.PI * f0 / fs
      val cw = Math.cos(w0); val sw = Math.sin(w0); val alpha = sw / (2 * q)
      val b0 = a * ((a + 1) + (a - 1) * cw + 2 * Math.sqrt(a) * alpha)
      val b1 = -2 * a * ((a - 1) + (a + 1) * cw)
      val b2 = a * ((a + 1) + (a - 1) * cw - 2 * Math.sqrt(a) * alpha)
      val a0 = (a + 1) - (a - 1) * cw + 2 * Math.sqrt(a) * alpha
      val a1 = 2 * ((a - 1) - (a + 1) * cw)
      val a2 = (a + 1) - (a - 1) * cw - 2 * Math.sqrt(a) * alpha
      return Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }
    fun highPass(fs: Int, f0: Double, q: Double): Biquad {
      val w0 = 2 * Math.PI * f0 / fs; val cw = Math.cos(w0); val sw = Math.sin(w0); val alpha = sw / (2 * q)
      val b0 = (1 + cw) / 2; val b1 = -(1 + cw); val b2 = (1 + cw) / 2
      val a0 = 1 + alpha; val a1 = -2 * cw; val a2 = 1 - alpha
      return Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }
  }
}

/** 4 倍オーバーサンプリングの簡易トゥルーピーク計（線形補間ではなく 4 相の窓付き sinc）。全チャンネルの最大値。【仮説】 */
class TruePeakMeter(channels: Int = 1) {
  private val taps = 4
  private val ch = maxOf(1, channels)
  private val phases = Array(4) { p -> DoubleArray(taps * 2) { k -> sinc(k - taps + 1 - p / 4.0) * hann(k, taps * 2) } }
  private val hist = Array(ch) { FloatArray(taps * 2) }
  var peak = 0f
    private set
  private fun sinc(x: Double) = if (x == 0.0) 1.0 else Math.sin(Math.PI * x) / (Math.PI * x)
  private fun hann(k: Int, n: Int) = 0.5 - 0.5 * Math.cos(2 * Math.PI * (k + 0.5) / n)

  /** 入力はインターリーブ。count はフレーム数。 */
  fun process(buf: FloatArray, count: Int) {
    for (i in 0 until count) {
      for (c in 0 until ch) {
        val hc = hist[c]
        System.arraycopy(hc, 1, hc, 0, hc.size - 1)
        hc[hc.size - 1] = buf[i * ch + c]
        for (p in 0 until 4) {
          var acc = 0.0
          val h = phases[p]
          for (k in hc.indices) acc += hc[k] * h[k]
          val v = absf(acc.toFloat())
          if (v > peak) peak = v
        }
      }
    }
  }
}

/**
 * 先読みピークリミッター（AUDIO_DESIGN.md §8）。ブロック単位の先読みで O(n)。
 * 出力は latency フレーム遅れる。呼び出し側は latency 分を余計に流して先頭を捨てる。
 * 入力はインターリーブ。ゲインは全チャンネル共通（リンク）にし、左右の定位を崩さない。
 */
class Limiter(sampleRate: Int, ceilingDb: Double, channels: Int = 1, lookaheadMs: Double = 5.0, releaseMs: Double = 50.0) {
  private val ceiling = dbToLinear(ceilingDb)
  private val ch = maxOf(1, channels)
  val latency = maxOf(1, (sampleRate * lookaheadMs / 1000).toInt())
  private val release = exp(-1.0 / (sampleRate * releaseMs / 1000.0)).toFloat()
  private val prev = FloatArray(latency * ch)
  private var prevMax = 0f
  private val cur = FloatArray(latency * ch)
  private var curLen = 0
  private var curMax = 0f
  private var gain = 1f

  /** in-place。count はフレーム数。buf の各フレームには latency フレーム前の入力にゲインを掛けたものが入る。 */
  fun process(buf: FloatArray, count: Int) {
    for (i in 0 until count) {
      for (c in 0 until ch) {
        val x = buf[i * ch + c]
        val ax = absf(x)
        if (ax > curMax) curMax = ax
        cur[curLen * ch + c] = x
      }
      curLen++
      // 出力: prev ブロックの同じ位置のフレーム。目標ゲインは prev と cur（先読み）の最大値から。
      val mx = if (prevMax > curMax) prevMax else curMax
      val target = if (mx > ceiling) ceiling / mx else 1f
      gain = if (target < gain) target else gain * release + target * (1 - release)
      for (c in 0 until ch) buf[i * ch + c] = (prev[(curLen - 1) * ch + c] * gain).coerceIn(-ceiling, ceiling)
      if (curLen == latency) {
        System.arraycopy(cur, 0, prev, 0, latency * ch)
        prevMax = curMax
        curLen = 0
        curMax = 0f
      }
    }
  }
}
