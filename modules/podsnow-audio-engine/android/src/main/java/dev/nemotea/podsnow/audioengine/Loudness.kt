package dev.nemotea.podsnow.audioengine

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.tan

/*
 * 書き出しのラウドネス処理（AUDIO_DESIGN.md §8.2）。
 * K 特性フィルタの式とトゥルーピーク補間フィルタの設計は libebur128 に合わせている
 * （https://github.com/jiixyj/libebur128 、MIT License, Copyright (c) 2011 Jan Kokemüller）。
 * エンコーダ（MediaCodec）に依存しないので JVM 上でも検証できる。
 */

/** 2 次 IIR（直接形 II 転置）。状態は Double で持つ。 */
class Biquad(private val b0: Double, private val b1: Double, private val b2: Double, private val a1: Double, private val a2: Double) {
  private var z1 = 0.0; private var z2 = 0.0
  fun process(x: Double): Double {
    val y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    return y
  }

  companion object {
    /** K 特性 stage 1（高域シェルフ）。48 kHz で BS.1770-4 Table 1 の係数と一致する。 */
    fun kShelf(fs: Int): Biquad {
      val f0 = 1681.974450955533; val g = 3.999843853973347; val q = 0.7071752369554196
      val k = tan(PI * f0 / fs); val vh = 10.0.pow(g / 20); val vb = vh.pow(0.4996667741545416)
      val a0 = 1 + k / q + k * k
      return Biquad(
        (vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0,
        2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0,
      )
    }

    /** K 特性 stage 2（RLB 高域通過）。48 kHz で BS.1770-4 Table 2 の係数と一致する（分子は 1, -2, 1）。 */
    fun kHighPass(fs: Int): Biquad {
      val f0 = 38.13547087602444; val q = 0.5003270373238773
      val k = tan(PI * f0 / fs)
      val a0 = 1 + k / q + k * k
      return Biquad(1.0, -2.0, 1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0)
    }
  }
}

/**
 * ITU-R BS.1770-4 の統合ラウドネス（K 特性 + 400 ms ブロック / 75% 重なり + -70 LUFS 絶対ゲート + -10 LU 相対ゲート）。
 * 入力はインターリーブ。L / R の重みは 1.0 で、各チャンネルの二乗平均を足す。
 */
class LoudnessMeter(sampleRate: Int, channels: Int = 1) {
  private val ch = maxOf(1, channels)
  private val shelf = Array(ch) { Biquad.kShelf(sampleRate) }
  private val hp = Array(ch) { Biquad.kHighPass(sampleRate) }
  private val blockLen = (sampleRate * 0.4).toInt()
  private val hop = blockLen / 4
  private val hopSums = DoubleArray(4)
  private var hopIdx = 0
  private var hopsDone = 0
  private var hopSum = 0.0
  private var inHop = 0
  private val blocks = ArrayList<Double>()

  /** buf[offset * ch] から count フレームを測る。 */
  fun process(buf: FloatArray, count: Int, offset: Int = 0) {
    for (i in offset until offset + count) {
      for (c in 0 until ch) {
        val y = hp[c].process(shelf[c].process(buf[i * ch + c].toDouble()))
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

  /** 統合ラウドネス（LUFS）。ゲートを通るブロックが無ければ -120。 */
  fun integrated(): Double {
    if (blocks.isEmpty()) return -120.0
    val absGate = 10.0.pow((-70.0 + 0.691) / 10)
    val pass1 = blocks.filter { it >= absGate }
    if (pass1.isEmpty()) return -120.0
    val relGate = pass1.average() * 10.0.pow(-10.0 / 10)
    val pass2 = pass1.filter { it >= relGate }
    if (pass2.isEmpty()) return -120.0
    return -0.691 + 10 * kotlin.math.log10(pass2.average())
  }
}

/**
 * 4 倍オーバーサンプリングのサンプル間ピーク推定（1 チャンネル分）。
 * 49 タップの Hann 窓 sinc を 4 相に分けた FIR（libebur128 と同じ設計）。
 * push(x) は x を含む直近 13 サンプルから補間した値の絶対値の最大（と |x|）を返す。
 * 補間値は |y| ≤ BOUND × 窓内の最大 |x| を超えないので、窓内のどのサンプルも
 * |x| × BOUND ≤ floor なら補間を省く（floor は呼び出しごとに同じか増えるだけ、の前提）。
 */
class TruePeakInterpolator {
  private val hist = FloatArray(TAPS_PER_PHASE * 2)
  private var pos = 0
  /** 最後に |x| × BOUND > floor だったサンプルからの経過数。 */
  private var sinceLoud = TAPS_PER_PHASE

  fun push(x: Float, floor: Float): Float {
    hist[pos] = x
    hist[pos + TAPS_PER_PHASE] = x
    val newest = pos + TAPS_PER_PHASE
    pos = if (pos + 1 == TAPS_PER_PHASE) 0 else pos + 1
    val ax = abs(x)
    if (ax * BOUND > floor) sinceLoud = 0 else if (sinceLoud < TAPS_PER_PHASE) sinceLoud++
    if (sinceLoud >= TAPS_PER_PHASE) return ax
    var peak = ax
    var k = 0
    for (f in 0 until FACTOR) {
      var acc = 0f
      for (t in 0 until TAPS_PER_PHASE) acc += COEF[k++] * hist[newest - t]
      val v = abs(acc)
      if (v > peak) peak = v
    }
    return peak
  }

  companion object {
    const val FACTOR = 4
    private const val TAPS = 49
    const val TAPS_PER_PHASE = (TAPS + FACTOR - 1) / FACTOR
    /** COEF[f * TAPS_PER_PHASE + t] = h[f + 4t]。出力 y[4n+f] = Σ_t h[f + 4t]·x[n−t]。 */
    private val COEF: FloatArray = FloatArray(FACTOR * TAPS_PER_PHASE) { i ->
      val j = i / TAPS_PER_PHASE + FACTOR * (i % TAPS_PER_PHASE)
      if (j >= TAPS) 0f else {
        val m = j - (TAPS - 1) / 2.0
        val s = if (m == 0.0) 1.0 else sin(m * PI / FACTOR) / (m * PI / FACTOR)
        (s * 0.5 * (1 - cos(2 * PI * j / (TAPS - 1)))).toFloat()
      }
    }
    private val BOUND: Float = (0 until FACTOR).maxOf { f ->
      (0 until TAPS_PER_PHASE).sumOf { t -> abs(COEF[f * TAPS_PER_PHASE + t]).toDouble() }
    }.toFloat()
  }
}

/** トゥルーピーク計（全チャンネルの最大、リニア値）。 */
class TruePeakMeter(channels: Int = 1) {
  private val ch = maxOf(1, channels)
  private val interp = Array(ch) { TruePeakInterpolator() }
  var peak = 0f
    private set

  /** buf[offset * ch] から count フレームを測る。 */
  fun process(buf: FloatArray, count: Int, offset: Int = 0) {
    for (i in offset until offset + count) {
      for (c in 0 until ch) {
        val v = interp[c].push(buf[i * ch + c], peak)
        if (v > peak) peak = v
      }
    }
  }
}

/**
 * 先読みトゥルーピークリミッター（AUDIO_DESIGN.md §8.2）。出力は latency フレーム遅れる。
 * 呼び出し側は latency 分を余計に流して先頭を捨てる。
 *
 * - ピークはサンプル間（4 倍補間）で検出し、天井より SAFETY_DB 低い値に収める
 *   （補間フィルタは 20 kHz 以上を少し低く見積もるため）。
 * - 必要ゲインを「補間の遅れ + 先読み」の区間で最小値ホールドし、先読み長の移動平均で滑らかにする。
 *   ゲインはピークの手前から直線的に下がり、ピークの時点で必要量に達する（瞬時に下げると
 *   波形に角ができ、それ自体がサンプル間ピークになる）。戻りは releaseMs の指数カーブ。
 * - ゲインは全チャンネル共通（リンク）にし、左右の定位を崩さない。
 * O(1) / フレーム（最小値は単調キュー、平均は累積和）。
 */
class Limiter(sampleRate: Int, ceilingDb: Double, channels: Int = 1, lookaheadMs: Double = 5.0, releaseMs: Double = 50.0) {
  private val ceiling = dbToLinear(ceilingDb)
  private val detectCeiling = dbToLinear(ceilingDb - SAFETY_DB)
  private val ch = maxOf(1, channels)
  private val avgLen = maxOf(1, (sampleRate * lookaheadMs / 1000).toInt())
  /** 補間の遅れ（TAPS_PER_PHASE / 2）とサンプル間の 1。 */
  private val detDelay = TruePeakInterpolator.TAPS_PER_PHASE / 2 + 1
  private val holdLen = avgLen + detDelay
  val latency = avgLen - 1 + detDelay
  private val release = exp(-1.0 / (sampleRate * releaseMs / 1000.0)).toFloat()
  private val interp = Array(ch) { TruePeakInterpolator() }
  // 入力の遅延線（latency フレーム。読んでから書くので遅れはちょうど latency）
  private val delayLine = FloatArray(latency * ch)
  private var delayPos = 0
  // 必要ゲインの最小値ホールド（単調キュー）
  private val qIdx = LongArray(holdLen + 1)
  private val qVal = FloatArray(holdLen + 1)
  private var qHead = 0
  private var qTail = 0
  // 移動平均
  private val avgRing = FloatArray(avgLen) { 1f }
  private var avgPos = 0
  private var avgSum = avgLen.toDouble()
  private var frame = 0L
  private var gain = 1f

  /** in-place。count はフレーム数。buf の各フレームには latency フレーム前の入力にゲインを掛けたものが入る。 */
  fun process(buf: FloatArray, count: Int) {
    val cap = qIdx.size
    for (i in 0 until count) {
      var det = 0f
      for (c in 0 until ch) {
        // 天井以下と分かる区間は補間を省く（ゲインの判定には天井を超えるかどうかだけが効く）
        val d = interp[c].push(buf[i * ch + c], detectCeiling)
        if (d > det) det = d
      }
      val req = if (det > detectCeiling) detectCeiling / det else 1f
      while (qTail != qHead && qVal[(qTail - 1 + cap) % cap] >= req) qTail = (qTail - 1 + cap) % cap
      qIdx[qTail] = frame; qVal[qTail] = req; qTail = (qTail + 1) % cap
      while (qIdx[qHead] <= frame - holdLen) qHead = (qHead + 1) % cap
      val held = qVal[qHead]
      avgSum += held - avgRing[avgPos]
      avgRing[avgPos] = held
      avgPos = (avgPos + 1) % avgLen
      val smooth = minOf(1f, (avgSum / avgLen).toFloat())
      gain = if (smooth < gain) smooth else gain * release + smooth * (1 - release)
      // 遅延線: latency フレーム前の入力を取り出して、今のフレームを入れる
      val base = delayPos * ch
      for (c in 0 until ch) {
        val x = buf[i * ch + c]
        buf[i * ch + c] = (delayLine[base + c] * gain).coerceIn(-ceiling, ceiling)
        delayLine[base + c] = x
      }
      delayPos = (delayPos + 1) % latency
      frame++
    }
  }

  companion object {
    /** 検出の安全余裕（dB）。4 倍補間の見積もり不足と、ゲイン変化による小さなはみ出しを吸収する。 */
    const val SAFETY_DB = 0.2
  }
}

/** 書き出したファイルそのものの測定値。 */
data class OutputMeasure(val lufs: Double, val truePeakDb: Double)

/**
 * 書き出しのラウドネス制御（AUDIO_DESIGN.md §8.2）。
 * 1. 入力を測り、目標との差をゲインにする（+20 dB まで）。
 * 2. ゲイン後にサンプル間ピークが天井を超えるなら、リミッター込みで出力を測り直し、
 *    割線法でゲインを合わせる（リミッターで削れた分の音量を取り戻す）。
 * 3. 本番のパスで、出力（書き出すサンプルそのもの）のラウドネスとトゥルーピークを測る。
 */
class LoudnessRenderer(
  private val doc: RenderDocument,
  private val mixer: Mixer,
  private val block: Int = 4096,
  private val isCancelled: () -> Boolean = { false },
  private val onProgress: (Double, String) -> Unit = { _, _ -> },
) {
  val channels = mixer.channels
  var inputLufs = -120.0
    private set
  var inputTruePeakDb = -120.0
    private set
  /** リミッター込みで出力を測り直した回数。 */
  var trials = 0
    private set

  /** 目標ラウドネスに合わせるゲイン（dB）。ラウドネス調整が無効なら 0。 */
  fun solveGain(): Double {
    if (!doc.loudnessEnabled) return 0.0
    val tpm = TruePeakMeter(channels)
    val input = pass(0.0, limiter = false, tpm = tpm, from = 0.0, to = MEASURE_END, phase = "measuring", write = null)
    inputLufs = input
    inputTruePeakDb = linearToDb(tpm.peak.toDouble())
    if (inputLufs <= -70) return 0.0
    var g = (doc.targetLufs - inputLufs).coerceIn(MIN_GAIN_DB, MAX_GAIN_DB)
    // リミッターが働かないなら、ゲインをそのまま掛けた出力は目標どおり（線形）
    if (inputTruePeakDb + g <= doc.truePeakDbtp) return g
    var prevG = Double.NaN
    var prevO = Double.NaN
    for (i in 0 until MAX_TRIALS) {
      val from = MEASURE_END + (TRIAL_END - MEASURE_END) * i / MAX_TRIALS
      val to = MEASURE_END + (TRIAL_END - MEASURE_END) * (i + 1) / MAX_TRIALS
      val o = pass(g, limiter = true, tpm = null, from = from, to = to, phase = "measuring", write = null)
      trials++
      val e = doc.targetLufs - o
      if (abs(e) < TOLERANCE_LU || (g >= MAX_GAIN_DB && e > 0)) break
      val slope = if (prevG.isNaN() || g == prevG) FIRST_SLOPE else ((o - prevO) / (g - prevG)).coerceIn(0.2, 1.0)
      prevG = g
      prevO = o
      g = (g + e / slope).coerceIn(MIN_GAIN_DB, MAX_GAIN_DB)
    }
    return g
  }

  /** 本番のパス。write(buf, offsetFrames, frames) に書き出すフレームを渡し、その測定値を返す。 */
  fun render(gainDb: Double, write: (FloatArray, Int, Int) -> Unit): OutputMeasure {
    val tpm = TruePeakMeter(channels)
    val from = when {
      !doc.loudnessEnabled -> 0.0
      trials > 0 -> TRIAL_END
      else -> MEASURE_END
    }
    val lufs = pass(gainDb, limiter = doc.loudnessEnabled, tpm = tpm, from = from, to = 1.0, phase = "encoding", write = write)
    return OutputMeasure(lufs, linearToDb(tpm.peak.toDouble()))
  }

  /** ミックス → ゲイン →（リミッター）を先頭から流し、出力のラウドネスを返す。 */
  private fun pass(
    gainDb: Double,
    limiter: Boolean,
    tpm: TruePeakMeter?,
    from: Double,
    to: Double,
    phase: String,
    write: ((FloatArray, Int, Int) -> Unit)?,
  ): Double {
    mixer.reset()
    val total = doc.totalFrames
    val ch = channels
    val gain = dbToLinear(gainDb)
    val lim = if (limiter) Limiter(doc.sampleRate, doc.truePeakDbtp, ch) else null
    val latency = lim?.latency ?: 0
    val meter = LoudnessMeter(doc.sampleRate, ch)
    val buf = FloatArray(block * ch)
    val renderEnd = total + latency
    var f = 0L
    var emitted = 0L
    var blocks = 0
    while (f < renderEnd) {
      if (isCancelled()) throw InterruptedException("cancelled")
      val n = minOf(block.toLong(), renderEnd - f).toInt()
      mixer.render(f, n, buf)
      if (gain != 1f) for (i in 0 until n * ch) buf[i] *= gain
      lim?.process(buf, n)
      // 先頭 latency フレームは遅延分なので捨て、total を超える分も捨てる
      var outStart = 0
      if (f < latency) outStart = minOf(n, (latency - f).toInt())
      var outCount = n - outStart
      if (emitted + outCount > total) outCount = (total - emitted).toInt()
      if (outCount > 0) {
        meter.process(buf, outCount, outStart)
        tpm?.process(buf, outCount, outStart)
        write?.invoke(buf, outStart, outCount)
        emitted += outCount
      }
      f += n
      if (++blocks % 50 == 0) onProgress(from + (to - from) * f / maxOf(1L, renderEnd), phase)
    }
    return meter.integrated()
  }

  companion object {
    const val MIN_GAIN_DB = -40.0
    const val MAX_GAIN_DB = 20.0
    const val MAX_TRIALS = 3
    const val TOLERANCE_LU = 0.1
    /** 初回の補正: リミッターがかかると 1 dB 上げても出力は 1 LU より少なくしか上がらない。 */
    const val FIRST_SLOPE = 0.7
    private const val MEASURE_END = 0.4
    private const val TRIAL_END = 0.6
  }
}
