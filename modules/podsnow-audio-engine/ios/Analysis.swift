import Foundation

/// 波形ピークキャッシュ（DATA_MODEL.md §2）。
/// 形式: "PKS1" | u32 sampleRate | u32 samplesPerSecond | u32 count | count × (i8 min, i8 max)
enum Peaks {
  static func generate(src: String, dst: String, samplesPerSecond: Int, onProgress: ((Double) -> Void)? = nil) throws -> Int {
    let r = try WavReader(path: src)
    let bucket = max(1, r.sampleRate / max(1, samplesPerSecond))
    let count = Int((r.frames + Int64(bucket) - 1) / Int64(bucket))
    let fm = FileManager.default
    try fm.createDirectory(atPath: (dst as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
    let tmp = dst + ".tmp"
    _ = fm.createFile(atPath: tmp, contents: nil)
    let out = try FileHandle(forWritingTo: URL(fileURLWithPath: tmp))
    defer { try? out.close() }
    var head = Data()
    head.append(contentsOf: Array("PKS1".utf8))
    head.appendLE(UInt32(r.sampleRate)); head.appendLE(UInt32(samplesPerSecond)); head.appendLE(UInt32(count))
    try out.write(contentsOf: head)
    let chunkBuckets = 4096
    let buf = UnsafeMutablePointer<Float>.allocate(capacity: bucket * chunkBuckets)
    defer { buf.deallocate() }
    var frame: Int64 = 0
    var written = 0
    while written < count {
      let nb = min(chunkBuckets, count - written)
      r.readMono(frame: frame, count: nb * bucket, into: buf)
      var bytes = [Int8](repeating: 0, count: nb * 2)
      for b in 0..<nb {
        var mn: Float = 1, mx: Float = -1
        let base = b * bucket
        for i in 0..<bucket { let v = buf[base + i]; if v < mn { mn = v }; if v > mx { mx = v } }
        bytes[b * 2] = Int8(max(-127, min(127, Int(mn * 127))))
        bytes[b * 2 + 1] = Int8(max(-127, min(127, Int(mx * 127))))
      }
      try out.write(contentsOf: Data(bytes: bytes, count: bytes.count))
      written += nb
      frame += Int64(nb * bucket)
      onProgress?(Double(written) / Double(count))
    }
    try? fm.removeItem(atPath: dst)
    try fm.moveItem(atPath: tmp, toPath: dst)
    return count
  }
}

struct FrameRange {
  let start: Int64
  let end: Int64
}

/// 無音検出: 窓 RMS がしきい値未満の区間が minDuration 以上続くものを返す（AUDIO_DESIGN.md §6.2）。
enum SilenceDetector {
  static func detect(src: String, minDurationMs: Int, thresholdDb: Double, windowMs: Int = 20) throws -> [FrameRange] {
    let r = try WavReader(path: src)
    let win = max(1, r.sampleRate * windowMs / 1000)
    let minFrames = Int64(r.sampleRate) * Int64(minDurationMs) / 1000
    let threshold = dbToLinear(thresholdDb)
    var out: [FrameRange] = []
    let chunkWins = 512
    let buf = UnsafeMutablePointer<Float>.allocate(capacity: win * chunkWins)
    defer { buf.deallocate() }
    var frame: Int64 = 0
    var silentStart: Int64 = -1
    while frame < r.frames {
      let nw = Int(min(Int64(chunkWins), (r.frames - frame + Int64(win) - 1) / Int64(win)))
      r.readMono(frame: frame, count: nw * win, into: buf)
      for w in 0..<nw {
        var sum: Double = 0
        let base = w * win
        for i in 0..<win { let v = buf[base + i]; sum += Double(v * v) }
        let rms = Float((sum / Double(win)).squareRoot())
        let at = frame + Int64(w * win)
        if rms < threshold {
          if silentStart < 0 { silentStart = at }
        } else if silentStart >= 0 {
          if at - silentStart >= minFrames { out.append(FrameRange(start: silentStart, end: at)) }
          silentStart = -1
        }
      }
      frame += Int64(nw * win)
    }
    if silentStart >= 0, r.frames - silentStart >= minFrames { out.append(FrameRange(start: silentStart, end: r.frames)) }
    return out
  }
}
