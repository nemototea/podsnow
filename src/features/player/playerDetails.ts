import { htmlToPlainText } from '@/domain/podcast/parseFeed';
import type { PlaybackSource } from '@/services/audio/PlaybackService';
import type { HomeEpisodeItem } from '@/services/home/HomeService';

/** プレーヤー画面に出す、再生中の回の補足（Issue #188）。 */
export interface PlayerDetails {
  /** 配信の音声なら配信日、手元の音声なら収録日。無ければ null。 */
  date: { kind: 'published' | 'recorded'; at: number } | null;
  /** 概要。配信の概要は HTML なので文字だけにする。 */
  description: string;
}

/**
 * 再生元と Home の行から補足を作る。配信の音声（`rss`）は配信日と配信の概要を、
 * 書き出し・タイムラインは収録日と手元の概要を先に使う。
 */
export function playerDetails(source: PlaybackSource, item: HomeEpisodeItem | null): PlayerDetails {
  const local = item?.local ?? null;
  const feed = item?.feed ?? null;
  const feedText = feed?.description ? htmlToPlainText(feed.description) : '';
  const localText = local?.description.trim() ?? '';
  if (source.kind === 'rss') {
    const at = feed?.published_at ?? item?.publishedAt ?? null;
    return {
      date: at === null ? null : { kind: 'published', at },
      description: feedText || localText,
    };
  }
  const recorded = local?.recorded_at ?? null;
  return {
    date: recorded === null ? null : { kind: 'recorded', at: recorded },
    description: localText || feedText,
  };
}
