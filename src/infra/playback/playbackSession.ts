import { setAudioModeAsync, type AudioMode } from 'expo-audio';

import type { PlaybackSessionPort } from '@/services/audio/PlaybackSessionPort';

/**
 * 再生の音声モード。アプリの中で `setAudioModeAsync` を呼ぶのはここだけ（AUDIO_DESIGN.md §10.2）。
 * iOS のカテゴリは `.playback`。タイムライン再生（TimelinePlayer）はカテゴリを設定しない。
 * 録音用の設定は録音側（podsnow-recorder の prepare）が行うので、ここでは録音を許さない。
 */
export const PLAYBACK_AUDIO_MODE: Readonly<AudioMode> = {
  // 他アプリの音と重ねない。Android で音声フォーカスを取り、着信で止まる。ロック画面の操作（#184）の前提
  interruptionMode: 'doNotMix',
  // 画面を消しても・他アプリへ移っても続ける（FR-EP-8）
  shouldPlayInBackground: true,
  playsInSilentMode: true,
  allowsRecording: false,
  shouldRouteThroughEarpiece: false,
};

export function createExpoPlaybackSession(): PlaybackSessionPort {
  return {
    enterPlayback: () => setAudioModeAsync(PLAYBACK_AUDIO_MODE),
  };
}
