import ExpoModulesCore
import MediaPlayer
import UIKit

struct NowPlayingInfoRecord: Record {
  @Field var title: String = ""
  @Field var artist: String = ""
  @Field var artworkPath: String?
  @Field var durationSec: Double = 0
  @Field var positionSec: Double = 0
  @Field var playing: Bool = false
}

/// ロック画面・コントロールセンターの再生表示と操作（AUDIO_DESIGN.md §10.5）。
/// ファイル再生（expo-audio）とタイムライン再生（TimelinePlayer）の両方をここで出す。
/// 何を出すかは JS の PlaybackService が決める。操作は鳴らす側を触らず、`onRemoteCommand` で JS に送る。
///
/// expo-audio の `setActiveForLockScreen` は使わない（同じ MPRemoteCommandCenter を取り合うため）。
final class NowPlaying {
  typealias Emitter = (String, [String: Any]) -> Void
  private let emit: Emitter
  private var targets: [(MPRemoteCommand, Any)] = []
  private var artworkPath: String?
  private var artwork: MPMediaItemArtwork?

  init(emitter: @escaping Emitter) {
    emit = emitter
  }

  func update(_ info: NowPlayingInfoRecord) {
    if targets.isEmpty { enableCommands() }
    var d: [String: Any] = [
      MPMediaItemPropertyTitle: info.title,
      MPMediaItemPropertyArtist: info.artist,
      MPMediaItemPropertyPlaybackDuration: info.durationSec,
      // 位置は状態が変わったときだけ届く。間は OS が速度から進める
      MPNowPlayingInfoPropertyElapsedPlaybackTime: info.positionSec,
      MPNowPlayingInfoPropertyPlaybackRate: info.playing ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
    ]
    if let a = loadArtwork(info.artworkPath) { d[MPMediaItemPropertyArtwork] = a }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = d
  }

  func clear() {
    disableCommands()
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    artworkPath = nil
    artwork = nil
  }

  private func enableCommands() {
    let c = MPRemoteCommandCenter.shared()
    add(c.playCommand) { [weak self] _ in self?.send("play") ?? .commandFailed }
    add(c.pauseCommand) { [weak self] _ in self?.send("pause") ?? .commandFailed }
    // ヘッドホン・Bluetooth の再生ボタン
    add(c.togglePlayPauseCommand) { [weak self] _ in self?.send("toggle") ?? .commandFailed }
    c.skipBackwardCommand.preferredIntervals = [15]
    add(c.skipBackwardCommand) { [weak self] _ in self?.send("skipBackward") ?? .commandFailed }
    c.skipForwardCommand.preferredIntervals = [30]
    add(c.skipForwardCommand) { [weak self] _ in self?.send("skipForward") ?? .commandFailed }
    add(c.changePlaybackPositionCommand) { [weak self] e in
      guard let e = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      return self?.send("seek", ["positionSec": e.positionTime]) ?? .commandFailed
    }
    // 前後の回への移動は持たない（15 秒戻る / 30 秒進むを出すため）
    c.nextTrackCommand.isEnabled = false
    c.previousTrackCommand.isEnabled = false
  }

  private func add(_ command: MPRemoteCommand, _ handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
    command.isEnabled = true
    targets.append((command, command.addTarget(handler: handler)))
  }

  /// addTarget(handler:) が返した値で外す（removeTarget(self) ではクロージャのハンドラは外れない）。
  private func disableCommands() {
    for (command, target) in targets {
      command.removeTarget(target)
      command.isEnabled = false
    }
    targets = []
  }

  private func send(_ command: String, _ extra: [String: Any] = [:]) -> MPRemoteCommandHandlerStatus {
    var body = extra
    body["command"] = command
    emit("onRemoteCommand", body)
    return .success
  }

  private func loadArtwork(_ path: String?) -> MPMediaItemArtwork? {
    guard let path else {
      artworkPath = nil
      artwork = nil
      return nil
    }
    if path == artworkPath { return artwork }
    artworkPath = path
    artwork = UIImage(contentsOfFile: path).map { image in
      MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }
    return artwork
  }
}
