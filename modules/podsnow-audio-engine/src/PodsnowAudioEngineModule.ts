import { NativeModule, requireNativeModule } from 'expo';

import type {
  FrameRange,
  ImportedAsset,
  ImportOptions,
  PodsnowAudioEngineModuleEvents,
  RenderOptions,
  SilenceOptions,
  WavInfo,
} from './PodsnowAudioEngine.types';

declare class PodsnowAudioEngineModule extends NativeModule<PodsnowAudioEngineModuleEvents> {
  generatePeaksAsync(
    src: string,
    dst: string,
    samplesPerSecond: number,
  ): Promise<{ count: number }>;
  detectSilenceAsync(src: string, opts: SilenceOptions): Promise<FrameRange[]>;
  importAssetAsync(src: string, dst: string, opts: ImportOptions): Promise<ImportedAsset>;
  readWavInfoAsync(path: string): Promise<WavInfo>;

  /** RenderDocument（JSON 文字列）を読み込む。 */
  loadTimelineAsync(docJson: string): Promise<void>;
  playAsync(atFrame?: number | null): Promise<void>;
  pauseAsync(): Promise<void>;
  seekAsync(frame: number): Promise<void>;
  unloadAsync(): Promise<void>;
  getPosition(): number;
  isPlaying(): boolean;

  /** バックグラウンドで書き出しを開始し jobId を返す。進捗・完了はイベント。 */
  startRender(docJson: string, opts: RenderOptions): string;
  cancelRender(jobId: string): void;
}

export default requireNativeModule<PodsnowAudioEngineModule>('PodsnowAudioEngine');
