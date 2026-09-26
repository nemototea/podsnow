import type { Smp } from '@/domain/time';

import type { Subscription } from '../recording/RecorderPort';

export interface FilePlaybackStatus {
  playing: boolean;
  position: Smp;
  duration: Smp;
  ended: boolean;
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
