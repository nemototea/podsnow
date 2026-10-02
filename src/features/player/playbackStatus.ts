import type { PlaybackSource } from '@/services/audio/PlaybackService';

export interface PlaybackStatus {
  source: PlaybackSource | null;
  playing: boolean;
}

function sourceKey(s: PlaybackSource | null): string {
  if (!s) return '';
  const id = s.kind === 'export' ? s.exportId : s.kind === 'rss' ? s.feedEpisodeId : '';
  return [s.kind, s.homeKey ?? '', s.episodeId ?? '', id].join('\u0000');
}

/** 再生元と再生中かが変わっていなければ同じとみなす（位置・長さの変化は無視する）。 */
export function samePlaybackStatus(a: PlaybackStatus, b: PlaybackStatus): boolean {
  return a.playing === b.playing && sourceKey(a.source) === sourceKey(b.source);
}
