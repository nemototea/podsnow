import type { AppErrorCode } from '@/domain/errors';
import type { PlaybackSource } from '@/services/audio/PlaybackService';

export interface PlaybackStatus {
  source: PlaybackSource | null;
  playing: boolean;
  /** 音声の読み込み・バッファ待ち（Issue #185）。 */
  loading: boolean;
  error: AppErrorCode | null;
}

function sourceKey(s: PlaybackSource | null): string {
  if (!s) return '';
  const id = s.kind === 'export' ? s.exportId : s.kind === 'rss' ? s.feedEpisodeId : '';
  return [s.kind, s.homeKey ?? '', s.episodeId ?? '', id].join('\u0000');
}

/** 再生元・再生中か・読み込みの状態が変わっていなければ同じとみなす（位置・長さの変化は無視する）。 */
export function samePlaybackStatus(a: PlaybackStatus, b: PlaybackStatus): boolean {
  return (
    a.playing === b.playing &&
    a.loading === b.loading &&
    a.error === b.error &&
    sourceKey(a.source) === sourceKey(b.source)
  );
}
