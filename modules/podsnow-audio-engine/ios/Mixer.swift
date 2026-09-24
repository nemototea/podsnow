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
/// 出力は doc.channels チャンネルのインターリーブ Float32。モノラル素材はステレオ出力で左右に複製し、
/// ステレオ素材はモノラル出力で平均する（ステレオ録音の左右は書き出しまで保つ）。
final class Mixer {
  private let doc: RenderDocument
  let channels: Int
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
  /// フレーム数での容量（バッファ実長は capacity * channels）。
  private var capacity: Int

  init(doc: RenderDocument) {
    self.doc = doc
    channels = max(1, min(2, doc.channels))
    func coef(_ ms: Double) -> Float { ms <= 0 ? 0 : Float(exp(-1.0 / (Double(doc.sampleRate) * ms / 1000))) }
    attackCoef = coef(doc.duckAttackMs)
    releaseCoef = coef(doc.duckReleaseMs)
    envCoef = coef(10)
    duckFloor = dbToLinear(doc.duckDepthDb)
    threshold = dbToLinear(doc.duckThresholdDb)
    capacity = 8192
    voiceBuf = .allocate(capacity: capacity * channels)
    duckCurve = .allocate(capacity: capacity)
    tmp = .allocate(capacity: capacity * channels)
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
      voiceBuf = .allocate(capacity: n * channels); duckCurve = .allocate(capacity: n); tmp = .allocate(capacity: n * channels)
    }
  }

  /// out[0, count * channels) にミックス結果（インターリーブ）を書く。
  func render(frame: Int64, count: Int, into out: UnsafeMutablePointer<Float>) throws {
    ensure(count)
    let ch = channels
    let len = count * ch
    voiceBuf.update(repeating: 0, count: len)
    for c in doc.voice { try mixClip(c, frame: frame, count: count, out: voiceBuf) }
    out.update(repeating: 0, count: len)
    if !doc.overlays.isEmpty {
      for i in 0..<count {
        // 左右どちらかで話していれば声ありとみなす
        var v: Float = 0
        for c in 0..<ch { v = max(v, abs(voiceBuf[i * ch + c])) }
        voiceEnv = v > voiceEnv ? v : voiceEnv * envCoef + v * (1 - envCoef)
        let target: Float = (doc.duckEnabled && voiceEnv > threshold) ? duckFloor : 1
        duckGain = target < duckGain ? duckGain * attackCoef + target * (1 - attackCoef)
          : duckGain * releaseCoef + target * (1 - releaseCoef)
        duckCurve[i] = duckGain
      }
      for o in doc.overlays { try mixOverlay(o, frame: frame, count: count, out: out) }
    }
    for i in 0..<len { out[i] += voiceBuf[i] }
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
    let ch = channels
    try reader(c.path).read(frame: c.fileStart + (start - c.tlStart), count: n, into: tmp, outChannels: ch)
    let oi = Int(start - frame)
    for i in 0..<n {
      let pos = start - c.tlStart + Int64(i)
      let g = c.gain * fade(pos, c.fileLength, c.fadeIn, c.fadeOut)
      for k in 0..<ch { out[(oi + i) * ch + k] += tmp[i * ch + k] * g }
    }
  }

  private func mixOverlay(_ c: RenderClip, frame: Int64, count: Int, out: UnsafeMutablePointer<Float>) throws {
    let start = max(frame, c.tlStart)
    let end = min(frame + Int64(count), c.tlEnd)
    if end <= start || c.fileLength <= 0 { return }
    let n = Int(end - start)
    let ch = channels
    let total = c.tlEnd - c.tlStart
    let r = try reader(c.path)
    tmp.update(repeating: 0, count: n * ch)
    var i = 0
    while i < n {
      let pos = start - c.tlStart + Int64(i)
      let srcPos = c.loop ? pos % c.fileLength : pos
      if srcPos >= c.fileLength { break }
      let run = Int(min(Int64(n - i), c.fileLength - srcPos))
      r.read(frame: c.fileStart + srcPos, count: run, into: tmp, outOffset: i, outChannels: ch)
      i += run
    }
    let oi = Int(start - frame)
    for j in 0..<n {
      let pos = start - c.tlStart + Int64(j)
      let g = c.gain * fade(pos, total, c.fadeIn, c.fadeOut) * (c.duck ? duckCurve[oi + j] : 1)
      for k in 0..<ch { out[(oi + j) * ch + k] += tmp[j * ch + k] * g }
    }
  }
}
