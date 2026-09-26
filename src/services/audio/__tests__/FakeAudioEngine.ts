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
  /** 読み込んだタイムラインの長さ（未読み込みなら null）。 */
  totalFrames: number | null = null;
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
    const doc = JSON.parse(json) as { totalFrames?: number };
    this.timelines.push(doc);
    // ネイティブ（TimelinePlayer）と同じく、読み込むと位置は先頭に戻る
    this.totalFrames = doc.totalFrames ?? 0;
    this.position = 0;
  }
  async play(at?: number | null) {
    this.calls.push(`play:${at ?? 'null'}`);
    this.playing = true;
    if (at != null) this.position = at;
    this.emit('onPlaybackState', { playing: true, frame: this.position });
    // ネイティブと同じく、末尾から鳴らすと何も出さずにすぐ終わる
    if (this.totalFrames !== null && this.position >= this.totalFrames) {
      this.playing = false;
      this.position = this.totalFrames;
      this.emit('onPlaybackState', { playing: false, frame: this.position, ended: true });
    }
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
