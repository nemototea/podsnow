import { initialNumbering, type Numbering } from '@/domain/episodes/numbering';
import {
  fillFromDirectory,
  parseAppleSearchResponse,
  type DirectoryResult,
} from '@/domain/podcast/directory';
import type { PodcastFeed } from '@/domain/podcast/feed';
import { judgeShowIdentity, type ShowIdentity } from '@/domain/podcast/identity';
import { parsePodcastFeed } from '@/domain/podcast/parseFeed';
import { AppError } from '@/domain/errors';
import type { SqlExecutor } from '@/infra/db/executor';
import {
  countFeedEpisodes,
  deleteFeedEpisodes,
  listFeedEpisodes,
  listPublishedNumbering,
  upsertFeedEpisodes,
} from '@/infra/db/repositories/feedEpisodesRepo';
import {
  deleteExternalIds,
  getExternalId,
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
  /**
   * 今の番組との関係（docs/podcast-import-cases.md §5）。
   * `same` は「追加済み」で、取り込みの流れはそこで終わる（読み込み直しは別の操作）。
   * `different` は、番組を 1 つしか持てない間（FR-SHOW-1）は取り込めない。
   */
  identity: ShowIdentity;
}

export interface ImportResult {
  /** 保存した配信済みの回の数 */
  episodes: number;
  /** アートワークを保存できたか。失敗しても取り込み自体は成功させる */
  coverSaved: boolean;
}

/** 取り込みの解除で消えるもの（確認に数字で出す。Issue #258）。 */
export interface UnimportSummary {
  /** 取り込み済みか。まだなら解除するものが無い */
  imported: boolean;
  /** 消える配信済みの回の数 */
  feedEpisodes: number;
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
    showId: string,
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
    const identity = await this.identityOf(showId, feed, [url, res.url], directory);
    return { feed, directory, identity };
  }

  /**
   * 前回取り込んだ RSS から読み込み直す（配信状況の更新）。取り込みとは別の操作で、
   * 同じ番組であることが前提。別の番組に変わっていたら `import_other_show`。
   */
  async previewRefresh(showId: string): Promise<ImportPreview> {
    const show = await getShow(this.deps.db, showId);
    if (!show?.feed_url) throw new AppError('import_no_feed_url');
    const p = await this.preview(showId, { feedUrl: show.feed_url });
    if (p.identity === 'different') throw new AppError('import_other_show');
    return p;
  }

  private async identityOf(
    showId: string,
    feed: PodcastFeed,
    urls: readonly string[],
    directory: DirectoryResult | null,
  ): Promise<ShowIdentity> {
    const { db } = this.deps;
    const [show, appleId, episodes] = await Promise.all([
      getShow(db, showId),
      getExternalId(db, showId, 'apple_podcasts'),
      listFeedEpisodes(db, showId),
    ]);
    return judgeShowIdentity(
      {
        imported: show?.feed_imported_at != null,
        feedUrl: show?.feed_url ?? null,
        podcastGuid: show?.podcast_guid ?? null,
        appleId,
        episodeGuids: episodes.map((e) => e.guid),
      },
      {
        feedUrls: [...urls, feed.show.feedUrl, directory?.feedUrl ?? ''],
        podcastGuid: feed.show.podcastGuid,
        appleId: directory?.provider === 'apple_podcasts' ? directory.externalId : null,
        episodeGuids: feed.items.map((i) => i.guid),
      },
    );
  }

  /**
   * 取り込んだあとの新しいエピソードの話数・シーズンの初期値（プレビューに出す。REQUIREMENTS.md §2.1.1）。
   * 取り込むと `guid` が同じ回はプレビューの値で上書きされ、RSS から消えた回は残るので、その状態で求める。
   */
  async numberingAfter(showId: string, preview: ImportPreview): Promise<Numbering> {
    const byGuid = new Map(
      (await listPublishedNumbering(this.deps.db, showId)).map((p) => [p.guid, p] as const),
    );
    for (const item of preview.feed.items) byGuid.set(item.guid, item);
    return initialNumbering([...byGuid.values()]);
  }

  /**
   * プレビューの内容で番組を上書きし、配信済みの回を保存する（FR-SHOW-9 / FR-SHOW-10）。
   * RSS に値の無い文字列項目は、今の値を残す（空で上書きしない）。
   */
  async commit(showId: string, preview: ImportPreview): Promise<ImportResult> {
    // 別の番組の回と話数の台帳を混ぜない（docs/podcast-import-cases.md B-1 / D-1）
    if (preview.identity === 'different') throw new AppError('import_other_show');
    const { db, newId, now } = this.deps;
    const { show, items } = preview.feed;
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
      // 代表色は画像が変わったら計算し直す（ShowColorService。DATA_MODEL.md §4.1）
      ...(coverPath ? { coverPath, coverColor: null } : {}),
      feedImportedAt: t,
    };
    try {
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
    } catch (e) {
      // DB が確定しなかったら、今回書いたアートワークも残さない（P4）
      if (coverPath) this.deps.fs.delete(joinRoot(this.deps.root, coverPath));
      throw e;
    }
    await this.removeStaleCovers(showId);
    return { episodes: items.length, coverSaved: coverPath !== null };
  }

  async unimportSummary(showId: string): Promise<UnimportSummary> {
    const { db } = this.deps;
    const [show, feedEpisodes] = await Promise.all([
      getShow(db, showId),
      countFeedEpisodes(db, showId),
    ]);
    return { imported: show?.feed_imported_at != null, feedEpisodes };
  }

  /**
   * 取り込みを解除する（Issue #258、docs/podcast-import-cases.md A-1）。
   * 番組情報（手で直した名前・概要を含む）・アートワーク・配信済みの回・外部 ID・カテゴリー・支援リンクを消し、
   * 別の番組を取り込める状態（判定が `new`）に戻す。番組名は初期値（`showName`）にする。
   *
   * 消さないもの: 手元のエピソード（録音・話数）、素材、既定の構成、カンペのひな形、概要欄テンプレート。
   * 話数は配信済みの回が正なので、手元のエピソードの話数は触らない（ユーザー判断 2026-10-10）。
   */
  async unimport(showId: string, labels: { showName: string }): Promise<void> {
    const { db, fs, root, newId, now } = this.deps;
    const before = await getShow(db, showId);
    if (!before) return;
    const t = now();
    await db.transaction(async () => {
      await deleteFeedEpisodes(db, showId);
      await deleteExternalIds(db, showId);
      await replaceCategories(db, showId, [], newId);
      await replaceFunding(db, showId, [], newId);
      await updateShow(
        db,
        showId,
        {
          name: labels.showName,
          description: '',
          author: '',
          websiteUrl: '',
          language: '',
          explicit: false,
          showType: 'episodic',
          copyright: '',
          ownerName: '',
          ownerEmail: '',
          complete: false,
          locked: false,
          feedUrl: null,
          podcastGuid: null,
          coverPath: null,
          coverSourceUrl: null,
          coverColor: null,
          feedImportedAt: null,
        },
        t,
      );
    });
    // DB が「画像なし」で確定してからファイルを消す。残っても次の取り込み・画像の設定で片付く（CoverArtService と同じ）
    if (before.cover_path) {
      try {
        fs.delete(joinRoot(root, before.cover_path));
      } catch {
        // 孤立ファイルは removeStaleCovers が回収する
      }
    }
    await this.removeStaleCovers(showId);
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
      const rel = relPaths.coverFile(showId, String(this.deps.now()), ext);
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

  /**
   * DB が指しているもの以外の `cover-*` を消す。前回のアートワークと、途中で落ちた取り込みが
   * 残したファイルの両方を片付ける（docs/podcast-import-cases.md E-4）。
   */
  private async removeStaleCovers(showId: string): Promise<void> {
    const { fs, root, db } = this.deps;
    try {
      const current = (await getShow(db, showId))?.cover_path?.split('/').pop() ?? null;
      const dir = joinRoot(root, relPaths.showDir(showId));
      for (const name of fs.list(dir)) {
        if (/^cover[-.]/.test(name) && name !== current) fs.delete(`${dir}/${name}`);
      }
    } catch {
      // 片付けに失敗しても取り込みは成功している。次の取り込みで再び片付ける
    }
  }
}
