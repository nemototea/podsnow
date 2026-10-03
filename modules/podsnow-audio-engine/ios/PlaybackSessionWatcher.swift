import AVFoundation
import Foundation

/// 再生中の割り込み（着信・他アプリ）と出力の抜去（イヤホン・Bluetooth）を見張る（AUDIO_DESIGN.md §10.3）。
/// 止める・再開するの判断は JS の PlaybackService が持つ。ここはイベントを送り、タイムライン再生だけはその場で止める
/// （JS を待つ間にスピーカーから鳴らさないため）。
///
/// イベントは必ず「送ってから止める」。止めた通知（onPlaybackState）が先に届くと、PlaybackService は
/// 割り込みの時点で鳴っていなかったと判断し、割り込みのあとに再開しない。
///
/// 音声セッションはアプリで共有なので、録音中の割り込みもここに届く。そのとき PlaybackService は
/// 鳴らしていないので何もしない（録音側の扱いは RecorderEngine）。
final class PlaybackSessionWatcher {
  typealias Emitter = (String, [String: Any]) -> Void
  private let emit: Emitter
  private let pausePlayer: () -> Void
  private var observers: [NSObjectProtocol] = []

  init(emitter: @escaping Emitter, pausePlayer: @escaping () -> Void) {
    emit = emitter
    self.pausePlayer = pausePlayer
    let nc = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] n in
      self?.onInterruption(n)
    })
    observers.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] n in
      self?.onRouteChange(n)
    })
  }

  deinit {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
  }

  private func onInterruption(_ n: Notification) {
    guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
    switch type {
    case .began:
      emit("onPlaybackInterruption", ["type": "began", "shouldResume": false])
      pausePlayer()
    case .ended:
      var shouldResume = false
      if let o = n.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt {
        shouldResume = AVAudioSession.InterruptionOptions(rawValue: o).contains(.shouldResume)
      }
      emit("onPlaybackInterruption", ["type": "ended", "shouldResume": shouldResume])
    @unknown default:
      break
    }
  }

  private func onRouteChange(_ n: Notification) {
    guard let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
          AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
    // 入力だけの機器（有線マイク）が外れたときは止めない。直前の出力がイヤホン・Bluetooth などだったときだけ
    guard let previous = n.userInfo?[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription,
          previous.outputs.contains(where: { $0.portType != .builtInSpeaker && $0.portType != .builtInReceiver }) else { return }
    emit("onOutputDisconnected", ["reason": "old_device_unavailable"])
    pausePlayer()
  }
}
