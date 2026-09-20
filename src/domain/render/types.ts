/**
 * ネイティブ音声エンジンに渡す自己完結した JSON（ARCHITECTURE.md §5.2）。
 * すべての位置はフレーム数（sampleRate 基準）。パスは絶対パス。ネイティブは DB を読まない。
 */
export interface RenderClip {
  /** 16 bit PCM WAV の絶対パス。 */
  path: string;
  /** ファイル内の開始フレーム。 */
  fileStart: number;
  /** ファイル内の終了フレーム（排他）。 */
  fileEnd: number;
  /** 出力タイムライン上の開始フレーム。 */
  tlStart: number;
  gainDb: number;
  fadeInFrames: number;
  fadeOutFrames: number;
}

export interface RenderOverlay extends RenderClip {
  /** 出力タイムライン上の終了フレーム（排他）。ループ時はここまで繰り返す。 */
  tlEnd: number;
  /** 声がある区間で減衰させる。 */
  duck: boolean;
  loop: boolean;
}

export interface DuckingSettings {
  enabled: boolean;
  /** 声がある区間での減衰量（負の dB）。 */
  depthDb: number;
  attackMs: number;
  releaseMs: number;
  /** 声のエンベロープがこれを超えたら「声あり」。 */
  thresholdDb: number;
}

export interface LoudnessSettings {
  enabled: boolean;
  targetLufs: number;
  truePeakDbtp: number;
}

export interface RenderDocument {
  sampleRate: number;
  channels: 1 | 2;
  totalFrames: number;
  voice: RenderClip[];
  overlays: RenderOverlay[];
  ducking: DuckingSettings;
  loudness: LoudnessSettings;
}

export const DEFAULT_DUCKING: DuckingSettings = {
  enabled: true,
  depthDb: -10,
  attackMs: 50,
  releaseMs: 500,
  thresholdDb: -40,
};

export const DEFAULT_LOUDNESS: LoudnessSettings = {
  enabled: true,
  targetLufs: -16,
  truePeakDbtp: -1,
};
