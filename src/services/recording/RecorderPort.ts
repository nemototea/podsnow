import type {
  AudioInput,
  PodsnowRecorderModuleEvents,
  RecorderConfig,
  RecorderState,
  SegmentResult,
} from '../../../modules/podsnow-recorder/src/PodsnowRecorder.types';

export interface Subscription {
  remove(): void;
}

/**
 * services が依存する録音モジュールの抽象。実装は infra/native/recorderAdapter（ネイティブ）と
 * テスト用の FakeRecorder。
 */
export interface RecorderPort {
  prepare(config: RecorderConfig): Promise<void>;
  start(path: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<SegmentResult>;
  release(): Promise<void>;
  getState(): RecorderState;
  getFrames(): number;
  getInputs(): Promise<AudioInput[]>;
  setInput(uid: string | null): Promise<void>;
  getCurrentInput(): Promise<AudioInput | null>;
  isSpeakerOutput(): Promise<boolean>;
  repairWavHeader(path: string): Promise<SegmentResult>;
  getAvailableDiskBytes(path: string): Promise<number>;
  on<K extends keyof PodsnowRecorderModuleEvents>(
    event: K,
    listener: PodsnowRecorderModuleEvents[K],
  ): Subscription;
}
