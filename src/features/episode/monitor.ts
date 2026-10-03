import { createAudioPlayer } from 'expo-audio';

import { joinRoot } from '@/infra/files/layout';

/**
 * 収録中のジングルのモニター再生（AUDIO_DESIGN.md §5）。
 * expo-audio の AudioPlayer で内部 WAV を 1 回再生し、終わったら解放する。
 * 録音セッション（ネイティブが .playAndRecord を保持）との同居は Spike S-4 で要確認【仮説】。
 */
export function playMonitor(root: string, relPath: string): () => void {
  // 鳴り終わってもセッションを無効にさせない。録音の I/O を止めないため（AUDIO_DESIGN.md §10.1）
  const player = createAudioPlayer(
    { uri: `file://${joinRoot(root, relPath)}` },
    { keepAudioSessionActive: true },
  );
  const sub = player.addListener('playbackStatusUpdate', (s) => {
    if (s.didJustFinish) {
      sub.remove();
      player.remove();
    }
  });
  player.play();
  return () => {
    sub.remove();
    player.remove();
  };
}
