/**
 * podsnow-recorder の JS 側型定義。ARCHITECTURE.md §5.1 / AUDIO_DESIGN.md §3〜§4。
 * 時間は「フレーム数」（= サンプル数 / チャンネル、sampleRate 基準）で返す。
 */

export type RecorderState =
  'idle' | 'prepared' | 'recording' | 'paused' | 'interrupted' | 'stopping';

export interface RecorderConfig {
  /** 48000 を推奨。 */
  sampleRate: number;
  channels: 1 | 2;
  /** getInputs() の uid。null なら OS 既定。 */
  inputUid?: string | null;
  /** 空き容量がこの値を下回ったら diskLow を出して停止する（bytes）。 */
  diskLowThresholdBytes?: number;
  /** WAV ヘッダ更新 + fsync の間隔（ms）。既定 1000。 */
  headerFlushIntervalMs?: number;
  /** level イベントの間隔（ms）。既定 50。 */
  levelIntervalMs?: number;
  /**
   * Android の AudioSource。既定 'voice_recognition'（AGC なし）。
   * 'unprocessed' は対応端末のみ。iOS では無視。AUDIO_DESIGN.md §3.2【仮説: スパイクで既定を決める】
   */
  androidAudioSource?: 'mic' | 'voice_recognition' | 'unprocessed' | 'camcorder';
}

export interface AudioInput {
  uid: string;
  name: string;
  type: 'builtin' | 'wired' | 'bluetooth' | 'usb' | 'other';
  /** Bluetooth(HFP) など音質が落ちる入力。 */
  lowQuality: boolean;
}

export interface SegmentResult {
  path: string;
  /** 書き込んだフレーム数。 */
  frames: number;
  /** ファイルサイズ（ヘッダ込み）。 */
  bytes: number;
  sampleRate: number;
  channels: number;
}

export type SegmentCloseReason =
  'stop' | 'interruption' | 'route_change' | 'error' | 'disk_low' | 'media_reset';

export interface LevelEvent {
  peakDb: number;
  rmsDb: number;
  /** 現在の Segment に書き込んだ累計フレーム数（一時停止中は増えない）。 */
  frames: number;
  clipped: boolean;
}

export interface InterruptionEvent {
  type: 'began' | 'ended';
  /** ended のとき、OS が再開を推奨しているか。 */
  shouldResume: boolean;
  reason?: string;
}

export interface RouteChangeEvent {
  reason: string;
  currentInput: AudioInput | null;
}

export interface SegmentClosedEvent extends SegmentResult {
  reason: SegmentCloseReason;
}

export interface RecorderErrorEvent {
  message: string;
  code?: string;
}

export interface DiskLowEvent {
  availableBytes: number;
}

export type PodsnowRecorderModuleEvents = {
  onLevel: (e: LevelEvent) => void;
  onInterruption: (e: InterruptionEvent) => void;
  onRouteChange: (e: RouteChangeEvent) => void;
  onSegmentClosed: (e: SegmentClosedEvent) => void;
  onError: (e: RecorderErrorEvent) => void;
  onDiskLow: (e: DiskLowEvent) => void;
  onStateChange: (e: { state: RecorderState }) => void;
};

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export interface PermissionResult {
  microphone: PermissionStatus;
  /** Android 13+ の通知権限。iOS では常に granted。 */
  notifications: PermissionStatus;
}
