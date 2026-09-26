import type { EpisodeType, PodcastFeedItem } from '@/domain/podcast/feed';

import type { SqlExecutor, SqlRow } from '../executor';

/** RSS から取り込んだ配信済みの回（DATA_MODEL.md §4.17）。音声はダウンロードしない。 */
export interface FeedEpisodeRow extends SqlRow {
  id: string;
  show_id: string;
  guid: string;
  title: string;
  description: string;
  published_at: number | null;
  enclosure_url: string | null;
  enclosure_length: number | null;
  enclosure_type: string | null;
  duration_smp: number | null;
  episode_number: number | null;
  season: number | null;
  episode_type: EpisodeType;
  /** 0 / 1。NULL は番組の設定に従う */
  explicit: number | null;
  website_url: string;
  image_url: string | null;
  /** PodsNow で作った回との対応。無ければ NULL */
  episode_id: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * 取り込んだ item を `guid` で突き合わせて保存する。既にある行はフィードの内容で上書きし、
 * `id` / `episode_id` / `created_at` は残す。
 *
 * フィードに無くなった行は消さない。ホスティングによっては最新 N 件しか RSS に載せないため、
 * 「フィードに無い = 配信を取り下げた」とは言えない。
 *
 * トランザクションは呼び出し側で張る。
 */
export async function upsertFeedEpisodes(
  db: SqlExecutor,
  showId: string,
  items: readonly PodcastFeedItem[],
  newId: () => string,
  now: number,
): Promise<void> {
  for (const i of items) {
    await db.run(
      `INSERT INTO feed_episodes (id, show_id, guid, title, description, published_at, enclosure_url, enclosure_length, enclosure_type, duration_smp, episode_number, season, episode_type, explicit, website_url, image_url, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (show_id, guid) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         published_at = excluded.published_at,
         enclosure_url = excluded.enclosure_url,
         enclosure_length = excluded.enclosure_length,
         enclosure_type = excluded.enclosure_type,
         duration_smp = excluded.duration_smp,
         episode_number = excluded.episode_number,
         season = excluded.season,
         episode_type = excluded.episode_type,
         explicit = excluded.explicit,
         website_url = excluded.website_url,
         image_url = excluded.image_url,
         updated_at = excluded.updated_at`,
      [
        newId(),
        showId,
        i.guid,
        i.title,
        i.description,
        i.publishedAt,
        i.enclosureUrl,
        i.enclosureLength,
        i.enclosureType,
        i.durationSmp,
        i.episodeNumber,
        i.season,
        i.episodeType,
        i.explicit === null ? null : i.explicit ? 1 : 0,
        i.websiteUrl,
        i.imageUrl,
        now,
        now,
      ],
    );
  }
}

/** 新しい配信から順に。配信日時の無い行は最後。 */
export async function listFeedEpisodes(db: SqlExecutor, showId: string): Promise<FeedEpisodeRow[]> {
  return db.all<FeedEpisodeRow>(
    'SELECT * FROM feed_episodes WHERE show_id = ? ORDER BY published_at DESC NULLS LAST, created_at DESC',
    [showId],
  );
}

/** PodsNow で作った回と、配信済みの回を結びつける（または `null` で外す）。 */
export async function linkFeedEpisode(
  db: SqlExecutor,
  feedEpisodeId: string,
  episodeId: string | null,
  now: number,
): Promise<void> {
  await db.run('UPDATE feed_episodes SET episode_id = ?, updated_at = ? WHERE id = ?', [
    episodeId,
    now,
    feedEpisodeId,
  ]);
}
