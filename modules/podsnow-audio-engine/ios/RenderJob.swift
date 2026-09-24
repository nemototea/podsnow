import AVFoundation
import Foundation

/// 書き出し先のエンコーダ抽象。write は Int16 インターリーブ PCM。
protocol PcmSink {
  func write(_ pcm: UnsafePointer<Int16>, frames: Int) throws
  func finish() throws
}

/// 16 bit PCM WAV。
final class WavSink: PcmSink {
  private let handle: FileHandle
  private let sampleRate: Int
  private let channels: Int
  private var dataBytes: UInt64 = 0

  init(path: String, sampleRate: Int, channels: Int) throws {
    self.sampleRate = sampleRate
    self.channels = channels
    let fm = FileManager.default
    try fm.createDirectory(atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
    guard fm.createFile(atPath: path, contents: nil) else { throw AudioEngineError.message("cannot create \(path)") }
    handle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
    try handle.write(contentsOf: header(dataBytes: 0))
  }

  private func header(dataBytes: UInt64) -> Data {
    let ds = UInt32(min(dataBytes, UInt64(UInt32.max - 36)))
    var d = Data(capacity: 44)
    d.append(contentsOf: Array("RIFF".utf8)); d.appendLE(ds + 36); d.append(contentsOf: Array("WAVE".utf8))
    d.append(contentsOf: Array("fmt ".utf8)); d.appendLE(UInt32(16)); d.appendLE(UInt16(1)); d.appendLE(UInt16(channels))
    d.appendLE(UInt32(sampleRate)); d.appendLE(UInt32(sampleRate * channels * 2)); d.appendLE(UInt16(channels * 2)); d.appendLE(UInt16(16))
    d.append(contentsOf: Array("data".utf8)); d.appendLE(ds)
    return d
  }

  func write(_ pcm: UnsafePointer<Int16>, frames: Int) throws {
    let bytes = frames * channels * 2
    try handle.write(contentsOf: Data(bytes: pcm, count: bytes))
    dataBytes += UInt64(bytes)
  }

  func finish() throws {
    try handle.seek(toOffset: 0)
    try handle.write(contentsOf: header(dataBytes: dataBytes))
    try handle.synchronize()
    try handle.close()
  }
}

/// AAC-LC を AVAssetWriter で .m4a に書く。【仮説: 実機で要確認】
final class AacSink: PcmSink {
  private let writer: AVAssetWriter
  private let input: AVAssetWriterInput
  private let format: AVAudioFormat
  private var frames: Int64 = 0

  init(path: String, sampleRate: Int, channels: Int, bitrate: Int) throws {
    let url = URL(fileURLWithPath: path)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? FileManager.default.removeItem(at: url)
    writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: channels,
      AVEncoderBitRateKey: bitrate,
    ]
    input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    guard writer.canAdd(input) else { throw AudioEngineError.message("cannot add audio input") }
    writer.add(input)
    guard let f = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: Double(sampleRate), channels: AVAudioChannelCount(channels), interleaved: true) else {
      throw AudioEngineError.message("bad format")
    }
    format = f
    guard writer.startWriting() else { throw writer.error ?? AudioEngineError.message("startWriting failed") }
    writer.startSession(atSourceTime: .zero)
  }

  func write(_ pcm: UnsafePointer<Int16>, frames n: Int) throws {
    guard let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(n)) else { return }
    buf.frameLength = AVAudioFrameCount(n)
    memcpy(buf.int16ChannelData![0], pcm, n * Int(format.channelCount) * 2)
    var asbd = format.streamDescription.pointee
    var fmtDesc: CMAudioFormatDescription?
    CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &fmtDesc)
    guard let fd = fmtDesc else { throw AudioEngineError.message("format description") }
    var sample: CMSampleBuffer?
    let pts = CMTime(value: frames, timescale: CMTimeScale(format.sampleRate))
    var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: CMTimeScale(format.sampleRate)), presentationTimeStamp: pts, decodeTimeStamp: .invalid)
    CMSampleBufferCreate(allocator: nil, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil, refcon: nil,
                         formatDescription: fd, sampleCount: n, sampleTimingEntryCount: 1, sampleTimingArray: &timing,
                         sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &sample)
    guard let sb = sample else { throw AudioEngineError.message("sample buffer") }
    CMSampleBufferSetDataBufferFromAudioBufferList(sb, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, bufferList: buf.audioBufferList)
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.005) }
    guard input.append(sb) else { throw writer.error ?? AudioEngineError.message("append failed") }
    frames += Int64(n)
  }

  func finish() throws {
    input.markAsFinished()
    let sem = DispatchSemaphore(value: 0)
    writer.finishWriting { sem.signal() }
    sem.wait()
    if writer.status == .failed { throw writer.error ?? AudioEngineError.message("finishWriting failed") }
  }
}

/// measuredLufs / measuredTruePeakDb は書き出したファイル（出力）の測定値。
/// inputLufs は調整前のミックス（ラウドネス調整が無効なら測らないので -120）。
struct RenderResult {
  let path: String
  let frames: Int64
  let measuredLufs: Double
  let measuredTruePeakDb: Double
  let appliedGainDb: Double
  let inputLufs: Double
}

/// オフラインレンダリング（AUDIO_DESIGN.md §8）。ラウドネス制御は LoudnessRenderer（§8.2）。
/// 測定パス → （必要ならリミッター込みの測り直し）→ ミックス → ゲイン → リミッター → エンコード
final class RenderJob {
  private let doc: RenderDocument
  private let outPath: String
  private let format: String
  private let bitrate: Int
  private let onProgress: (Double, String) -> Void
  var cancelled = false
  private let block = 4096

  init(doc: RenderDocument, outPath: String, format: String, bitrate: Int, onProgress: @escaping (Double, String) -> Void) {
    self.doc = doc; self.outPath = outPath; self.format = format; self.bitrate = bitrate; self.onProgress = onProgress
  }

  func run() throws -> RenderResult {
    let mixer = Mixer(doc: doc)
    let r = LoudnessRenderer(doc: doc, mixer: mixer, block: block, isCancelled: { [unowned self] in self.cancelled }, onProgress: onProgress)
    let ch = r.channels
    let gainDb = try r.solveGain()
    let sink: PcmSink = format == "wav"
      ? try WavSink(path: outPath, sampleRate: doc.sampleRate, channels: ch)
      : try AacSink(path: outPath, sampleRate: doc.sampleRate, channels: ch, bitrate: bitrate)
    let pcm = UnsafeMutablePointer<Int16>.allocate(capacity: block * ch)
    defer { pcm.deallocate() }
    let out = try r.render(gainDb: gainDb) { buf, offset, frames in
      var k = 0
      for i in (offset * ch)..<((offset + frames) * ch) {
        pcm[k] = Int16((max(-1, min(1, buf[i])) * 32767).rounded())
        k += 1
      }
      try sink.write(pcm, frames: frames)
    }
    try sink.finish()
    onProgress(1, "done")
    return RenderResult(path: outPath, frames: doc.totalFrames, measuredLufs: out.lufs, measuredTruePeakDb: out.truePeakDb,
                        appliedGainDb: gainDb, inputLufs: r.inputLufs)
  }
}
