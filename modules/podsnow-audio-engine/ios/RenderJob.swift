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

/// 出力のサンプルレートへ変換してから内側のシンクへ渡す（AUDIO_DESIGN.md §8.1、Issue #174）。
/// 変換は OS 標準の AVAudioConverter（品質は最高、アルゴリズムは Mastering）。自前の補間はしない。
/// ミックス・ラウドネス・リミッターはタイムラインのレート（48 kHz）で済ませ、最後にここで変換する。
final class ResamplingSink: PcmSink {
  private let inner: PcmSink
  private let converter: AVAudioConverter
  private let inFormat: AVAudioFormat
  private let outBuf: AVAudioPCMBuffer
  private let channels: Int

  init(inner: PcmSink, from: Int, to: Int, channels: Int, maxFrames: Int) throws {
    guard
      let i = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: Double(from), channels: AVAudioChannelCount(channels), interleaved: true),
      let o = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: Double(to), channels: AVAudioChannelCount(channels), interleaved: true),
      let conv = AVAudioConverter(from: i, to: o)
    else { throw AudioEngineError.message("cannot convert \(from) Hz to \(to) Hz") }
    conv.sampleRateConverterQuality = AVAudioQuality.max.rawValue
    conv.sampleRateConverterAlgorithm = AVSampleRateConverterAlgorithm_Mastering
    let capacity = AVAudioFrameCount((Double(maxFrames) * Double(to) / Double(from)).rounded(.up)) + 256
    guard let ob = AVAudioPCMBuffer(pcmFormat: o, frameCapacity: capacity) else { throw AudioEngineError.message("buffer") }
    self.inner = inner; self.converter = conv; self.inFormat = i; self.outBuf = ob; self.channels = channels
  }

  func write(_ pcm: UnsafePointer<Int16>, frames n: Int) throws {
    guard n > 0, let buf = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: AVAudioFrameCount(n)) else { return }
    buf.frameLength = AVAudioFrameCount(n)
    memcpy(buf.int16ChannelData![0], pcm, n * channels * 2)
    var given = false
    try drain { status in
      if given { status.pointee = .noDataNow; return nil }
      given = true
      status.pointee = .haveData
      return buf
    }
  }

  func finish() throws {
    // 変換器に残っている分（フィルタの遅れ）を出し切ってから閉じる
    try drain { status in status.pointee = .endOfStream; return nil }
    try inner.finish()
  }

  private func drain(_ input: @escaping AVAudioConverterInputBlock) throws {
    while true {
      outBuf.frameLength = 0
      var err: NSError?
      let st = converter.convert(to: outBuf, error: &err, withInputFrom: input)
      if st == .error { throw err ?? AudioEngineError.message("sample rate conversion failed") }
      if outBuf.frameLength > 0 { try inner.write(outBuf.int16ChannelData![0], frames: Int(outBuf.frameLength)) }
      // haveData は出力が一杯になっただけなので続ける
      if st != .haveData { return }
    }
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
  /// 出力ファイルのサンプルレート。doc.sampleRate と違えば最後に変換する。
  private let outputSampleRate: Int
  private let onProgress: (Double, String) -> Void
  var cancelled = false
  private let block = 4096

  init(doc: RenderDocument, outPath: String, format: String, bitrate: Int, outputSampleRate: Int, onProgress: @escaping (Double, String) -> Void) {
    self.doc = doc; self.outPath = outPath; self.format = format; self.bitrate = bitrate
    self.outputSampleRate = outputSampleRate; self.onProgress = onProgress
  }

  func run() throws -> RenderResult {
    let mixer = Mixer(doc: doc)
    let r = LoudnessRenderer(doc: doc, mixer: mixer, block: block, isCancelled: { [unowned self] in self.cancelled }, onProgress: onProgress)
    let ch = r.channels
    // 求めてあるゲイン（試聴と同じ値、AUDIO_DESIGN.md §8.4）があれば測定を飛ばす
    let cached = doc.loudnessEnabled ? doc.gainDb : nil
    let gainDb = try cached ?? r.solveGain()
    let fileSink: PcmSink = format == "wav"
      ? try WavSink(path: outPath, sampleRate: outputSampleRate, channels: ch)
      : try AacSink(path: outPath, sampleRate: outputSampleRate, channels: ch, bitrate: bitrate)
    let sink: PcmSink = outputSampleRate == doc.sampleRate
      ? fileSink
      : try ResamplingSink(inner: fileSink, from: doc.sampleRate, to: outputSampleRate, channels: ch, maxFrames: block)
    let pcm = UnsafeMutablePointer<Int16>.allocate(capacity: block * ch)
    defer { pcm.deallocate() }
    let out = try r.render(gainDb: gainDb, measured: cached == nil) { buf, offset, frames in
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
