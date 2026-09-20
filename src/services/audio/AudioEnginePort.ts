import type {
  FrameRange,
  ImportedAsset,
  ImportOptions,
  PodsnowAudioEngineModuleEvents,
  RenderOptions,
  SilenceOptions,
  WavInfo,
} from '../../../modules/podsnow-audio-engine/src/PodsnowAudioEngine.types';
import type { Subscription } from '../recording/RecorderPort';

/** services が依存する音声エンジンの抽象。実装は infra/native/audioEngineAdapter とテスト用 Fake。 */
export interface AudioEnginePort {
  generatePeaks(src: string, dst: string, samplesPerSecond: number): Promise<{ count: number }>;
  detectSilence(src: string, opts: SilenceOptions): Promise<FrameRange[]>;
  importAsset(src: string, dst: string, opts: ImportOptions): Promise<ImportedAsset>;
  readWavInfo(path: string): Promise<WavInfo>;
  loadTimeline(docJson: string): Promise<void>;
  play(atFrame?: number | null): Promise<void>;
  pause(): Promise<void>;
  seek(frame: number): Promise<void>;
  unload(): Promise<void>;
  getPosition(): number;
  isPlaying(): boolean;
  startRender(docJson: string, opts: RenderOptions): string;
  cancelRender(jobId: string): void;
  on<K extends keyof PodsnowAudioEngineModuleEvents>(
    event: K,
    listener: PodsnowAudioEngineModuleEvents[K],
  ): Subscription;
}
