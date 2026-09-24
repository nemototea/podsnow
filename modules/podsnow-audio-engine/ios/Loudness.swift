import Foundation

// 書き出しのラウドネス処理（AUDIO_DESIGN.md §8.2）。Android の Loudness.kt と同じ手順・同じ定数。
// K 特性フィルタの式とトゥルーピーク補間フィルタの設計は libebur128 に合わせている
// （https://github.com/jiixyj/libebur128 、MIT License, Copyright (c) 2011 Jan Kokemüller）。

/// 2 次 IIR（直接形 II 転置）。
struct Biquad {
  let b0, b1, b2, a1, a2: Double
  var z1 = 0.0, z2 = 0.0
  mutating func process(_ x: Double) -> Double {
    let y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    return y
  }

  /// K 特性 stage 1（高域シェルフ）。48 kHz で BS.1770-4 Table 1 の係数と一致する。
  static func kShelf(fs: Int) -> Biquad {
    let f0 = 1681.974450955533, g = 3.999843853973347, q = 0.7071752369554196
    let k = tan(Double.pi * f0 / Double(fs)), vh = pow(10.0, g / 20), vb = pow(vh, 0.4996667741545416)
    let a0 = 1 + k / q + k * k
    return Biquad(b0: (vh + vb * k / q + k * k) / a0, b1: 2 * (k * k - vh) / a0, b2: (vh - vb * k / q + k * k) / a0,
                  a1: 2 * (k * k - 1) / a0, a2: (1 - k / q + k * k) / a0)
  }

  /// K 特性 stage 2（RLB 高域通過）。48 kHz で BS.1770-4 Table 2 の係数と一致する（分子は 1, -2, 1）。
  static func kHighPass(fs: Int) -> Biquad {
    let f0 = 38.13547087602444, q = 0.5003270373238773
    let k = tan(Double.pi * f0 / Double(fs))
    let a0 = 1 + k / q + k * k
    return Biquad(b0: 1, b1: -2, b2: 1, a1: 2 * (k * k - 1) / a0, a2: (1 - k / q + k * k) / a0)
  }
}

/// ITU-R BS.1770-4 の統合ラウドネス（K 特性 + 400 ms ブロック / 75% 重なり + -70 LUFS 絶対ゲート + -10 LU 相対ゲート）。
/// 入力はインターリーブ。L / R の重みは 1.0 で、各チャンネルの二乗平均を足す。
final class LoudnessMeter {
  private var shelf: [Biquad]
  private var hp: [Biquad]
  private let channels: Int
  private let blockLen: Int
  private let hop: Int
  private var hopSums = [Double](repeating: 0, count: 4)
  private var hopIdx = 0
  private var hopsDone = 0
  private var hopSum = 0.0
  private var inHop = 0
  private var blocks: [Double] = []

  init(sampleRate: Int, channels: Int = 1) {
    let ch = max(1, channels)
    self.channels = ch
    shelf = Array(repeating: Biquad.kShelf(fs: sampleRate), count: ch)
    hp = Array(repeating: Biquad.kHighPass(fs: sampleRate), count: ch)
    blockLen = Int(Double(sampleRate) * 0.4)
    hop = blockLen / 4
  }

  /// buf[offset * channels] から count フレームを測る。
  func process(_ buf: UnsafeMutablePointer<Float>, count: Int, offset: Int = 0) {
    let ch = channels
    for i in offset..<(offset + count) {
      for c in 0..<ch {
        let y = hp[c].process(shelf[c].process(Double(buf[i * ch + c])))
        hopSum += y * y
      }
      inHop += 1
      if inHop == hop {
        hopSums[hopIdx] = hopSum
        hopIdx = (hopIdx + 1) % 4
        hopsDone += 1
        hopSum = 0
        inHop = 0
        if hopsDone >= 4 { blocks.append((hopSums[0] + hopSums[1] + hopSums[2] + hopSums[3]) / Double(blockLen)) }
      }
    }
  }

  /// 統合ラウドネス（LUFS）。ゲートを通るブロックが無ければ -120。
  func integrated() -> Double {
    if blocks.isEmpty { return -120 }
    let absGate = pow(10.0, (-70.0 + 0.691) / 10)
    let pass1 = blocks.filter { $0 >= absGate }
    if pass1.isEmpty { return -120 }
    let relGate = pass1.reduce(0, +) / Double(pass1.count) * pow(10.0, -10.0 / 10)
    let pass2 = pass1.filter { $0 >= relGate }
    if pass2.isEmpty { return -120 }
    return -0.691 + 10 * log10(pass2.reduce(0, +) / Double(pass2.count))
  }
}

/// 4 倍オーバーサンプリングのサンプル間ピーク推定（1 チャンネル分）。
/// 49 タップの Hann 窓 sinc を 4 相に分けた FIR（libebur128 と同じ設計）。
/// push(x) は x を含む直近 13 サンプルから補間した値の絶対値の最大（と |x|）を返す。
/// 補間値は |y| ≤ bound × 窓内の最大 |x| を超えないので、窓内のどのサンプルも
/// |x| × bound ≤ floor なら補間を省く（floor は呼び出しごとに同じか増えるだけ、の前提）。
struct TruePeakInterpolator {
  static let factor = 4
  private static let taps = 49
  static let tapsPerPhase = (taps + factor - 1) / factor
  /// coef[f * tapsPerPhase + t] = h[f + 4t]。出力 y[4n+f] = Σ_t h[f + 4t]·x[n−t]。
  private static let coef: [Float] = (0..<(TruePeakInterpolator.factor * TruePeakInterpolator.tapsPerPhase)).map { (i: Int) -> Float in
    let factor = TruePeakInterpolator.factor, taps = TruePeakInterpolator.taps, tpp = TruePeakInterpolator.tapsPerPhase
    let j = i / tpp + factor * (i % tpp)
    if j >= taps { return 0 }
    let m = Double(j) - Double(taps - 1) / 2
    let s = m == 0 ? 1 : sin(m * Double.pi / Double(factor)) / (m * Double.pi / Double(factor))
    return Float(s * 0.5 * (1 - cos(2 * Double.pi * Double(j) / Double(taps - 1))))
  }
  private static let bound: Float = {
    let tpp = TruePeakInterpolator.tapsPerPhase
    var b = 0.0
    for f in 0..<TruePeakInterpolator.factor {
      var sum = 0.0
      for t in 0..<tpp { sum += Double(abs(TruePeakInterpolator.coef[f * tpp + t])) }
      b = max(b, sum)
    }
    return Float(b)
  }()

  private let coef = TruePeakInterpolator.coef
  private let bound = TruePeakInterpolator.bound
  private var hist = [Float](repeating: 0, count: TruePeakInterpolator.tapsPerPhase * 2)
  private var pos = 0
  /// 最後に |x| × bound > floor だったサンプルからの経過数。
  private var sinceLoud = TruePeakInterpolator.tapsPerPhase

  mutating func push(_ x: Float, floor: Float) -> Float {
    let n = TruePeakInterpolator.tapsPerPhase
    hist[pos] = x
    hist[pos + n] = x
    let newest = pos + n
    pos = pos + 1 == n ? 0 : pos + 1
    let ax = abs(x)
    if ax * bound > floor { sinceLoud = 0 } else if sinceLoud < n { sinceLoud += 1 }
    if sinceLoud >= n { return ax }
    var peak = ax
    var k = 0
    for _ in 0..<TruePeakInterpolator.factor {
      var acc: Float = 0
      for t in 0..<n { acc += coef[k] * hist[newest - t]; k += 1 }
      let v = abs(acc)
      if v > peak { peak = v }
    }
    return peak
  }
}

/// トゥルーピーク計（全チャンネルの最大、リニア値）。
final class TruePeakMeter {
  private let channels: Int
  private var interp: [TruePeakInterpolator]
  private(set) var peak: Float = 0

  init(channels: Int = 1) {
    self.channels = max(1, channels)
    interp = Array(repeating: TruePeakInterpolator(), count: max(1, channels))
  }

  /// buf[offset * channels] から count フレームを測る。
  func process(_ buf: UnsafeMutablePointer<Float>, count: Int, offset: Int = 0) {
    let ch = channels
    for i in offset..<(offset + count) {
      for c in 0..<ch {
        let v = interp[c].push(buf[i * ch + c], floor: peak)
        if v > peak { peak = v }
      }
    }
  }
}

/// 先読みトゥルーピークリミッター（AUDIO_DESIGN.md §8.2）。出力は latency フレーム遅れる。
/// 呼び出し側は latency 分を余計に流して先頭を捨てる。
///
/// - ピークはサンプル間（4 倍補間）で検出し、天井より safetyDb 低い値に収める
///   （補間フィルタは 20 kHz 以上を少し低く見積もるため）。
/// - 必要ゲインを「補間の遅れ + 先読み」の区間で最小値ホールドし、先読み長の移動平均で滑らかにする。
///   ゲインはピークの手前から直線的に下がり、ピークの時点で必要量に達する（瞬時に下げると
///   波形に角ができ、それ自体がサンプル間ピークになる）。戻りは releaseMs の指数カーブ。
/// - ゲインは全チャンネル共通（リンク）にし、左右の定位を崩さない。
/// O(1) / フレーム（最小値は単調キュー、平均は累積和）。
final class Limiter {
  /// 検出の安全余裕（dB）。4 倍補間の見積もり不足と、ゲイン変化による小さなはみ出しを吸収する。
  static let safetyDb = 0.2
  private let ceiling: Float
  private let detectCeiling: Float
  private let channels: Int
  private let avgLen: Int
  private let holdLen: Int
  let latency: Int
  private let release: Float
  private var interp: [TruePeakInterpolator]
  private var delayLine: [Float]
  private var delayPos = 0
  private var qIdx: [Int64]
  private var qVal: [Float]
  private var qHead = 0
  private var qTail = 0
  private var avgRing: [Float]
  private var avgPos = 0
  private var avgSum: Double
  private var frame: Int64 = 0
  private var gain: Float = 1

  init(sampleRate: Int, ceilingDb: Double, channels: Int = 1, lookaheadMs: Double = 5, releaseMs: Double = 50) {
    let ch = max(1, channels)
    let avg = max(1, Int(Double(sampleRate) * lookaheadMs / 1000))
    // 補間の遅れ（tapsPerPhase / 2）とサンプル間の 1
    let detDelay = TruePeakInterpolator.tapsPerPhase / 2 + 1
    ceiling = dbToLinear(ceilingDb)
    detectCeiling = dbToLinear(ceilingDb - Limiter.safetyDb)
    self.channels = ch
    avgLen = avg
    holdLen = avg + detDelay
    latency = avg - 1 + detDelay
    release = Float(exp(-1.0 / (Double(sampleRate) * releaseMs / 1000)))
    interp = Array(repeating: TruePeakInterpolator(), count: ch)
    // 入力の遅延線（latency フレーム。読んでから書くので遅れはちょうど latency）
    delayLine = [Float](repeating: 0, count: (avg - 1 + detDelay) * ch)
    qIdx = [Int64](repeating: 0, count: avg + detDelay + 1)
    qVal = [Float](repeating: 1, count: avg + detDelay + 1)
    avgRing = [Float](repeating: 1, count: avg)
    avgSum = Double(avg)
  }

  /// in-place。count はフレーム数。buf の各フレームには latency フレーム前の入力にゲインを掛けたものが入る。
  func process(_ buf: UnsafeMutablePointer<Float>, count: Int) {
    let ch = channels
    let cap = qIdx.count
    for i in 0..<count {
      var det: Float = 0
      for c in 0..<ch {
        // 天井以下と分かる区間は補間を省く（ゲインの判定には天井を超えるかどうかだけが効く）
        let d = interp[c].push(buf[i * ch + c], floor: detectCeiling)
        if d > det { det = d }
      }
      let req: Float = det > detectCeiling ? detectCeiling / det : 1
      while qTail != qHead && qVal[(qTail - 1 + cap) % cap] >= req { qTail = (qTail - 1 + cap) % cap }
      qIdx[qTail] = frame; qVal[qTail] = req; qTail = (qTail + 1) % cap
      while qIdx[qHead] <= frame - Int64(holdLen) { qHead = (qHead + 1) % cap }
      let held = qVal[qHead]
      avgSum += Double(held - avgRing[avgPos])
      avgRing[avgPos] = held
      avgPos = (avgPos + 1) % avgLen
      let smooth = min(1, Float(avgSum / Double(avgLen)))
      gain = smooth < gain ? smooth : gain * release + smooth * (1 - release)
      // 遅延線: latency フレーム前の入力を取り出して、今のフレームを入れる
      let base = delayPos * ch
      for c in 0..<ch {
        let x = buf[i * ch + c]
        buf[i * ch + c] = max(-ceiling, min(ceiling, delayLine[base + c] * gain))
        delayLine[base + c] = x
      }
      delayPos = (delayPos + 1) % latency
      frame += 1
    }
  }
}

/// 書き出したファイルそのものの測定値。
struct OutputMeasure {
  let lufs: Double
  let truePeakDb: Double
}

/// 書き出しのラウドネス制御（AUDIO_DESIGN.md §8.2）。
/// 1. 入力を測り、目標との差をゲインにする（+20 dB まで）。
/// 2. ゲイン後にサンプル間ピークが天井を超えるなら、リミッター込みで出力を測り直し、
///    割線法でゲインを合わせる（リミッターで削れた分の音量を取り戻す）。
/// 3. 本番のパスで、出力（書き出すサンプルそのもの）のラウドネスとトゥルーピークを測る。
final class LoudnessRenderer {
  static let minGainDb = -40.0
  static let maxGainDb = 20.0
  static let maxTrials = 3
  static let toleranceLu = 0.1
  /// 初回の補正: リミッターがかかると 1 dB 上げても出力は 1 LU より少なくしか上がらない。
  static let firstSlope = 0.7
  private static let measureEnd = 0.4
  private static let trialEnd = 0.6

  private let doc: RenderDocument
  private let mixer: Mixer
  private let block: Int
  private let isCancelled: () -> Bool
  private let onProgress: (Double, String) -> Void
  let channels: Int
  private(set) var inputLufs = -120.0
  private(set) var inputTruePeakDb = -120.0
  /// リミッター込みで出力を測り直した回数。
  private(set) var trials = 0

  init(doc: RenderDocument, mixer: Mixer, block: Int = 4096, isCancelled: @escaping () -> Bool = { false },
       onProgress: @escaping (Double, String) -> Void = { _, _ in }) {
    self.doc = doc; self.mixer = mixer; self.block = block; self.isCancelled = isCancelled; self.onProgress = onProgress
    channels = mixer.channels
  }

  /// 目標ラウドネスに合わせるゲイン（dB）。ラウドネス調整が無効なら 0。
  func solveGain() throws -> Double {
    if !doc.loudnessEnabled { return 0 }
    let tpm = TruePeakMeter(channels: channels)
    inputLufs = try pass(gainDb: 0, limiter: false, tpm: tpm, from: 0, to: LoudnessRenderer.measureEnd, phase: "measuring", write: nil)
    inputTruePeakDb = linearToDb(Double(tpm.peak))
    if inputLufs <= -70 { return 0 }
    var g = max(LoudnessRenderer.minGainDb, min(LoudnessRenderer.maxGainDb, doc.targetLufs - inputLufs))
    // リミッターが働かないなら、ゲインをそのまま掛けた出力は目標どおり（線形）
    if inputTruePeakDb + g <= doc.truePeakDbtp { return g }
    var prevG = Double.nan, prevO = Double.nan
    let n = Double(LoudnessRenderer.maxTrials)
    for i in 0..<LoudnessRenderer.maxTrials {
      let span = LoudnessRenderer.trialEnd - LoudnessRenderer.measureEnd
      let o = try pass(gainDb: g, limiter: true, tpm: nil,
                       from: LoudnessRenderer.measureEnd + span * Double(i) / n,
                       to: LoudnessRenderer.measureEnd + span * Double(i + 1) / n, phase: "measuring", write: nil)
      trials += 1
      let e = doc.targetLufs - o
      if abs(e) < LoudnessRenderer.toleranceLu || (g >= LoudnessRenderer.maxGainDb && e > 0) { break }
      let slope = (prevG.isNaN || g == prevG) ? LoudnessRenderer.firstSlope : max(0.2, min(1.0, (o - prevO) / (g - prevG)))
      prevG = g
      prevO = o
      g = max(LoudnessRenderer.minGainDb, min(LoudnessRenderer.maxGainDb, g + e / slope))
    }
    return g
  }

  /// 本番のパス。write(buf, offsetFrames, frames) に書き出すフレームを渡し、その測定値を返す。
  func render(gainDb: Double, write: @escaping (UnsafeMutablePointer<Float>, Int, Int) throws -> Void) throws -> OutputMeasure {
    let tpm = TruePeakMeter(channels: channels)
    let from: Double = !doc.loudnessEnabled ? 0 : (trials > 0 ? LoudnessRenderer.trialEnd : LoudnessRenderer.measureEnd)
    let lufs = try pass(gainDb: gainDb, limiter: doc.loudnessEnabled, tpm: tpm, from: from, to: 1, phase: "encoding", write: write)
    return OutputMeasure(lufs: lufs, truePeakDb: linearToDb(Double(tpm.peak)))
  }

  /// ミックス → ゲイン →（リミッター）を先頭から流し、出力のラウドネスを返す。
  private func pass(gainDb: Double, limiter: Bool, tpm: TruePeakMeter?, from: Double, to: Double, phase: String,
                    write: ((UnsafeMutablePointer<Float>, Int, Int) throws -> Void)?) throws -> Double {
    mixer.reset()
    let total = doc.totalFrames
    let ch = channels
    let gain = dbToLinear(gainDb)
    let lim = limiter ? Limiter(sampleRate: doc.sampleRate, ceilingDb: doc.truePeakDbtp, channels: ch) : nil
    let latency = lim?.latency ?? 0
    let meter = LoudnessMeter(sampleRate: doc.sampleRate, channels: ch)
    let buf = UnsafeMutablePointer<Float>.allocate(capacity: block * ch)
    defer { buf.deallocate() }
    let renderEnd = total + Int64(latency)
    var f: Int64 = 0
    var emitted: Int64 = 0
    var blocks = 0
    while f < renderEnd {
      if isCancelled() { throw AudioEngineError.cancelled }
      let n = Int(min(Int64(block), renderEnd - f))
      try mixer.render(frame: f, count: n, into: buf)
      if gain != 1 { for i in 0..<(n * ch) { buf[i] *= gain } }
      lim?.process(buf, count: n)
      // 先頭 latency フレームは遅延分なので捨て、total を超える分も捨てる
      var outStart = 0
      if f < Int64(latency) { outStart = min(n, Int(Int64(latency) - f)) }
      var outCount = n - outStart
      if emitted + Int64(outCount) > total { outCount = Int(total - emitted) }
      if outCount > 0 {
        meter.process(buf, count: outCount, offset: outStart)
        tpm?.process(buf, count: outCount, offset: outStart)
        try write?(buf, outStart, outCount)
        emitted += Int64(outCount)
      }
      f += Int64(n)
      blocks += 1
      if blocks % 50 == 0 { onProgress(from + (to - from) * Double(f) / Double(max(1, renderEnd)), phase) }
    }
    return meter.integrated()
  }
}
