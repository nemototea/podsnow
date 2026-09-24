/** podsnow-audio-engine の JS 側型定義。ARCHITECTURE.md §5.2 / AUDIO_DESIGN.md §6〜§9。 */

export interface SilenceOptions {
  minDurationMs: number;
  thresholdDb: number;
  windowMs?: number;
}

export interface FrameRange {
  start: number;
  end: number;
}

export interface ImportOptions {
  sampleRate: number;
  channels: 1 | 2;
}

export interface ImportedAsset {
  path: string;
  frames: number;
  sampleRate: number;
  channels: number;
}

export interface WavInfo {
  frames: number;
  sampleRate: number;
  channels: number;
}

export type RenderFormat = 'm4a' | 'wav';

export interface RenderOptions {
  path: string;
  format: RenderFormat;
  /** AAC のビットレート（bps）。 */
  bitrate?: number;
}

export interface RenderProgressEvent {
  jobId: string;
  progress: number;
  phase: 'measuring' | 'encoding' | 'done';
}

export interface RenderDoneEvent {
  jobId: string;
  path: string;
  frames: number;
  /** 書き出したファイル（出力）の統合ラウドネス（LUFS）。 */
  measuredLufs: number;
  /** 書き出したファイル（出力）のトゥルーピーク（dBTP）。 */
  measuredTruePeakDb: number;
  appliedGainDb: number;
  /** 調整前のミックスの統合ラウドネス。ラウドネス調整が無効なら -120。 */
  inputLufs?: number;
}

export interface RenderErrorEvent {
  jobId: string;
  message: string;
  cancelled: boolean;
}

export interface PlaybackStateEvent {
  playing: boolean;
  frame: number;
  ended?: boolean;
}

export type PodsnowAudioEngineModuleEvents = {
  onRenderProgress: (e: RenderProgressEvent) => void;
  onRenderDone: (e: RenderDoneEvent) => void;
  onRenderError: (e: RenderErrorEvent) => void;
  onPlaybackState: (e: PlaybackStateEvent) => void;
  onPosition: (e: { frame: number }) => void;
  onError: (e: { message: string }) => void;
  onTaskProgress: (e: { task: string; path: string; progress: number }) => void;
};
