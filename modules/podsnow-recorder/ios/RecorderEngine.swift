import AVFoundation
import Foundation

/// AVAudioEngine の入力タップから Int16 PCM を取り出し、WavWriter に書く録音エンジン。
/// Audio Session の構成、割り込み・ルート変更・メディアサービスリセットの観測も担う（AUDIO_DESIGN.md §3.1, §4）。
/// 録音前の入力モニター（ファイルに書かず、レベルだけ出す）も同じタップで行う（§3.6、Issue #169）。
final class RecorderEngine {
  enum State: String {
    case idle, prepared, monitoring, recording, paused, interrupted, stopping
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
  /// 書き込み先。writeQueue の上でだけ読み書きする。nil の間はモニター（§3.6）。
  private var writer: WavWriter?
  private let writeQueue = DispatchQueue(label: "dev.nemotea.podsnow.recorder.write", qos: .userInitiated)
  private var paused = false
  private var lastLevelEmit = Date.distantPast
  private var lastDiskCheck = Date.distantPast
  private var observers: [NSObjectProtocol] = []
  private var tapInstalled = false
  /// 音声セッションの操作（setCategory / setActive など）はこの直列キューで行う。メインスレッドで呼ぶと
  /// UI が止まりうる（OS の Hang Risk 警告、Issue #231）。エンジン・タップ・state はメインスレッドで扱う。
  private static let sessionQueue = DispatchQueue(label: "dev.nemotea.podsnow.recorder.session", qos: .userInitiated)
  /// release のたびに進める。セッションの操作を待つ間に release されたら、続きを行わない。
  private var generation = 0

  init(emitter: @escaping Emitter) {
    self.emit = emitter
    installObservers()
  }

  deinit {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
  }

  // MARK: - Public API

  /// 以下の公開 API はメインスレッドから呼び、done もメインスレッドで呼ぶ。
  func prepare(_ config: Config, done: @escaping (Error?) -> Void) {
    guard state == .idle || state == .prepared else {
      done(RecorderError.invalidState("prepare", state)); return
    }
    self.config = config
    afterSession({
      try RecorderEngine.configureSession(preferredInputUid: config.inputUid, sampleRate: config.sampleRate)
    }, {
      guard self.state == .idle || self.state == .prepared else {
        throw RecorderError.invalidState("prepare", self.state)
      }
      guard let fmt = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: config.sampleRate, channels: AVAudioChannelCount(config.channels), interleaved: true) else {
        throw RecorderError.message("unsupported format")
      }
      self.targetFormat = fmt
      self.state = .prepared
    }, done: done)
  }

  /// 録音前の入力モニターを始める（§3.6）。ファイルは開かず、onLevel（frames = 0）だけ出す。
  /// セッションは prepare() で録音用に設定済み（録音側が持つ。§10.1）。
  func startMonitor(done: @escaping (Error?) -> Void) {
    guard state == .prepared else { done(RecorderError.invalidState("startMonitor", state)); return }
    guard targetFormat != nil else { done(RecorderError.message("not prepared")); return }
    afterSession({ try AVAudioSession.sharedInstance().setActive(true) }, {
      guard self.state == .prepared else { throw RecorderError.invalidState("startMonitor", self.state) }
      guard let target = self.targetFormat else { throw RecorderError.message("not prepared") }
      self.paused = false
      try self.installTap(target: target)
      self.engine.prepare()
      do {
        try self.engine.start()
      } catch {
        self.removeTap()
        throw error
      }
      self.state = .monitoring
    }, done: done)
  }

  /// モニターを止める。マイクを離す（OS のマイク使用中の表示が消える【仮説】）。セッションは無効にしない（§10.1）。
  func stopMonitor() throws {
    guard state == .monitoring else { throw RecorderError.invalidState("stopMonitor", state) }
    removeTap()
    if engine.isRunning { engine.stop() }
    state = .prepared
  }

  func start(path: String, done: @escaping (Error?) -> Void) {
    guard state == .prepared || state == .interrupted || state == .monitoring else {
      done(RecorderError.invalidState("start", state)); return
    }
    guard targetFormat != nil else { done(RecorderError.message("not prepared")); return }
    // 有効にしてからファイルを作る。有効にできなければファイルは作らない。
    afterSession({ try AVAudioSession.sharedInstance().setActive(true) }, {
      try self.startWriting(path: path)
    }, done: done)
  }

  /// start の続き（メインスレッド）。待つ間に割り込みなどで state が変わり得るので、条件を確かめ直す。
  private func startWriting(path: String) throws {
    guard state == .prepared || state == .interrupted || state == .monitoring else {
      throw RecorderError.invalidState("start", state)
    }
    guard let target = targetFormat else { throw RecorderError.message("not prepared") }
    // ヘッダを書き終えた writer を writeQueue の上で渡す。write() は writeQueue で writer を見るので、
    // モニターから切り替えるときも、渡したあとに変換したバッファから書き込まれる。
    // 作成に失敗したら例外のまま返し、モニターは続く。
    let w = try WavWriter(path: path, sampleRate: Int(config.sampleRate), channels: config.channels, flushInterval: config.headerFlushInterval)
    writeQueue.sync { writer = w; paused = false }
    if state == .monitoring {
      // タップとエンジンは動かしたまま切り替える（デバイスの再初期化によるギャップを作らない）。
      state = .recording
      return
    }
    do {
      try installTap(target: target)
      engine.prepare()
      try engine.start()
    } catch {
      // 始まらなかった。ヘッダだけのファイルを閉じて返す（Segment は JS 側でも開かれていない）。
      removeTap()
      writeQueue.sync {
        try? writer?.finalize()
        writer = nil
      }
      throw error
    }
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

  /// done はセッションを無効にし終えてから呼ぶ（次の持ち主が有効にしたあとで無効にしないように）。
  func release(done: (() -> Void)? = nil) {
    generation += 1
    if state == .recording || state == .paused || state == .interrupted {
      _ = try? stop(reason: "stop")
    }
    if state == .monitoring { try? stopMonitor() }
    removeTap()
    engine.stop()
    state = .idle
    RecorderEngine.sessionQueue.async {
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      DispatchQueue.main.async { done?() }
    }
  }

  var frames: UInt64 {
    writeQueue.sync { writer?.frames ?? 0 }
  }

  // MARK: - Session

  /// session を専用キューで行い、続き（next）をメインスレッドで行ってから done を呼ぶ。
  /// 待つ間に release されたら続きは行わない。state の変化は next の中で確かめ直す。
  private func afterSession(_ session: @escaping () throws -> Void, _ next: @escaping () throws -> Void, done: @escaping (Error?) -> Void) {
    let gen = generation
    RecorderEngine.sessionQueue.async {
      do {
        try session()
      } catch {
        DispatchQueue.main.async { done(error) }
        return
      }
      DispatchQueue.main.async { [weak self] in
        guard let self, gen == self.generation else { done(RecorderError.message("released")); return }
        do {
          try next()
          done(nil)
        } catch {
          done(error)
        }
      }
    }
  }

  /// sessionQueue の上で呼ぶ。self.config は読まない（メインスレッドの値なので引数で受け取る）。
  private static func configureSession(preferredInputUid: String?, sampleRate: Double) throws {
    let session = AVAudioSession.sharedInstance()
    var options: AVAudioSession.CategoryOptions = [.allowBluetoothA2DP, .defaultToSpeaker]
    if let uid = preferredInputUid,
       let port = session.availableInputs?.first(where: { $0.uid == uid }),
       port.portType == .bluetoothHFP {
      // Bluetooth マイクを使うときだけ HFP を許可する（AUDIO_DESIGN.md §3.1）
      options.insert(.allowBluetooth)
    }
    try session.setCategory(.playAndRecord, mode: .default, options: options)
    try session.setPreferredSampleRate(sampleRate)
    try session.setPreferredIOBufferDuration(0.02)
    if let uid = preferredInputUid, let port = session.availableInputs?.first(where: { $0.uid == uid }) {
      try session.setPreferredInput(port)
    } else {
      try session.setPreferredInput(nil)
    }
    try session.setActive(true)
  }

  func setInput(uid: String?, done: @escaping (Error?) -> Void) {
    config.inputUid = uid
    let rate = config.sampleRate
    afterSession({
      try RecorderEngine.configureSession(preferredInputUid: uid, sampleRate: rate)
    }, {
      if self.state == .recording || self.state == .paused || self.state == .monitoring, let target = self.targetFormat {
        // 入力フォーマットが変わり得るのでタップを張り直す
        self.removeTap()
        try self.installTap(target: target)
        if !self.engine.isRunning { try self.engine.start() }
      }
    }, done: done)
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
    if state == .monitoring {
      // モニターは変換も書き込みもしない。レベルだけ writeQueue で間引いて出す。
      let (peak, rms) = RecorderEngine.levels(of: buffer)
      writeQueue.async { [weak self] in self?.emitMonitorLevel(peak: peak, rms: rms) }
      return
    }
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

  /// writeQueue の上で呼ぶ。録音へ切り替わったあと（writer がある）は録音側のレベルに任せる。
  private func emitMonitorLevel(peak: Float, rms: Float) {
    guard writer == nil else { return }
    let now = Date()
    guard now.timeIntervalSince(lastLevelEmit) >= config.levelInterval else { return }
    lastLevelEmit = now
    emit("onLevel", [
      "peakDb": RecorderEngine.db(peak), "rmsDb": RecorderEngine.db(rms),
      "frames": 0, "clipped": peak >= 0.99,
    ])
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
      // モニターは書いていないので、止めて prepared に戻すだけ（再開するかは JS が決める）。
      if state == .monitoring { try? stopMonitor() }
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
    // 入力フォーマットが変わった（デバイス抜き差し等）。録音中・モニター中ならタップを張り直して続行する。
    guard state == .recording || state == .paused || state == .monitoring, let target = targetFormat else { return }
    do {
      removeTap()
      try installTap(target: target)
      if !engine.isRunning { try engine.start() }
    } catch {
      emit("onError", ["message": "reconfigure: \(error.localizedDescription)", "code": "reconfigure"])
      if state == .monitoring {
        try? stopMonitor()
      } else {
        _ = try? stop(reason: "route_change")
      }
    }
  }

  private func handleMediaReset() {
    if state == .recording || state == .paused {
      removeTap()
      engine.stop()
      _ = closeWriter(reason: "media_reset")
      state = .interrupted
    }
    if state == .monitoring { try? stopMonitor() }
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
