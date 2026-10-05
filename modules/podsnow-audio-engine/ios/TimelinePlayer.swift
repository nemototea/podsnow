import AVFoundation
import Foundation

/// タイムラインのリアルタイム再生（AUDIO_DESIGN.md §7）。
/// 書き出しと同じ Mixer から PCM を生成し、AVAudioSourceNode で出力 1 本に流す。
final class TimelinePlayer {
  typealias Emitter = (String, [String: Any]) -> Void
  private let emit: Emitter
  private var doc: RenderDocument?
  private var mixer: Mixer?
  private let engine = AVAudioEngine()
  private var source: AVAudioSourceNode?
  private var position: Int64 = 0
  private var pendingSeek: Int64 = -1
  private(set) var playing = false
  private var sincePos: Int64 = 0
  private let lock = NSLock()
  private let renderQueue = DispatchQueue(label: "dev.nemotea.podsnow.player.render", qos: .userInteractive)
  private var scratch = UnsafeMutablePointer<Float>.allocate(capacity: 8192)
  private var scratchCap = 8192
  /// play の要求の通し番号（メインスレッドだけで触る）。pause / stop で進め、有効化を待っている要求を無効にする。
  private var playRequest = 0
  private static let sessionQueue = DispatchQueue(label: "dev.nemotea.podsnow.player.session", qos: .userInitiated)

  init(emitter: @escaping Emitter) { emit = emitter }

  deinit { scratch.deallocate() }

  var currentFrame: Int64 { lock.lock(); defer { lock.unlock() }; return position }

  func load(_ d: RenderDocument) throws {
    stop()
    lock.lock()
    doc = d
    // 試聴として使う: 書き出しと同じゲイン → リミッターをかける（AUDIO_DESIGN.md §7.1）
    let m = Mixer(doc: d)
    m.enablePreview()
    mixer = m
    position = 0
    lock.unlock()
  }

  /// 音の仕上げを読み直さずに差し替える（§7.1）。再生中でも止めない。反映は描画スレッドの次のブロックから。
  func updateSound(_ s: TimelineSound) {
    lock.lock(); let m = mixer; lock.unlock()
    m?.updateSound(s)
  }

  /// メインスレッドから呼ぶ。音声セッションを有効にしてからエンジンを起動し、done をメインスレッドで呼ぶ。
  /// setActive はメインで呼ぶと UI が止まりうる（OS の Hang Risk 警告、Issue #229）ので、専用の直列キューで呼ぶ。
  /// 有効化を待つ間に pause / stop / load / 次の play が来たら、この要求ではエンジンを起動しない。
  func play(at frame: Int64?, done: @escaping (Error?) -> Void) {
    guard let d = doc else { done(AudioEngineError.message("no timeline loaded")); return }
    lock.lock()
    if let f = frame { position = max(0, min(d.totalFrames, f)) }
    lock.unlock()
    if playing { done(nil); return }
    playRequest += 1
    let request = playRequest
    Self.sessionQueue.async {
      // カテゴリは決めない。再生の音声モードは JS が再生の直前に当てる（AUDIO_DESIGN.md §10.2）
      do { try AVAudioSession.sharedInstance().setActive(true) } catch {
        DispatchQueue.main.async { done(error) }
        return
      }
      DispatchQueue.main.async { [weak self] in
        guard let self, request == self.playRequest, !self.playing else { done(nil); return }
        do { try self.startEngine(); done(nil) } catch { done(error) }
      }
    }
  }

  private func startEngine() throws {
    guard let d = doc, let m = mixer else { throw AudioEngineError.message("no timeline loaded") }
    let ch = m.channels
    guard let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(d.sampleRate), channels: AVAudioChannelCount(ch), interleaved: false) else {
      throw AudioEngineError.message("format")
    }
    m.reset()
    let node = AVAudioSourceNode(format: fmt) { [weak self] _, _, frameCount, abl -> OSStatus in
      guard let self else { return noErr }
      let n = Int(frameCount)
      // 非インターリーブ: チャンネルごとに別バッファ（音声スレッドなので配列は作らない）
      let outs = UnsafeMutableAudioBufferListPointer(abl)
      self.lock.lock()
      if self.pendingSeek >= 0 { self.position = self.pendingSeek; self.pendingSeek = -1; m.reset() }
      let pos = self.position
      let remain = d.totalFrames - pos
      if remain <= 0 {
        for b in outs { b.mData!.assumingMemoryBound(to: Float.self).update(repeating: 0, count: n) }
        self.lock.unlock()
        if self.playing {
          self.playing = false
          DispatchQueue.main.async { self.stopEngine(); self.emit("onPlaybackState", ["playing": false, "frame": d.totalFrames, "ended": true]) }
        }
        return noErr
      }
      let count = Int(min(Int64(n), remain))
      if count * ch > self.scratchCap { self.scratch.deallocate(); self.scratch = .allocate(capacity: count * ch); self.scratchCap = count * ch }
      do { try m.render(frame: pos, count: count, into: self.scratch) } catch { self.scratch.update(repeating: 0, count: count * ch) }
      for (c, b) in outs.enumerated() {
        let out = b.mData!.assumingMemoryBound(to: Float.self)
        let src = min(c, ch - 1)
        for i in 0..<count { out[i] = max(-1, min(1, self.scratch[i * ch + src])) }
        if count < n { (out + count).update(repeating: 0, count: n - count) }
      }
      self.position = pos + Int64(count)
      self.sincePos += Int64(count)
      let shouldEmit = self.sincePos >= Int64(d.sampleRate / 10)
      if shouldEmit { self.sincePos = 0 }
      let p = self.position
      self.lock.unlock()
      if shouldEmit { self.emit("onPosition", ["frame": p]) }
      return noErr
    }
    engine.attach(node)
    engine.connect(node, to: engine.mainMixerNode, format: fmt)
    source = node
    engine.prepare()
    try engine.start()
    playing = true
    emit("onPlaybackState", ["playing": true, "frame": position])
  }

  func pause() {
    playRequest += 1
    guard playing else { return }
    playing = false
    stopEngine()
    emit("onPlaybackState", ["playing": false, "frame": currentFrame])
  }

  func seek(to frame: Int64) {
    guard let d = doc else { return }
    let f = max(0, min(d.totalFrames, frame))
    lock.lock()
    if playing { pendingSeek = f } else { position = f }
    lock.unlock()
    emit("onPosition", ["frame": f])
  }

  func stop() {
    playRequest += 1
    playing = false
    stopEngine()
  }

  func release() {
    stop()
    lock.lock(); doc = nil; mixer = nil; lock.unlock()
  }

  private func stopEngine() {
    engine.stop()
    if let s = source { engine.detach(s); source = nil }
  }
}
