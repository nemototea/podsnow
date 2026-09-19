import AVFoundation
import Foundation

/// AVAudioEngine の入力タップから Int16 PCM を取り出し、WavWriter に書く録音エンジン。
/// Audio Session の構成、割り込み・ルート変更・メディアサービスリセットの観測も担う（AUDIO_DESIGN.md §3.1, §4）。
final class RecorderEngine {
  enum State: String {
    case idle, prepared, recording, paused, interrupted, stopping
  }

  struct Config {
    var sampleRate: Double = 48000
    var channels: Int = 1
    var inputUid: String?
    var diskLowThresholdBytes: UInt64 = 30 * 1024 * 1024
    var headerFlushInterval: TimeInterval = 1.0
    var levelInterval: TimeInterval = 0.05
  }

  typealias Emitter = (_ event: String, _ body: [String: Any]) -> Void

  private(set) var state: State = .idle {
    didSet { if oldValue != state { emit("onStateChange", ["state": state.rawValue]) } }
  }
  private(set) var config = Config()
  private let emit: Emitter

  private let engine = AVAudioEngine()
  private var converter: AVAudioConverter?
  private var targetFormat: AVAudioFormat?
  private var writer: WavWriter?
  private let writeQueue = DispatchQueue(label: "dev.nemotea.podsnow.recorder.write", qos: .userInitiated)
  private var paused = false
  private var lastLevelEmit = Date.distantPast
  private var lastDiskCheck = Date.distantPast
  private var observers: [NSObjectProtocol] = []
  private var tapInstalled = false

  init(emitter: @escaping Emitter) {
    self.emit = emitter
    installObservers()
  }

  deinit {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
  }

  // MARK: - Public API

  func prepare(_ config: Config) throws {
    guard state == .idle || state == .prepared else {
      throw RecorderError.invalidState("prepare", state)
    }
    self.config = config
    try configureSession(preferredInputUid: config.inputUid)
    guard let fmt = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: config.sampleRate, channels: AVAudioChannelCount(config.channels), interleaved: true) else {
      throw RecorderError.message("unsupported format")
    }
    targetFormat = fmt
    state = .prepared
  }

  func start(path: String) throws {
    guard state == .prepared || state == .interrupted else {
      throw RecorderError.invalidState("start", state)
    }
    guard let target = targetFormat else { throw RecorderError.message("not prepared") }
    try AVAudioSession.sharedInstance().setActive(true)
    let w = try WavWriter(path: path, sampleRate: Int(config.sampleRate), channels: config.channels, flushInterval: config.headerFlushInterval)
    writer = w
    paused = false
    try installTap(target: target)
    engine.prepare()
    try engine.start()
    state = .recording
  }

  func pause() throws {
    guard state == .recording else { throw RecorderError.invalidState("pause", state) }
    paused = true
    writeQueue.sync { try? self.writer?.flushHeader() }
    state = .paused
  }

  func resume() throws {
    guard state == .paused else { throw RecorderError.invalidState("resume", state) }
    if !engine.isRunning { try engine.start() }
    paused = false
    state = .recording
  }

  /// 現在の Segment を確定して閉じる。
  @discardableResult
  func stop(reason: String = "stop") throws -> [String: Any] {
    guard state == .recording || state == .paused || state == .interrupted else {
      throw RecorderError.invalidState("stop", state)
    }
    state = .stopping
    removeTap()
    if engine.isRunning { engine.stop() }
    let result = closeWriter(reason: reason)
    state = .prepared
    return result ?? [:]
  }

  func release() {
    if state == .recording || state == .paused || state == .interrupted {
      _ = try? stop(reason: "stop")
    }
    removeTap()
    engine.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    state = .idle
  }

  var frames: UInt64 {
    writeQueue.sync { writer?.frames ?? 0 }
  }

  // MARK: - Session

  private func configureSession(preferredInputUid: String?) throws {
    let session = AVAudioSession.sharedInstance()
    var options: AVAudioSession.CategoryOptions = [.allowBluetoothA2DP, .defaultToSpeaker]
    if let uid = preferredInputUid,
       let port = session.availableInputs?.first(where: { $0.uid == uid }),
       port.portType == .bluetoothHFP {
      // Bluetooth マイクを使うときだけ HFP を許可する（AUDIO_DESIGN.md §3.1）
      options.insert(.allowBluetooth)
    }
    try session.setCategory(.playAndRecord, mode: .default, options: options)
    try session.setPreferredSampleRate(config.sampleRate)
    try session.setPreferredIOBufferDuration(0.02)
    if let uid = preferredInputUid, let port = session.availableInputs?.first(where: { $0.uid == uid }) {
      try session.setPreferredInput(port)
    } else {
      try session.setPreferredInput(nil)
    }
    try session.setActive(true)
  }

  func setInput(uid: String?) throws {
    config.inputUid = uid
    try configureSession(preferredInputUid: uid)
    if state == .recording || state == .paused, let target = targetFormat {
      // 入力フォーマットが変わり得るのでタップを張り直す
      removeTap()
      try installTap(target: target)
      if !engine.isRunning { try engine.start() }
    }
  }

  static func describe(_ port: AVAudioSessionPortDescription) -> [String: Any] {
    let type: String
    var lowQuality = false
    switch port.portType {
    case .builtInMic: type = "builtin"
    case .headsetMic: type = "wired"
    case .bluetoothHFP: type = "bluetooth"; lowQuality = true
    case .usbAudio: type = "usb"
    default: type = "other"
    }
    return ["uid": port.uid, "name": port.portName, "type": type, "lowQuality": lowQuality]
  }

  static func availableInputs() -> [[String: Any]] {
    (AVAudioSession.sharedInstance().availableInputs ?? []).map(describe)
  }

  static func currentInput() -> [String: Any]? {
    AVAudioSession.sharedInstance().currentRoute.inputs.first.map(describe)
  }

  static func isSpeakerOutput() -> Bool {
    AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
  }

  // MARK: - Tap

  private func installTap(target: AVAudioFormat) throws {
    let input = engine.inputNode
    let inputFormat = input.outputFormat(forBus: 0)
    guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
      throw RecorderError.message("input format unavailable (no input route?)")
    }
    guard let conv = AVAudioConverter(from: inputFormat, to: target) else {
      throw RecorderError.message("cannot convert \(inputFormat) -> \(target)")
    }
    converter = conv
    if tapInstalled { input.removeTap(onBus: 0) }
    input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
      self?.handleBuffer(buffer, target: target)
    }
    tapInstalled = true
  }

  private func removeTap() {
    if tapInstalled {
      engine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
    converter = nil
  }

  private func handleBuffer(_ buffer: AVAudioPCMBuffer, target: AVAudioFormat) {
    guard !paused, state == .recording, let conv = converter else { return }
    let (peak, rms) = RecorderEngine.levels(of: buffer)
    let ratio = target.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
    guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
    var consumed = false
    var error: NSError?
    conv.convert(to: out, error: &error) { _, status in
      if consumed {
        status.pointee = .noDataNow
        return nil
      }
      consumed = true
      status.pointee = .haveData
      return buffer
    }
    if let error {
      emit("onError", ["message": "convert: \(error.localizedDescription)", "code": "convert"])
      return
    }
    guard out.frameLength > 0, let ch = out.int16ChannelData else { return }
    let bytes = Int(out.frameLength) * Int(target.channelCount) * 2
    let data = Data(bytes: ch[0], count: bytes)
    writeQueue.async { [weak self] in
      self?.write(data, peak: peak, rms: rms)
    }
  }

  private func write(_ data: Data, peak: Float, rms: Float) {
    guard let w = writer else { return }
    do {
      try w.append(data)
    } catch {
      emit("onError", ["message": "write: \(error.localizedDescription)", "code": "write"])
      DispatchQueue.main.async { [weak self] in _ = try? self?.stop(reason: "error") }
      return
    }
    let now = Date()
    if now.timeIntervalSince(lastLevelEmit) >= config.levelInterval {
      lastLevelEmit = now
      emit("onLevel", [
        "peakDb": RecorderEngine.db(peak), "rmsDb": RecorderEngine.db(rms),
        "frames": w.frames, "clipped": peak >= 0.99,
      ])
    }
    if now.timeIntervalSince(lastDiskCheck) >= 5 {
      lastDiskCheck = now
      if let free = RecorderEngine.availableBytes(forPath: w.path), free < config.diskLowThresholdBytes {
        emit("onDiskLow", ["availableBytes": free])
        DispatchQueue.main.async { [weak self] in _ = try? self?.stop(reason: "disk_low") }
      }
    }
  }

  private func closeWriter(reason: String) -> [String: Any]? {
    var result: [String: Any]?
    writeQueue.sync {
      guard let w = writer else { return }
      do { try w.finalize() } catch {
        emit("onError", ["message": "finalize: \(error.localizedDescription)", "code": "finalize"])
        _ = try? WavWriter.repairHeader(path: w.path)
      }
      result = [
        "path": w.path, "frames": w.frames, "bytes": w.fileBytes,
        "sampleRate": w.sampleRate, "channels": w.channels,
      ]
      writer = nil
    }
    if var r = result {
      r["reason"] = reason
      emit("onSegmentClosed", r)
    }
    return result
  }

  // MARK: - Observers

  private func installObservers() {
    let nc = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] n in
      self?.handleInterruption(n)
    })
    observers.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] n in
      self?.handleRouteChange(n)
    })
    observers.append(nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: .main) { [weak self] _ in
      self?.handleMediaReset()
    })
    observers.append(nc.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
      self?.handleEngineConfigurationChange()
    })
  }

  private func handleInterruption(_ n: Notification) {
    guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
    switch type {
    case .began:
      if state == .recording || state == .paused {
        // システムはすでに入力を止めている。Segment を確定してから通知する（データを宙に浮かせない）。
        removeTap()
        engine.stop()
        _ = closeWriter(reason: "interruption")
        state = .interrupted
      }
      emit("onInterruption", ["type": "began", "shouldResume": false])
    case .ended:
      var shouldResume = false
      if let o = n.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt {
        shouldResume = AVAudioSession.InterruptionOptions(rawValue: o).contains(.shouldResume)
      }
      emit("onInterruption", ["type": "ended", "shouldResume": shouldResume])
    @unknown default:
      break
    }
  }

  private func handleRouteChange(_ n: Notification) {
    let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
    let reason: String
    switch AVAudioSession.RouteChangeReason(rawValue: raw) ?? .unknown {
    case .newDeviceAvailable: reason = "new_device"
    case .oldDeviceUnavailable: reason = "old_device_unavailable"
    case .categoryChange: reason = "category_change"
    case .override: reason = "override"
    case .wakeFromSleep: reason = "wake"
    case .noSuitableRouteForCategory: reason = "no_route"
    case .routeConfigurationChange: reason = "config_change"
    default: reason = "unknown"
    }
    emit("onRouteChange", ["reason": reason, "currentInput": RecorderEngine.currentInput() as Any])
  }

  private func handleEngineConfigurationChange() {
    // 入力フォーマットが変わった（デバイス抜き差し等）。録音中ならタップを張り直して続行する。
    guard state == .recording || state == .paused, let target = targetFormat else { return }
    do {
      removeTap()
      try installTap(target: target)
      if !engine.isRunning { try engine.start() }
    } catch {
      emit("onError", ["message": "reconfigure: \(error.localizedDescription)", "code": "reconfigure"])
      _ = try? stop(reason: "route_change")
    }
  }

  private func handleMediaReset() {
    if state == .recording || state == .paused {
      removeTap()
      engine.stop()
      _ = closeWriter(reason: "media_reset")
      state = .interrupted
    }
    emit("onInterruption", ["type": "began", "shouldResume": false, "reason": "media_reset"])
    emit("onInterruption", ["type": "ended", "shouldResume": false, "reason": "media_reset"])
  }

  // MARK: - Helpers

  static func levels(of buffer: AVAudioPCMBuffer) -> (peak: Float, rms: Float) {
    let n = Int(buffer.frameLength)
    guard n > 0 else { return (0, 0) }
    var peak: Float = 0
    var sum: Float = 0
    if let f = buffer.floatChannelData {
      let ch = Int(buffer.format.channelCount)
      for c in 0..<ch {
        let p = f[c]
        for i in 0..<n {
          let v = abs(p[i])
          if v > peak { peak = v }
          sum += v * v
        }
      }
      return (peak, (sum / Float(n * ch)).squareRoot())
    }
    if let s = buffer.int16ChannelData {
      let ch = Int(buffer.format.channelCount)
      for c in 0..<ch {
        let p = s[c]
        for i in 0..<n {
          let v = abs(Float(p[i]) / 32768)
          if v > peak { peak = v }
          sum += v * v
        }
      }
      return (peak, (sum / Float(n * ch)).squareRoot())
    }
    return (0, 0)
  }

  static func db(_ linear: Float) -> Double {
    linear <= 0 ? -120 : Double(max(-120, 20 * log10(linear)))
  }

  static func availableBytes(forPath path: String) -> UInt64? {
    let dir = (path as NSString).deletingLastPathComponent
    guard let attrs = try? FileManager.default.attributesOfFileSystem(forPath: dir.isEmpty ? NSHomeDirectory() : dir),
          let free = attrs[.systemFreeSize] as? NSNumber else { return nil }
    return free.uint64Value
  }
}

enum RecorderError: Error, LocalizedError {
  case invalidState(String, RecorderEngine.State)
  case message(String)

  var errorDescription: String? {
    switch self {
    case let .invalidState(op, s): return "\(op): invalid state \(s.rawValue)"
    case let .message(m): return m
    }
  }
}
