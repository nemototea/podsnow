import { PodsnowRecorder } from '../../../modules/podsnow-recorder';
import type { RecorderPort } from '@/services/recording/RecorderPort';

/** ネイティブモジュールを RecorderPort に適合させる。 */
export function createNativeRecorder(): RecorderPort {
  return {
    requestPermissions: () => PodsnowRecorder.requestPermissionsAsync(),
    getPermissions: () => PodsnowRecorder.getPermissionsAsync(),
    prepare: (c) => PodsnowRecorder.prepareAsync(c),
    start: (p) => PodsnowRecorder.startAsync(p),
    pause: () => PodsnowRecorder.pauseAsync(),
    resume: () => PodsnowRecorder.resumeAsync(),
    stop: () => PodsnowRecorder.stopAsync(),
    release: () => PodsnowRecorder.releaseAsync(),
    getState: () => PodsnowRecorder.getState(),
    getFrames: () => PodsnowRecorder.getFrames(),
    getInputs: () => PodsnowRecorder.getInputsAsync(),
    setInput: (uid) => PodsnowRecorder.setInputAsync(uid),
    getCurrentInput: () => PodsnowRecorder.getCurrentInputAsync(),
    isSpeakerOutput: () => PodsnowRecorder.isSpeakerOutputAsync(),
    repairWavHeader: (p) => PodsnowRecorder.repairWavHeaderAsync(p),
    getAvailableDiskBytes: (p) => PodsnowRecorder.getAvailableDiskBytesAsync(p),
    on: (event, listener) => {
      const sub = PodsnowRecorder.addListener(event, listener);
      return { remove: () => sub.remove() };
    },
  };
}
