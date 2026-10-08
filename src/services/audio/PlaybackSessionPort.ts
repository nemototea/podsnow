/**
 * 再生の音声セッション（AUDIO_DESIGN.md §10）。expo-audio を services から隔離する。
 * 実装は infra/playback/playbackSession.ts とテスト用 Fake。
 */
export interface PlaybackSessionPort {
  /**
   * 再生を始める直前に毎回呼ぶ。音声モードを再生用（§10.2）に当て直す。
   * 録音のあとに録音用の設定が残っていても、ここで再生用に戻る（§10.1）。
   */
  enterPlayback(): Promise<void>;
}
