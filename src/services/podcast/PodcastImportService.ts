import {
  fillFromDirectory,
  parseAppleSearchResponse,
  type DirectoryResult,
} from '@/domain/podcast/directory';
import type { PodcastFeed } from '@/domain/podcast/feed';
import { parsePodcastFeed } from '@/domain/podcast/parseFeed';
import { AppError } from '@/domain/errors';
import type { SqlExecutor } from '@/infra/db/executor';
import { nextEpisodeNumber } from '@/infra/db/repositories/episodesRepo';
import { upsertFeedEpisodes } from '@/infra/db/repositories/feedEpisodesRepo';
import {
  getShow,
  replaceCategories,
  replaceFunding,
  setExternalId,
  updateShow,
} from '@/infra/db/repositories/showsRepo';
import type { FsPort } from '@/infra/files/fsPort';
import { joinRoot, relPaths } from '@/infra/files/layout';

import type { HttpPort } from './HttpPort';

/** 上限は【仮説】。数百回分の RSS でも数 MB 程度なので余裕を持たせる（REQUIREMENTS.md NFR-10） */
export const FEED_MAX_BYTES = 20 * 1024 * 1024;
export const ARTWORK_MAX_BYTES = 10 * 1024 * 1024;
export const SEARCH_MAX_BYTES = 2 * 1024 * 1024;
export const HTTP_TIMEOUT_MS = 20_000;

const APPLE_SEARCH_URL = 'https://itunes.apple.com/search';

export interface PodcastImportDeps {
  db: SqlExecutor;
  http: HttpPort;
  fs: FsPort;
  root: string;
  newId: () => string;
  now: () => number;
}

/** 取り込む前に見せる内容（FR-SHOW-9）。確定するまで DB には何も書かない。 */
export interface ImportPreview {
  feed: PodcastFeed;
  /** 検索から選んだときの検索結果。RSS の URL を直接入れたときは null */
  directory: DirectoryResult | null;
}

export interface ImportResult {
  /** 保存した配信済みの回の数 */
  episodes: number;
  /** アートワークを保存できたか。失敗しても取り込み自体は成功させる */
  coverSaved: boolean;
}

export function assertHttps(url: string): void {
  if (!/^https:\/\/[^/\s]+/i.test(url.trim())) throw new AppError('import_not_https');
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

function imageExt(contentType: string, url: string): 'jpg' | 'png' | null {
  const ct = contentType.toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  const path = url.split(/[?#]/)[0]!.toLowerCase();
  if (path.endsWith('.png')) return 'png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'jpg';
  return null;
}

/**
 * 配信中の番組の取り込み（REQUIREMENTS.md FR-SHOW-6〜10、Issue #101）。
 *
 * 検索（Apple）→ RSS の URL → 取得 → 解析 → プレビュー → 保存。
 * RSS の URL を直接入れた場合も `preview` 以降は同じ道を通る（Issue #101 §11）。
 * 通信はユーザーの操作で呼ばれたときだけ（NFR-2）。
 */
export class PodcastImportService {
  constructor(private readonly deps: PodcastImportDeps) {}

  /** 番組名で検索する。`country` は ISO 3166-1 alpha-2（例 `JP`）。 */
  async search(term: string, country: string): Promise<DirectoryResult[]> {
    const q = term.trim();
    if (!q) return [];
    const params = [
      `term=${encodeURIComponent(q)}`,
      'media=podcast',
      'entity=podcast',
      'limit=20',
      `country=${encodeURIComponent(country.toUpperCase())}`,
    ].join('&');
    const res = await this.deps.http.getText(`${APPLE_SEARCH_URL}?${params}`, {
      timeoutMs: HTTP_TIMEOUT_MS,
      maxBytes: SEARCH_MAX_BYTES,
      accept: 'application/json',
    });
    if (!isOk(res.status)) throw new AppError('import_http_status', { status: res.status });
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch (e) {
      throw new AppError('import_network_failed', {}, e);
    }
    return parseAppleSearchResponse(json);
  }

  /** 検索結果から、または RSS の URL から、取り込む内容を用意する。 */
  async preview(
    source: { directory: DirectoryResult } | { feedUrl: string },
  ): Promise<ImportPreview> {
    const directory = 'directory' in source ? source.directory : null;
    const url = directory ? directory.feedUrl : (source as { feedUrl: string }).feedUrl.trim();
    if (!url) throw new AppError('import_no_feed_url');
    assertHttps(url);
    const res = await this.deps.http.getText(url, {
      timeoutMs: HTTP_TIMEOUT_MS,
      maxBytes: FEED_MAX_BYTES,
      accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1',
    });
    // リダイレクトで http に落とされていないか（NFR-10）
    assertHttps(res.url);
    if (!isOk(res.status)) throw new AppError('import_http_status', { status: res.status });
    const feed = fillFromDirectory(parsePodcastFeed(res.text, res.url), directory);
    return { feed, directory };
  }

  /**
   * 取り込んだあとの新しいエピソードの話数（プレビューに出す。REQUIREMENTS.md §2.1.1）。
   * RSS に話数が 1 つも無ければ null（取り込みは話数に影響しない）。
   */
  async nextEpisodeNumberAfter(showId: string, preview: ImportPreview): Promise<number | null> {
    let max = 0;
    for (const i of preview.feed.items) max = Math.max(max, i.episodeNumber ?? 0);
    if (max === 0) return null;
    const current = await nextEpisodeNumber(this.deps.db, showId);
    return Math.max(current, max + 1);
  }

  /**
   * プレビューの内容で番組を上書きし、配信済みの回を保存する（FR-SHOW-9 / FR-SHOW-10）。
   * RSS に値の無い文字列項目は、今の値を残す（空で上書きしない）。
   */
  async commit(showId: string, preview: ImportPreview): Promise<ImportResult> {
    const { db, newId, now } = this.deps;
    const { show, items } = preview.feed;
    const prevCover = (await getShow(db, showId))?.cover_path ?? null;
    const coverPath = show.imageUrl ? await this.saveCover(showId, show.imageUrl) : null;
    const t = now();
    // 文字列は空なら今の値を残す（キーごと省く）。真偽と列挙は RSS に無ければ既定値なのでそのまま入れる
    const text = (k: string, v: string) => (v === '' ? {} : { [k]: v });
    const patch: Parameters<typeof updateShow>[2] = {
      ...text('name', show.title),
      ...text('description', show.description),
      ...text('author', show.author),
      ...text('websiteUrl', show.websiteUrl),
      ...text('language', show.language),
      ...text('copyright', show.copyright),
      ...text('ownerName', show.ownerName),
      ...text('ownerEmail', show.ownerEmail),
      explicit: show.explicit,
      showType: show.showType,
      complete: show.complete,
      locked: show.locked,
      feedUrl: show.feedUrl,
      ...(show.podcastGuid ? { podcastGuid: show.podcastGuid } : {}),
      ...(show.imageUrl ? { coverSourceUrl: show.imageUrl } : {}),
      ...(coverPath ? { coverPath } : {}),
      feedImportedAt: t,
    };
    await db.transaction(async () => {
      await updateShow(db, showId, patch, t);
      if (show.categories.length) await replaceCategories(db, showId, show.categories, newId);
      if (show.funding.length) await replaceFunding(db, showId, show.funding, newId);
      if (preview.directory) {
        await setExternalId(
          db,
          showId,
          preview.directory.provider,
          preview.directory.externalId,
          t,
        );
      }
      await upsertFeedEpisodes(db, showId, items, newId, t);
    });
    // 形式が変わった（jpg → png 等）ときは、DB を書き換えたあとで古いファイルを消す
    if (coverPath && prevCover && prevCover !== coverPath) {
      this.deps.fs.delete(joinRoot(this.deps.root, prevCover));
    }
    return { episodes: items.length, coverSaved: coverPath !== null };
  }

  /** アートワークを取得して保存し、相対パスを返す。失敗したら null（取り込みは続ける）。 */
  private async saveCover(showId: string, imageUrl: string): Promise<string | null> {
    const { http, fs, root } = this.deps;
    try {
      assertHttps(imageUrl);
      const res = await http.getBytes(imageUrl, {
        timeoutMs: HTTP_TIMEOUT_MS,
        maxBytes: ARTWORK_MAX_BYTES,
        accept: 'image/jpeg, image/png',
      });
      assertHttps(res.url);
      const ext = imageExt(res.contentType, res.url);
      if (!isOk(res.status) || !ext || res.bytes.byteLength === 0) return null;
      const rel = relPaths.coverFile(showId, ext);
      const abs = joinRoot(root, rel);
      fs.ensureDir(joinRoot(root, relPaths.showDir(showId)));
      const h = fs.open(abs, 'w');
      try {
        h.write(res.bytes);
      } finally {
        h.close();
      }
      return rel;
    } catch {
      return null;
    }
  }
}
