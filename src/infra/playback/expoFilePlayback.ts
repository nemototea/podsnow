import { createAudioPlayer } from 'expo-audio';

import { smp, type Smp } from '@/domain/time';
import type { FilePlaybackPort, FilePlaybackStatus } from '@/services/audio/FilePlaybackPort';

const SAMPLE_RATE = 48000;

export function createExpoFilePlayback(): FilePlaybackPort {
  const player = createAudioPlayer(null, { updateInterval: 250 });
  let duration = smp(0);
  const listeners = new Set<(status: FilePlaybackStatus) => void>();
  const sub = player.addListener('playbackStatusUpdate', (status) => {
    if (duration === 0 && status.duration > 0) {
      duration = smp(Math.round(status.duration * SAMPLE_RATE));
    }
    const payload: FilePlaybackStatus = {
      playing: status.playing,
      position: smp(Math.round(status.currentTime * SAMPLE_RATE)),
      duration,
      ended: status.didJustFinish,
      // expo-audio 57.0.5 の AudioStatus: isLoaded / isBuffering / error（Issue #185）
      loading: !status.isLoaded || status.isBuffering,
      failed: status.error !== null && status.error !== undefined,
    };
    listeners.forEach((fn) => fn(payload));
  });
  return {
    async load(uri: string, nextDuration: Smp) {
      player.pause();
      player.replace({ uri });
      duration = nextDuration;
      // 読み込み前の位置合わせが失敗しても、読み込みの失敗とはみなさない。
      // 本当の失敗（URL が切れている・通信できない）は status.error で届く（Issue #185）
      await player.seekTo(0).catch(() => undefined);
    },
    play: () => player.play(),
    pause: () => player.pause(),
    seek: (to) => player.seekTo(to / SAMPLE_RATE),
    onStatus(fn) {
      listeners.add(fn);
      return { remove: () => listeners.delete(fn) };
    },
    release() {
      sub.remove();
      listeners.clear();
      player.release();
    },
  };
}
