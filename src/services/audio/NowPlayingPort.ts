import type { Smp } from '@/domain/time';

import type { NowPlayingLabels } from '../app/labels';
import type { Subscription } from '../recording/RecorderPort';

/** ロック画面・通知に出す内容（AUDIO_DESIGN.md §10.5）。 */
export interface NowPlayingInfo {
  title: string;
  /** 番組名。 */
  artist: string;
  /** 番組のアートワーク（端末内の絶対パス）。 */
  artworkPath: string | null;
  duration: Smp;
  position: Smp;
  playing: boolean;
  labels: NowPlayingLabels;
}

/** ロック画面・通知・ヘッドホンのボタンからの操作。 */
export type NowPlayingCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'skipBackward' }
  | { type: 'skipForward' }
  | { type: 'seek'; position: Smp }
  | { type: 'stop' };

/**
 * ロック画面・通知の表示（iOS MPNowPlayingInfoCenter / Android MediaSession + 前面サービス）。
 * 何を出すかは PlaybackService だけが決める。実装は infra/native/nowPlayingAdapter とテスト用 Fake。
 */
export interface NowPlayingPort {
  update(info: NowPlayingInfo): void;
  clear(): void;
  onCommand(fn: (command: NowPlayingCommand) => void): Subscription;
}
