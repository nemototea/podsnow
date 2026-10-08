import Foundation

/// 16 bit PCM WAV の読み出し。fmt / data チャンクを探し、任意フレームからの読み出しに対応する。
final class WavReader {
  let path: String
  let sampleRate: Int
  let channels: Int
  let frames: Int64
  private let dataOffset: UInt64
  private let handle: FileHandle

  init(path: String) throws {
    self.path = path
    handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
    let length = try handle.seekToEnd()
    try handle.seek(toOffset: 0)
    guard let head = try handle.read(upToCount: 12), head.count == 12,
          String(data: head[0..<4], encoding: .ascii) == "RIFF",
          String(data: head[8..<12], encoding: .ascii) == "WAVE" else {
      throw AudioEngineError.message("not a WAV: \(path)")
    }
    var sr = 0, ch = 0, bits = 0
    var dOff: UInt64 = 0, dLen: UInt64 = 0, found = false
    var pos: UInt64 = 12
    while pos + 8 <= length {
      try handle.seek(toOffset: pos)
      guard let ck = try handle.read(upToCount: 8), ck.count == 8 else { break }
      let id = String(data: ck[0..<4], encoding: .ascii) ?? ""
      let size = UInt64(ck.readLE32(at: 4))
      if id == "fmt " {
        guard let f = try handle.read(upToCount: 16), f.count == 16 else { break }
        let fmt = Int(f.readLE16(at: 0))
        guard fmt == 1 || fmt == 0xFFFE else { throw AudioEngineError.message("unsupported WAV format \(fmt)") }
        ch = Int(f.readLE16(at: 2)); sr = Int(f.readLE32(at: 4)); bits = Int(f.readLE16(at: 14))
      } else if id == "data" {
        dOff = pos + 8
        dLen = (size == 0xFFFF_FFFF || pos + 8 + size > length) ? length - (pos + 8) : size
        found = true
        break
      }
      pos += 8 + size + (size & 1)
    }
    guard found, ch > 0, sr > 0 else { throw AudioEngineError.message("WAV without fmt/data: \(path)") }
    guard bits == 16 else { throw AudioEngineError.message("only 16 bit PCM is supported: \(path)") }
    sampleRate = sr; channels = ch; dataOffset = dOff
    frames = Int64(dLen / UInt64(ch * 2))
  }

  deinit { try? handle.close() }

  /// [frame, frame+count) をモノラル Float にダウンミックスして out[outOffset...] に書く（不足分は 0）。
  @discardableResult
  func readMono(frame: Int64, count: Int, into out: UnsafeMutablePointer<Float>, outOffset: Int = 0) -> Int {
    read(frame: frame, count: count, into: out, outOffset: outOffset, outChannels: 1)
  }

  /// [frame, frame+count) を outChannels チャンネルのインターリーブ Float にして書く（不足分は 0）。
  /// outOffset はフレーム単位。チャンネル数の変換:
  /// 同数はそのまま、1 ch 出力は全チャンネルの平均、モノラル素材の 2 ch 出力は左右に複製。
  @discardableResult
  func read(frame: Int64, count: Int, into out: UnsafeMutablePointer<Float>, outOffset: Int = 0, outChannels: Int) -> Int {
    let oc = outChannels
    let o = out + outOffset * oc
    if frame >= frames || count <= 0 { o.update(repeating: 0, count: max(0, count) * oc); return 0 }
    let n = Int(min(Int64(count), frames - frame))
    let bytes = n * channels * 2
    do {
      try handle.seek(toOffset: dataOffset + UInt64(frame) * UInt64(channels * 2))
      guard let d = try handle.read(upToCount: bytes) else { o.update(repeating: 0, count: count * oc); return 0 }
      let got = d.count / (channels * 2)
      let ch = channels
      d.withUnsafeBytes { raw in
        let p = raw.bindMemory(to: Int16.self)
        if oc == 1 {
          let inv = 1 / (32768 * Float(ch))
          for i in 0..<got {
            var acc: Int32 = 0
            for c in 0..<ch { acc += Int32(Int16(littleEndian: p[i * ch + c])) }
            o[i] = Float(acc) * inv
          }
        } else {
          let inv: Float = 1 / 32768
          for i in 0..<got {
            for c in 0..<oc {
              o[i * oc + c] = Float(Int16(littleEndian: p[i * ch + min(c, ch - 1)])) * inv
            }
          }
        }
      }
      if got < count { (o + got * oc).update(repeating: 0, count: (count - got) * oc) }
      return got
    } catch {
      o.update(repeating: 0, count: count * oc)
      return 0
    }
  }
}

enum AudioEngineError: Error, LocalizedError {
  case message(String)
  case cancelled
  var errorDescription: String? {
    switch self {
    case let .message(m): return m
    case .cancelled: return "cancelled"
    }
  }
}

extension Data {
  func readLE16(at offset: Int) -> UInt16 {
    UInt16(self[startIndex + offset]) | (UInt16(self[startIndex + offset + 1]) << 8)
  }

  func readLE32(at offset: Int) -> UInt32 {
    UInt32(readLE16(at: offset)) | (UInt32(readLE16(at: offset + 2)) << 16)
  }

  mutating func appendLE(_ v: UInt16) {
    var x = v.littleEndian
    Swift.withUnsafeBytes(of: &x) { append(contentsOf: $0) }
  }

  mutating func appendLE(_ v: UInt32) {
    var x = v.littleEndian
    Swift.withUnsafeBytes(of: &x) { append(contentsOf: $0) }
  }
}

func dbToLinear(_ db: Double) -> Float { Float(pow(10.0, db / 20)) }
func linearToDb(_ v: Double) -> Double { v <= 0 ? -120 : max(-120, 20 * log10(v)) }
