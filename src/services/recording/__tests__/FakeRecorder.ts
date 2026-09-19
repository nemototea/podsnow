import type {
  AudioInput,
  PodsnowRecorderModuleEvents,
  RecorderConfig,
  RecorderState,
  SegmentResult,
} from '../../../../modules/podsnow-recorder/src/PodsnowRecorder.types';
import type { RecorderPort } from '../RecorderPort';

type Listener = (e: never) => void;

/** テスト用の録音モジュール。frames を手で進め、イベントを手で発火する。 */
export class FakeRecorder implements RecorderPort {
  state: RecorderState = 'idle';
  frames = 0;
  path: string | null = null;
  config: RecorderConfig | null = null;
  availableBytes = 10 * 1024 * 1024 * 1024;
  inputs: AudioInput[] = [
    { uid: 'builtin', name: 'iPhone マイク', type: 'builtin', lowQuality: false },
  ];
  speaker = true;
  repaired: string[] = [];
  calls: string[] = [];
  private listeners = new Map<string, Set<Listener>>();

  async prepare(config: RecorderConfig) {
    this.calls.push('prepare');
    this.config = config;
    this.state = 'prepared';
  }
  async start(path: string) {
    this.calls.push(`start:${path.split('/').slice(-1)[0]}`);
    if (this.state !== 'prepared' && this.state !== 'interrupted')
      throw new Error(`bad state ${this.state}`);
    this.path = path;
    this.frames = 0;
    this.state = 'recording';
  }
  async pause() {
    this.calls.push('pause');
    this.state = 'paused';
  }
  async resume() {
    this.calls.push('resume');
    this.state = 'recording';
  }
  async stop(): Promise<SegmentResult> {
    this.calls.push('stop');
    const r = this.result();
    this.state = 'prepared';
    // ネイティブは stop() の解決前に onSegmentClosed を出す
    this.emit('onSegmentClosed', { ...r, reason: 'stop' });
    return r;
  }
  async release() {
    this.calls.push('release');
    this.state = 'idle';
  }
  getState() {
    return this.state;
  }
  getFrames() {
    return this.frames;
  }
  async getInputs() {
    return this.inputs;
  }
  async setInput() {}
  async getCurrentInput() {
    return this.inputs[0] ?? null;
  }
  async isSpeakerOutput() {
    return this.speaker;
  }
  async repairWavHeader(path: string): Promise<SegmentResult> {
    this.repaired.push(path);
    return { path, frames: 4800, bytes: 44 + 4800 * 2, sampleRate: 48000, channels: 1 };
  }
  async getAvailableDiskBytes() {
    return this.availableBytes;
  }
  on<K extends keyof PodsnowRecorderModuleEvents>(
    event: K,
    listener: PodsnowRecorderModuleEvents[K],
  ) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as Listener);
    this.listeners.set(event, set);
    return { remove: () => set.delete(listener as Listener) };
  }

  // ---- テストからの操作 ----
  emit<K extends keyof PodsnowRecorderModuleEvents>(
    event: K,
    payload: Parameters<PodsnowRecorderModuleEvents[K]>[0],
  ) {
    this.listeners.get(event)?.forEach((l) => (l as (e: unknown) => void)(payload));
  }
  /** 割り込みをシミュレート: ネイティブは Segment を閉じてから通知する。 */
  interrupt() {
    const r = this.result();
    this.state = 'interrupted';
    this.emit('onSegmentClosed', { ...r, reason: 'interruption' });
    this.emit('onInterruption', { type: 'began', shouldResume: false });
  }
  endInterruption(shouldResume: boolean) {
    this.emit('onInterruption', { type: 'ended', shouldResume });
  }
  diskLow() {
    const r = this.result();
    this.state = 'prepared';
    this.emit('onDiskLow', { availableBytes: 1000 });
    this.emit('onSegmentClosed', { ...r, reason: 'disk_low' });
  }
  private result(): SegmentResult {
    const ch = this.config?.channels ?? 1;
    return {
      path: this.path ?? '',
      frames: this.frames,
      bytes: 44 + this.frames * ch * 2,
      sampleRate: 48000,
      channels: ch,
    };
  }
}
