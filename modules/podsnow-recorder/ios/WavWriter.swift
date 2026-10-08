import Foundation

/// 16 bit PCM WAV の追記書き込み。
/// クラッシュ耐性のため、一定間隔で RIFF / data のサイズをヘッダに書き戻して fsync する（AUDIO_DESIGN.md §3.3）。
/// 未確定のヘッダは data size = 0xFFFFFFFF。復旧は `repairHeader` がファイル実長から行う。
final class WavWriter {
  static let headerSize: UInt64 = 44
  static let placeholderSize: UInt32 = 0xFFFF_FFFF

  let path: String
  let sampleRate: Int
  let channels: Int
  let bitsPerSample = 16

  private let handle: FileHandle
  private(set) var dataBytes: UInt64 = 0
  private var bytesSinceFlush: UInt64 = 0
  private var lastFlush = Date()
  private let flushInterval: TimeInterval
  private var closed = false

  var frames: UInt64 { dataBytes / UInt64(channels * bitsPerSample / 8) }
  var fileBytes: UInt64 { WavWriter.headerSize + dataBytes }

  init(path: String, sampleRate: Int, channels: Int, flushInterval: TimeInterval) throws {
    self.path = path
    self.sampleRate = sampleRate
    self.channels = channels
    self.flushInterval = flushInterval
    let fm = FileManager.default
    let dir = (path as NSString).deletingLastPathComponent
    try fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
    guard fm.createFile(atPath: path, contents: nil) else {
      throw NSError(domain: "WavWriter", code: 1, userInfo: [NSLocalizedDescriptionKey: "cannot create \(path)"])
    }
    handle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
    try handle.write(contentsOf: WavWriter.header(sampleRate: sampleRate, channels: channels, dataBytes: nil))
    try handle.synchronize()
  }

  /// Int16 インターリーブ PCM を追記する。
  func append(_ data: Data) throws {
    guard !closed else { return }
    try handle.seekToEnd()
    try handle.write(contentsOf: data)
    dataBytes += UInt64(data.count)
    bytesSinceFlush += UInt64(data.count)
    if Date().timeIntervalSince(lastFlush) >= flushInterval {
      try flushHeader()
    }
  }

  /// ヘッダに現在のサイズを書き戻し、fsync する。
  func flushHeader() throws {
    guard !closed else { return }
    try handle.seek(toOffset: 0)
    try handle.write(contentsOf: WavWriter.header(sampleRate: sampleRate, channels: channels, dataBytes: dataBytes))
    try handle.synchronize()
    lastFlush = Date()
    bytesSinceFlush = 0
  }

  /// 最終ヘッダを書いて閉じる。
  func finalize() throws {
    guard !closed else { return }
    try flushHeader()
    try handle.close()
    closed = true
  }

  static func header(sampleRate: Int, channels: Int, dataBytes: UInt64?) -> Data {
    let bits = 16
    let byteRate = UInt32(sampleRate * channels * bits / 8)
    let blockAlign = UInt16(channels * bits / 8)
    let dataSize: UInt32 = dataBytes.map { UInt32(min($0, UInt64(UInt32.max - 36))) } ?? placeholderSize
    let riffSize: UInt32 = dataBytes == nil ? placeholderSize : dataSize &+ 36
    var d = Data(capacity: 44)
    d.append(contentsOf: Array("RIFF".utf8))
    d.appendLE(riffSize)
    d.append(contentsOf: Array("WAVE".utf8))
    d.append(contentsOf: Array("fmt ".utf8))
    d.appendLE(UInt32(16))
    d.appendLE(UInt16(1)) // PCM
    d.appendLE(UInt16(channels))
    d.appendLE(UInt32(sampleRate))
    d.appendLE(byteRate)
    d.appendLE(blockAlign)
    d.appendLE(UInt16(bits))
    d.append(contentsOf: Array("data".utf8))
    d.appendLE(dataSize)
    return d
  }

  /// ヘッダ未確定（またはサイズ不一致）の WAV をファイル実長から修復する。
  /// 戻り値: (frames, fileBytes, sampleRate, channels)
  static func repairHeader(path: String) throws -> (frames: UInt64, bytes: UInt64, sampleRate: Int, channels: Int) {
    let url = URL(fileURLWithPath: path)
    let handle = try FileHandle(forUpdating: url)
    defer { try? handle.close() }
    let size = try handle.seekToEnd()
    guard size >= headerSize else {
      throw NSError(domain: "WavWriter", code: 2, userInfo: [NSLocalizedDescriptionKey: "file too short: \(path)"])
    }
    try handle.seek(toOffset: 0)
    guard let head = try handle.read(upToCount: Int(headerSize)), head.count == Int(headerSize) else {
      throw NSError(domain: "WavWriter", code: 3, userInfo: [NSLocalizedDescriptionKey: "cannot read header"])
    }
    let channels = Int(head.readLE16(at: 22))
    let sampleRate = Int(head.readLE32(at: 24))
    let blockAlign = UInt64(max(1, channels * 2))
    var dataBytes = size - headerSize
    dataBytes -= dataBytes % blockAlign // 途中で切れた最後のフレームは捨てる
    try handle.seek(toOffset: 0)
    try handle.write(contentsOf: header(sampleRate: sampleRate, channels: channels, dataBytes: dataBytes))
    try handle.truncate(atOffset: headerSize + dataBytes)
    try handle.synchronize()
    return (dataBytes / blockAlign, headerSize + dataBytes, sampleRate, channels)
  }
}

extension Data {
  mutating func appendLE(_ v: UInt16) {
    var x = v.littleEndian
    Swift.withUnsafeBytes(of: &x) { append(contentsOf: $0) }
  }

  mutating func appendLE(_ v: UInt32) {
    var x = v.littleEndian
    Swift.withUnsafeBytes(of: &x) { append(contentsOf: $0) }
  }

  func readLE16(at offset: Int) -> UInt16 {
    UInt16(self[startIndex + offset]) | (UInt16(self[startIndex + offset + 1]) << 8)
  }

  func readLE32(at offset: Int) -> UInt32 {
    UInt32(readLE16(at: offset)) | (UInt32(readLE16(at: offset + 2)) << 16)
  }
}
