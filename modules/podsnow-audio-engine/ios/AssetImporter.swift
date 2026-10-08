import AVFoundation
import Foundation

struct ImportedAsset {
  let path: String
  let frames: Int64
  let sampleRate: Int
  let channels: Int
}

/// 任意の音声ファイルを目標サンプルレートの 16 bit WAV に変換する（REQUIREMENTS.md FR-AST-3）。
/// AVAssetReader が OS 標準デコーダで PCM 化し、レート・チャンネル変換もリーダーの出力設定に任せる。【仮説: 実機で要確認】
enum AssetImporter {
  static func importAsset(src: String, dst: String, sampleRate: Int, channels: Int, onProgress: ((Double) -> Void)? = nil) throws -> ImportedAsset {
    let asset = AVURLAsset(url: URL(fileURLWithPath: src))
    let sem = DispatchSemaphore(value: 0)
    var tracks: [AVAssetTrack] = []
    var loadError: Error?
    asset.loadTracks(withMediaType: .audio) { t, e in
      tracks = t ?? []
      loadError = e
      sem.signal()
    }
    sem.wait()
    if let e = loadError { throw e }
    guard let track = tracks.first else { throw AudioEngineError.message("no audio track: \(src)") }
    let reader = try AVAssetReader(asset: asset)
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: channels,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false,
    ]
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { throw AudioEngineError.message("cannot read track") }
    reader.add(output)
    guard reader.startReading() else { throw reader.error ?? AudioEngineError.message("startReading failed") }
    let sink = try WavSink(path: dst, sampleRate: sampleRate, channels: channels)
    var frames: Int64 = 0
    let duration = CMTimeGetSeconds(asset.duration)
    while let sb = output.copyNextSampleBuffer() {
      guard let block = CMSampleBufferGetDataBuffer(sb) else { continue }
      var length = 0
      var ptr: UnsafeMutablePointer<Int8>?
      CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &ptr)
      if let p = ptr, length > 0 {
        let n = length / (channels * 2)
        try p.withMemoryRebound(to: Int16.self, capacity: n * channels) { try sink.write($0, frames: n) }
        frames += Int64(n)
      }
      if duration > 0 { onProgress?(min(1, Double(frames) / (duration * Double(sampleRate)))) }
    }
    if reader.status == .failed { throw reader.error ?? AudioEngineError.message("read failed") }
    try sink.finish()
    return ImportedAsset(path: dst, frames: frames, sampleRate: sampleRate, channels: channels)
  }
}
