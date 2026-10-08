import { PodsnowAudioEngine } from '../../../modules/podsnow-audio-engine';
import type { AudioEnginePort } from '@/services/audio/AudioEnginePort';

export function createNativeAudioEngine(): AudioEnginePort {
  return {
    generatePeaks: (s, d, n) => PodsnowAudioEngine.generatePeaksAsync(s, d, n),
    detectSilence: (s, o) => PodsnowAudioEngine.detectSilenceAsync(s, o),
    importAsset: (s, d, o) => PodsnowAudioEngine.importAssetAsync(s, d, o),
    readWavInfo: (p) => PodsnowAudioEngine.readWavInfoAsync(p),
    loadTimeline: (j) => PodsnowAudioEngine.loadTimelineAsync(j),
    updateTimelineSound: (j) => PodsnowAudioEngine.updateTimelineSoundAsync(j),
    play: (f) => PodsnowAudioEngine.playAsync(f ?? null),
    pause: () => PodsnowAudioEngine.pauseAsync(),
    seek: (f) => PodsnowAudioEngine.seekAsync(f),
    unload: () => PodsnowAudioEngine.unloadAsync(),
    getPosition: () => PodsnowAudioEngine.getPosition(),
    isPlaying: () => PodsnowAudioEngine.isPlaying(),
    startRender: (j, o) => PodsnowAudioEngine.startRender(j, o),
    cancelRender: (id) => PodsnowAudioEngine.cancelRender(id),
    measureLoudness: (j) => PodsnowAudioEngine.measureLoudness(j),
    cancelMeasure: (id) => PodsnowAudioEngine.cancelMeasure(id),
    on: (event, listener) => {
      const sub = PodsnowAudioEngine.addListener(event, listener);
      return { remove: () => sub.remove() };
    },
  };
}
