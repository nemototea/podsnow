import Foundation

/// RenderDocument（domain/render/types.ts）の Swift 表現。
struct RenderClip {
  let path: String
  let fileStart: Int64
  let fileEnd: Int64
  let tlStart: Int64
  let tlEnd: Int64
  let gain: Float
  let fadeIn: Int64
  let fadeOut: Int64
  let duck: Bool
  let loop: Bool
  var fileLength: Int64 { fileEnd - fileStart }
}

struct RenderDocument {
  let sampleRate: Int
  let channels: Int
  let totalFrames: Int64
  let voice: [RenderClip]
  let overlays: [RenderClip]
  let duckEnabled: Bool
  let duckDepthDb: Double
  let duckAttackMs: Double
  let duckReleaseMs: Double
  let duckThresholdDb: Double
  let loudnessEnabled: Bool
  let targetLufs: Double
  let truePeakDbtp: Double

  static func parse(json: String) throws -> RenderDocument {
    guard let data = json.data(using: .utf8),
          let o = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw AudioEngineError.message("invalid document JSON")
    }
    func int64(_ d: [String: Any], _ k: String, _ def: Int64 = 0) -> Int64 { (d[k] as? NSNumber)?.int64Value ?? def }
    func dbl(_ d: [String: Any], _ k: String, _ def: Double) -> Double { (d[k] as? NSNumber)?.doubleValue ?? def }
    func bool(_ d: [String: Any], _ k: String, _ def: Bool) -> Bool { (d[k] as? Bool) ?? def }
    func clips(_ arr: Any?, overlay: Bool) -> [RenderClip] {
      guard let a = arr as? [[String: Any]] else { return [] }
      return a.compactMap { c in
        guard let path = c["path"] as? String else { return nil }
        let fs = int64(c, "fileStart"), fe = int64(c, "fileEnd"), ts = int64(c, "tlStart")
        return RenderClip(
          path: path, fileStart: fs, fileEnd: fe, tlStart: ts,
          tlEnd: overlay ? int64(c, "tlEnd") : ts + (fe - fs),
          gain: dbToLinear(dbl(c, "gainDb", 0)),
          fadeIn: int64(c, "fadeInFrames"), fadeOut: int64(c, "fadeOutFrames"),
          duck: overlay && bool(c, "duck", false), loop: overlay && bool(c, "loop", false)
        )
      }
    }
    let d = o["ducking"] as? [String: Any] ?? [:]
    let l = o["loudness"] as? [String: Any] ?? [:]
    return RenderDocument(
      sampleRate: Int(int64(o, "sampleRate", 48000)), channels: Int(int64(o, "channels", 1)), totalFrames: int64(o, "totalFrames"),
      voice: clips(o["voice"], overlay: false), overlays: clips(o["overlays"], overlay: true),
      duckEnabled: bool(d, "enabled", true), duckDepthDb: dbl(d, "depthDb", -10), duckAttackMs: dbl(d, "attackMs", 50),
      duckReleaseMs: dbl(d, "releaseMs", 500), duckThresholdDb: dbl(d, "thresholdDb", -40),
      loudnessEnabled: bool(l, "enabled", true), targetLufs: dbl(l, "targetLufs", -16), truePeakDbtp: dbl(l, "truePeakDbtp", -1)
    )
  }
}

/// ストリーミングミキサー。render(frame, count) を昇順に呼ぶとダッキングの状態が連続する。シークしたら reset()。
/// 出力はモノラル Float32（ステレオ出力は呼び出し側で複製）。
final class Mixer {
  private let doc: RenderDocument
  private var readers: [String: WavReader] = [:]
  private var duckGain: Float = 1
  private let attackCoef: Float
  private let releaseCoef: Float
  private let duckFloor: Float
  private let threshold: Float
  private var voiceEnv: Float = 0
  private let envCoef: Float
  private var voiceBuf: UnsafeMutablePointer<Float>
  private var duckCurve: UnsafeMutablePointer<Float>
  private var tmp: UnsafeMutablePointer<Float>
  private var capacity: Int

  init(doc: RenderDocument) {
    self.doc = doc
    func coef(_ ms: Double) -> Float { ms <= 0 ? 0 : Float(exp(-1.0 / (Double(doc.sampleRate) * ms / 1000))) }
    attackCoef = coef(doc.duckAttackMs)
    releaseCoef = coef(doc.duckReleaseMs)
    envCoef = coef(10)
    duckFloor = dbToLinear(doc.duckDepthDb)
    threshold = dbToLinear(doc.duckThresholdDb)
    capacity = 8192
    voiceBuf = .allocate(capacity: capacity)
    duckCurve = .allocate(capacity: capacity)
    tmp = .allocate(capacity: capacity)
  }

  deinit {
    voiceBuf.deallocate(); duckCurve.deallocate(); tmp.deallocate()
  }

  func reset() { duckGain = 1; voiceEnv = 0 }

  private func reader(_ path: String) throws -> WavReader {
    if let r = readers[path] { return r }
    let r = try WavReader(path: path)
    readers[path] = r
    return r
  }

  private func ensure(_ n: Int) {
    if n > capacity {
      voiceBuf.deallocate(); duckCurve.deallocate(); tmp.deallocate()
      capacity = n
      voiceBuf = .allocate(capacity: n); duckCurve = .allocate(capacity: n); tmp = .allocate(capacity: n)
    }
  }

  /// out[0, count) にミックス結果（モノラル）を書く。
  func render(frame: Int64, count: Int, into out: UnsafeMutablePointer<Float>) throws {
    ensure(count)
    voiceBuf.update(repeating: 0, count: count)
    for c in doc.voice { try mixClip(c, frame: frame, count: count, out: voiceBuf) }
    out.update(repeating: 0, count: count)
    if !doc.overlays.isEmpty {
      for i in 0..<count {
        let v = abs(voiceBuf[i])
        voiceEnv = v > voiceEnv ? v : voiceEnv * envCoef + v * (1 - envCoef)
        let target: Float = (doc.duckEnabled && voiceEnv > threshold) ? duckFloor : 1
        duckGain = target < duckGain ? duckGain * attackCoef + target * (1 - attackCoef)
          : duckGain * releaseCoef + target * (1 - releaseCoef)
        duckCurve[i] = duckGain
      }
      for o in doc.overlays { try mixOverlay(o, frame: frame, count: count, out: out) }
    }
    for i in 0..<count { out[i] += voiceBuf[i] }
  }

  private func fade(_ pos: Int64, _ length: Int64, _ fadeIn: Int64, _ fadeOut: Int64) -> Float {
    var g: Float = 1
    if fadeIn > 0, pos < fadeIn { g *= Float(pos) / Float(fadeIn) }
    if fadeOut > 0, length - pos <= fadeOut { g *= max(0, min(1, Float(length - pos) / Float(fadeOut))) }
    return g
  }

  private func mixClip(_ c: RenderClip, frame: Int64, count: Int, out: UnsafeMutablePointer<Float>) throws {
    let start = max(frame, c.tlStart)
    let end = min(frame + Int64(count), c.tlEnd)
    if end <= start { return }
    let n = Int(end - start)
    try reader(c.path).readMono(frame: c.fileStart + (start - c.tlStart), count: n, into: tmp)
    let oi = Int(start - frame)
    for i in 0..<n {
      let pos = start - c.tlStart + Int64(i)
      out[oi + i] += tmp[i] * c.gain * fade(pos, c.fileLength, c.fadeIn, c.fadeOut)
    }
  }

  private func mixOverlay(_ c: RenderClip, frame: Int64, count: Int, out: UnsafeMutablePointer<Float>) throws {
    let start = max(frame, c.tlStart)
    let end = min(frame + Int64(count), c.tlEnd)
    if end <= start || c.fileLength <= 0 { return }
    let n = Int(end - start)
    let total = c.tlEnd - c.tlStart
    let r = try reader(c.path)
    tmp.update(repeating: 0, count: n)
    var i = 0
    while i < n {
      let pos = start - c.tlStart + Int64(i)
      let srcPos = c.loop ? pos % c.fileLength : pos
      if srcPos >= c.fileLength { break }
      let run = Int(min(Int64(n - i), c.fileLength - srcPos))
      r.readMono(frame: c.fileStart + srcPos, count: run, into: tmp, outOffset: i)
      i += run
    }
    let oi = Int(start - frame)
    for k in 0..<n {
      let pos = start - c.tlStart + Int64(k)
      let g = c.gain * fade(pos, total, c.fadeIn, c.fadeOut) * (c.duck ? duckCurve[oi + k] : 1)
      out[oi + k] += tmp[k] * g
    }
  }
}

/// 2 次 IIR。
struct Biquad {
  let b0, b1, b2, a1, a2: Double
  var z1 = 0.0, z2 = 0.0
  mutating func process(_ x: Double) -> Double {
    let y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    return y
  }

  static func highShelf(fs: Int, f0: Double, gainDb: Double, q: Double) -> Biquad {
    let a = pow(10.0, gainDb / 40), w0 = 2 * Double.pi * f0 / Double(fs)
    let cw = cos(w0), sw = sin(w0), alpha = sw / (2 * q), sa = sqrt(a)
    let b0 = a * ((a + 1) + (a - 1) * cw + 2 * sa * alpha)
    let b1 = -2 * a * ((a - 1) + (a + 1) * cw)
    let b2 = a * ((a + 1) + (a - 1) * cw - 2 * sa * alpha)
    let a0 = (a + 1) - (a - 1) * cw + 2 * sa * alpha
    let a1 = 2 * ((a - 1) - (a + 1) * cw)
    let a2 = (a + 1) - (a - 1) * cw - 2 * sa * alpha
    return Biquad(b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0)
  }

  static func highPass(fs: Int, f0: Double, q: Double) -> Biquad {
    let w0 = 2 * Double.pi * f0 / Double(fs), cw = cos(w0), sw = sin(w0), alpha = sw / (2 * q)
    let b0 = (1 + cw) / 2, b1 = -(1 + cw), b2 = (1 + cw) / 2
    let a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha
    return Biquad(b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0)
  }
}

/// ITU-R BS.1770-4 の統合ラウドネス（モノラル入力、K 特性 + ゲーティング）。
final class LoudnessMeter {
  private var shelf: Biquad
  private var hp: Biquad
  private let blockLen: Int
  private let hop: Int
  private var hopSums = [Double](repeating: 0, count: 4)
  private var hopIdx = 0
  private var hopsDone = 0
  private var hopSum = 0.0
  private var inHop = 0
  private var blocks: [Double] = []

  init(sampleRate: Int) {
    shelf = .highShelf(fs: sampleRate, f0: 1681.974450955533, gainDb: 3.999843853973347, q: 0.7071752369554196)
    hp = .highPass(fs: sampleRate, f0: 38.13547087602444, q: 0.5003270373238773)
    blockLen = Int(Double(sampleRate) * 0.4)
    hop = blockLen / 4
  }

  func process(_ buf: UnsafeMutablePointer<Float>, count: Int) {
    for i in 0..<count {
      let y = hp.process(shelf.process(Double(buf[i])))
      hopSum += y * y
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

  func integrated() -> Double {
    if blocks.isEmpty { return -120 }
    let absGate = pow(10.0, (-70.0 + 0.691) / 10)
    let pass1 = blocks.filter { $0 >= absGate }
    if pass1.isEmpty { return -120 }
    let mean1 = pass1.reduce(0, +) / Double(pass1.count)
    let relGate = mean1 * pow(10.0, -10.0 / 10)
    let pass2 = pass1.filter { $0 >= relGate }
    if pass2.isEmpty { return -120 }
    return -0.691 + 10 * log10(pass2.reduce(0, +) / Double(pass2.count))
  }
}

/// 4 倍オーバーサンプリングの簡易トゥルーピーク計（4 相の窓付き sinc）。【仮説】
final class TruePeakMeter {
  private let taps = 4
  private var phases: [[Double]] = []
  private var hist: [Float]
  private(set) var peak: Float = 0

  init() {
    hist = [Float](repeating: 0, count: taps * 2)
    let n = taps * 2
    for p in 0..<4 {
      phases.append((0..<n).map { k in
        let x = Double(k - taps + 1) - Double(p) / 4
        let s = x == 0 ? 1 : sin(Double.pi * x) / (Double.pi * x)
        return s * (0.5 - 0.5 * cos(2 * Double.pi * (Double(k) + 0.5) / Double(n)))
      })
    }
  }

  func process(_ buf: UnsafeMutablePointer<Float>, count: Int) {
    for i in 0..<count {
      hist.removeFirst()
      hist.append(buf[i])
      for h in phases {
        var acc = 0.0
        for k in 0..<hist.count { acc += Double(hist[k]) * h[k] }
        let v = Float(abs(acc))
        if v > peak { peak = v }
      }
    }
  }
}

/// 先読みピークリミッター（AUDIO_DESIGN.md §8）。ブロック単位の先読みで O(n)。出力は latency サンプル遅れる。
final class Limiter {
  private let ceiling: Float
  let latency: Int
  private let release: Float
  private var prev: [Float]
  private var prevMax: Float = 0
  private var cur: [Float]
  private var curLen = 0
  private var curMax: Float = 0
  private var gain: Float = 1

  init(sampleRate: Int, ceilingDb: Double, lookaheadMs: Double = 5, releaseMs: Double = 50) {
    ceiling = dbToLinear(ceilingDb)
    latency = max(1, Int(Double(sampleRate) * lookaheadMs / 1000))
    release = Float(exp(-1.0 / (Double(sampleRate) * releaseMs / 1000)))
    prev = [Float](repeating: 0, count: latency)
    cur = [Float](repeating: 0, count: latency)
  }

  func process(_ buf: UnsafeMutablePointer<Float>, count: Int) {
    for i in 0..<count {
      let x = buf[i]
      let ax = abs(x)
      if ax > curMax { curMax = ax }
      cur[curLen] = x
      curLen += 1
      let mx = max(prevMax, curMax)
      let target: Float = mx > ceiling ? ceiling / mx : 1
      gain = target < gain ? target : gain * release + target * (1 - release)
      buf[i] = max(-ceiling, min(ceiling, prev[curLen - 1] * gain))
      if curLen == latency {
        swap(&prev, &cur)
        prevMax = curMax
        curLen = 0
        curMax = 0
      }
    }
  }
}
