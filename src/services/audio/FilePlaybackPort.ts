import type { Smp } from '@/domain/time';

import type { Subscription } from '../recording/RecorderPort';

export interface FilePlaybackStatus {
  playing: boolean;
  position: Smp;
  duration: Smp;
  ended: boolean;
  /** 読み込みが終わっていない、またはバッファ待ちで音が出せない（Issue #185）。 */
  loading: boolean;
  /** 読み込み・再生に失敗した（URL が切れている、通信できない、壊れたファイル）。 */
  failed: boolean;
}

/** expo-audio を services から隔離する単一ファイル再生 Port。 */
export interface FilePlaybackPort {
  load(uri: string, duration: Smp): Promise<void>;
  play(): void;
  pause(): void;
  seek(to: Smp): Promise<void>;
  onStatus(fn: (status: FilePlaybackStatus) => void): Subscription;
  release(): void;
}
