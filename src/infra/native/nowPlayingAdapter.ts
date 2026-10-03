import { PodsnowAudioEngine } from '../../../modules/podsnow-audio-engine';
import { smp, type Smp } from '@/domain/time';
import type { NowPlayingCommand, NowPlayingPort } from '@/services/audio/NowPlayingPort';

const SAMPLE_RATE = 48000;
const toSec = (f: Smp) => f / SAMPLE_RATE;

/** ロック画面・通知（AUDIO_DESIGN.md §10.5）。秒への変換はこの境界だけで行う。 */
export function createNativeNowPlaying(): NowPlayingPort {
  return {
    update(info) {
      const { labels } = info;
      void PodsnowAudioEngine.setNowPlayingAsync({
        title: info.title,
        artist: info.artist,
        artworkPath: info.artworkPath,
        durationSec: toSec(info.duration),
        positionSec: toSec(info.position),
        playing: info.playing,
        labels: {
          play: labels.play,
          pause: labels.pause,
          rewind: labels.rewind,
          forward: labels.forward,
          stop: labels.stop,
          channelName: labels.channelName,
          channelDescription: labels.channelDescription,
        },
      }).catch(() => undefined);
    },
    clear() {
      void PodsnowAudioEngine.clearNowPlayingAsync().catch(() => undefined);
    },
    onCommand(fn) {
      const sub = PodsnowAudioEngine.addListener('onRemoteCommand', (e) => {
        let command: NowPlayingCommand;
        if (e.command === 'seek') {
          command = { type: 'seek', position: smp(Math.round((e.positionSec ?? 0) * SAMPLE_RATE)) };
        } else {
          command = { type: e.command };
        }
        fn(command);
      });
      return { remove: () => sub.remove() };
    },
  };
}
