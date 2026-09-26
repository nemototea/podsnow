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
    };
    listeners.forEach((fn) => fn(payload));
  });
  return {
    async load(uri: string, nextDuration: Smp) {
      player.pause();
      player.replace({ uri });
      duration = nextDuration;
      await player.seekTo(0);
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
