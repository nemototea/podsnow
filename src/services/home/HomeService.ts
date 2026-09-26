import type { SqlExecutor } from '@/infra/db/executor';
import { listEpisodes, type EpisodeListItem } from '@/infra/db/repositories/episodesRepo';
import { listFeedEpisodes, type FeedEpisodeRow } from '@/infra/db/repositories/feedEpisodesRepo';

export interface HomeEpisodeItem {
  key: string;
  local: EpisodeListItem | null;
  feed: FeedEpisodeRow | null;
  title: string;
  episodeNumber: number | null;
  durationSmp: number;
  publishedAt: number | null;
}

/** 制作データと配信済みカタログを、保存形式は分けたまま Home の 1 一覧へ統合する。 */
export class HomeService {
  constructor(private readonly db: SqlExecutor) {}

  async list(showId: string): Promise<HomeEpisodeItem[]> {
    const [locals, feeds] = await Promise.all([
      listEpisodes(this.db, showId),
      listFeedEpisodes(this.db, showId),
    ]);
    const byId = new Map(locals.map((e) => [e.id, e]));
    const byGuid = new Map(locals.filter((e) => e.guid).map((e) => [e.guid!, e]));
    const feedByLocal = new Map<string, FeedEpisodeRow>();
    const unmatchedFeeds: FeedEpisodeRow[] = [];
    for (const feed of feeds) {
      // 明示リンクを最優先し、GUID 完全一致だけを安全な自動対応として扱う。
      const local = (feed.episode_id ? byId.get(feed.episode_id) : null) ?? byGuid.get(feed.guid);
      if (local && !feedByLocal.has(local.id)) feedByLocal.set(local.id, feed);
      else unmatchedFeeds.push(feed);
    }
    const items: HomeEpisodeItem[] = locals.map((local) => {
      const feed = feedByLocal.get(local.id) ?? null;
      return {
        key: `local:${local.id}`,
        local,
        feed,
        title: local.title || feed?.title || '',
        episodeNumber: local.episode_number,
        durationSmp: feed?.duration_smp ?? local.duration_smp,
        publishedAt: feed?.published_at ?? local.published_at,
      };
    });
    for (const feed of unmatchedFeeds) {
      items.push({
        key: `feed:${feed.id}`,
        local: null,
        feed,
        title: feed.title,
        episodeNumber: feed.episode_number,
        durationSmp: feed.duration_smp ?? 0,
        publishedAt: feed.published_at,
      });
    }
    return items.sort((a, b) => {
      const number = (b.episodeNumber ?? -1) - (a.episodeNumber ?? -1);
      if (number !== 0) return number;
      return (
        (b.publishedAt ?? b.local?.created_at ?? b.feed?.created_at ?? 0) -
        (a.publishedAt ?? a.local?.created_at ?? a.feed?.created_at ?? 0)
      );
    });
  }
}
