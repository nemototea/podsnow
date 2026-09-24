import type {
  FrameRange,
  ImportedAsset,
  ImportOptions,
  PodsnowAudioEngineModuleEvents,
  RenderOptions,
  SilenceOptions,
  WavInfo,
} from '../../../../modules/podsnow-audio-engine/src/PodsnowAudioEngine.types';
import type { AudioEnginePort } from '../AudioEnginePort';

type Listener = (e: never) => void;

export class FakeAudioEngine implements AudioEnginePort {
  calls: string[] = [];
  renders: { jobId: string; doc: unknown; opts: RenderOptions }[] = [];
  timelines: unknown[] = [];
  imports: ImportOptions[] = [];
  silences: FrameRange[] = [];
  wavInfo: WavInfo = { frames: 48000, sampleRate: 48000, channels: 1 };
  position = 0;
  playing = false;
  private seq = 0;
  private listeners = new Map<string, Set<Listener>>();

  async generatePeaks(src: string, dst: string) {
    this.calls.push(`peaks:${dst}`);
    return { count: 10 };
  }
  async detectSilence(_src: string, _o: SilenceOptions) {
    return this.silences;
  }
  async importAsset(_src: string, dst: string, o: ImportOptions): Promise<ImportedAsset> {
    this.calls.push(`import:${dst}`);
    this.imports.push(o);
    return { path: dst, frames: 96000, sampleRate: o.sampleRate, channels: o.channels };
  }
  async readWavInfo() {
    return this.wavInfo;
  }
  async loadTimeline(json: string) {
    this.calls.push('load');
    this.timelines.push(JSON.parse(json));
  }
  async play(at?: number | null) {
    this.playing = true;
    if (at != null) this.position = at;
    this.emit('onPlaybackState', { playing: true, frame: this.position });
  }
  async pause() {
    this.playing = false;
    this.emit('onPlaybackState', { playing: false, frame: this.position });
  }
  async seek(f: number) {
    this.position = f;
    this.emit('onPosition', { frame: f });
  }
  async unload() {
    this.calls.push('unload');
  }
  getPosition() {
    return this.position;
  }
  isPlaying() {
    return this.playing;
  }
  startRender(docJson: string, opts: RenderOptions) {
    const jobId = `job${++this.seq}`;
    this.renders.push({ jobId, doc: JSON.parse(docJson), opts });
    return jobId;
  }
  cancelRender(jobId: string) {
    this.emit('onRenderError', { jobId, message: 'cancelled', cancelled: true });
  }
  on<K extends keyof PodsnowAudioEngineModuleEvents>(
    event: K,
    listener: PodsnowAudioEngineModuleEvents[K],
  ) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as Listener);
    this.listeners.set(event, set);
    return { remove: () => set.delete(listener as Listener) };
  }
  emit<K extends keyof PodsnowAudioEngineModuleEvents>(
    event: K,
    payload: Parameters<PodsnowAudioEngineModuleEvents[K]>[0],
  ) {
    this.listeners.get(event)?.forEach((l) => (l as (e: unknown) => void)(payload));
  }
}
