import { NativeModule, requireNativeModule } from 'expo';

import type {
  AudioInput,
  PermissionResult,
  PodsnowRecorderModuleEvents,
  RecorderConfig,
  RecorderState,
  SegmentResult,
} from './PodsnowRecorder.types';

declare class PodsnowRecorderModule extends NativeModule<PodsnowRecorderModuleEvents> {
  /** マイク（と Android 13+ の通知）権限を要求する。 */
  requestPermissionsAsync(): Promise<PermissionResult>;
  getPermissionsAsync(): Promise<PermissionResult>;

  /** フォーマットと入力を決め、Audio Session を録音向けに構成する。state: idle → prepared */
  prepareAsync(config: RecorderConfig): Promise<void>;
  /** 新しい Segment ファイルを開いて録音を開始する。state: prepared|interrupted → recording */
  startAsync(path: string): Promise<void>;
  pauseAsync(): Promise<void>;
  resumeAsync(): Promise<void>;
  /** 現在の Segment を確定して閉じる。state → prepared */
  stopAsync(): Promise<SegmentResult>;
  /** セッションを解放する（Audio Session 非アクティブ化、Android は FGS 停止）。 */
  releaseAsync(): Promise<void>;

  getState(): RecorderState;
  /** 現在の Segment に書き込んだフレーム数。 */
  getFrames(): number;

  getInputsAsync(): Promise<AudioInput[]>;
  setInputAsync(uid: string | null): Promise<void>;
  getCurrentInputAsync(): Promise<AudioInput | null>;
  /** 現在の出力がスピーカーか（ジングル回り込み警告用）。 */
  isSpeakerOutputAsync(): Promise<boolean>;

  /** ヘッダ未確定の WAV をファイル実長から修復する（復旧用）。 */
  repairWavHeaderAsync(path: string): Promise<SegmentResult>;
  getAvailableDiskBytesAsync(path: string): Promise<number>;
}

export default requireNativeModule<PodsnowRecorderModule>('PodsnowRecorder');
