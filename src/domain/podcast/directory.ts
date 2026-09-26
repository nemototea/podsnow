/**
 * 番組の検索結果（ディレクトリ）の扱い（Issue #101 §5 / §8、REQUIREMENTS.md FR-SHOW-7 / FR-SHOW-9）。
 *
 * 検索は RSS の URL を見つけるためのもので、番組情報の正は RSS。
 * RSS に無い項目だけを検索結果で補う。
 */
import type { ExternalIdProvider, PodcastFeed } from './feed';

export interface DirectoryResult {
  provider: ExternalIdProvider;
  externalId: string;
  title: string;
  author: string;
  artworkUrl: string | null;
  /** 無ければ取り込めない（`import_no_feed_url`） */
  feedUrl: string | null;
  genres: string[];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * iTunes Search API（`media=podcast&entity=podcast`）の応答を読む。
 * 形が想定と違う要素は捨てる（外部の応答は信用しない。NFR-10）。
 */
export function parseAppleSearchResponse(json: unknown): DirectoryResult[] {
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: DirectoryResult[] = [];
  for (const r of results as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const id = r.collectionId;
    const title = str(r.collectionName);
    if ((typeof id !== 'number' && typeof id !== 'string') || !title) continue;
    const artwork = str(r.artworkUrl600) || str(r.artworkUrl100);
    out.push({
      provider: 'apple_podcasts',
      externalId: String(id),
      title,
      author: str(r.artistName),
      artworkUrl: artwork || null,
      feedUrl: str(r.feedUrl) || null,
      genres: Array.isArray(r.genres) ? r.genres.map(str).filter(Boolean) : [],
    });
  }
  return out;
}

/** RSS に無い項目だけを検索結果で補う（RSS が優先）。 */
export function fillFromDirectory(feed: PodcastFeed, dir: DirectoryResult | null): PodcastFeed {
  if (!dir) return feed;
  return {
    ...feed,
    show: {
      ...feed.show,
      title: feed.show.title || dir.title,
      author: feed.show.author || dir.author,
      imageUrl: feed.show.imageUrl ?? dir.artworkUrl,
    },
  };
}
