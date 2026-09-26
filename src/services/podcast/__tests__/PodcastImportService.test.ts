import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AppError, type AppErrorCode } from '@/domain/errors';
import type { DirectoryResult } from '@/domain/podcast/directory';
import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { nextEpisodeNumber } from '@/infra/db/repositories/episodesRepo';
import { listFeedEpisodes } from '@/infra/db/repositories/feedEpisodesRepo';
import {
  ensureDefaultShow,
  getExternalId,
  getShow,
  listCategories,
  listFunding,
  updateShow,
} from '@/infra/db/repositories/showsRepo';
import { TEST_SHOW_SEED } from '@/services/app/__tests__/labels';
import { nodeFsPort } from '@/infra/files/__tests__/nodeFsPort';

import type { HttpGetOptions, HttpPort } from '../HttpPort';
import { PodcastImportService } from '../PodcastImportService';

const FEED_URL = 'https://feeds.example.com/show.xml';
const ART_URL = 'https://example.com/art.jpg';

const feedXml = (items: string, extra = '') => `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>取り込んだ番組</title>
    <description>概要</description>
    <link>https://example.com</link>
    <language>ja</language>
    <itunes:image href="${ART_URL}"/>
    <itunes:category text="Technology"/>
    <itunes:explicit>true</itunes:explicit>
    <podcast:funding url="https://example.com/support">応援</podcast:funding>
    ${extra}
    ${items}
  </channel>
</rss>`;

const item = (n: number) =>
  `<item><title>第${n}回</title><guid>ep-${n}</guid><itunes:episode>${n}</itunes:episode>` +
  `<enclosure url="https://cdn.example.com/${n}.mp3" length="100" type="audio/mpeg"/></item>`;

interface Route {
  status?: number;
  url?: string;
  contentType?: string;
  text?: string;
  bytes?: Uint8Array;
  error?: AppErrorCode;
}

function fakeHttp(routes: Record<string, Route>) {
  const calls: { url: string; opts: HttpGetOptions }[] = [];
  const resolve = (url: string, opts: HttpGetOptions) => {
    calls.push({ url, opts });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    const r = key ? routes[key]! : { status: 404 };
    if (r.error) throw new AppError(r.error);
    return {
      status: r.status ?? 200,
      url: r.url ?? url,
      contentType: r.contentType ?? '',
      r,
    };
  };
  const http: HttpPort = {
    getText: async (url, opts) => {
      const { r, ...meta } = resolve(url, opts);
      return { ...meta, text: r.text ?? '' };
    },
    getBytes: async (url, opts) => {
      const { r, ...meta } = resolve(url, opts);
      return { ...meta, bytes: r.bytes ?? new Uint8Array() };
    },
  };
  return { http, calls };
}

async function setup(routes: Record<string, Route>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'podsnow-import-'));
  const db = createNodeSqliteExecutor();
  await migrate(db);
  let n = 0;
  const newId = () => `id-${++n}`;
  const show = await ensureDefaultShow(db, newId, 1000, TEST_SHOW_SEED);
  const { http, calls } = fakeHttp(routes);
  const svc = new PodcastImportService({ db, http, fs: nodeFsPort, root, newId, now: () => 5000 });
  return { root, db, show, svc, calls };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
  return 'resolved';
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('PodcastImportService.search', () => {
  it('queries the Apple directory and reads the results', async () => {
    const { svc, calls } = await setup({
      'https://itunes.apple.com/search': {
        text: JSON.stringify({
          resultCount: 2,
          results: [
            {
              collectionId: 123,
              collectionName: '番組 A',
              artistName: 'A さん',
              feedUrl: FEED_URL,
              artworkUrl600: ART_URL,
              genres: ['テクノロジー', 'Podcasts'],
            },
            { collectionId: 456, collectionName: 'RSS なし' },
            { collectionName: 'ID なしは捨てる' },
          ],
        }),
      },
    });
    const results = await svc.search(' 番組 & A ', 'jp');
    expect(calls[0]!.url).toBe(
      'https://itunes.apple.com/search?term=%E7%95%AA%E7%B5%84%20%26%20A&media=podcast&entity=podcast&limit=20&country=JP',
    );
    expect(results).toEqual([
      {
        provider: 'apple_podcasts',
        externalId: '123',
        title: '番組 A',
        author: 'A さん',
        artworkUrl: ART_URL,
        feedUrl: FEED_URL,
        genres: ['テクノロジー', 'Podcasts'],
      },
      {
        provider: 'apple_podcasts',
        externalId: '456',
        title: 'RSS なし',
        author: '',
        artworkUrl: null,
        feedUrl: null,
        genres: [],
      },
    ]);
  });

  it('does not call the network for an empty term and surfaces HTTP errors', async () => {
    const { svc, calls } = await setup({
      'https://itunes.apple.com/search': { status: 503 },
    });
    expect(await svc.search('   ', 'JP')).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(await codeOf(svc.search('x', 'JP'))).toBe('import_http_status');
  });
});

describe('PodcastImportService.preview', () => {
  it('reads the feed without writing anything, filling gaps from the directory', async () => {
    const { svc, db, show } = await setup({
      [FEED_URL]: {
        text: feedXml(item(1)).replace('<itunes:image href="https://example.com/art.jpg"/>', ''),
      },
    });
    const directory: DirectoryResult = {
      provider: 'apple_podcasts',
      externalId: '123',
      title: '検索結果の名前',
      author: '検索結果の著者',
      artworkUrl: 'https://example.com/dir.jpg',
      feedUrl: FEED_URL,
      genres: [],
    };
    const p = await svc.preview(show.id, { directory });
    // RSS が優先、無い項目だけ検索結果で補う
    expect(p.feed.show.title).toBe('取り込んだ番組');
    expect(p.feed.show.author).toBe('検索結果の著者');
    expect(p.feed.show.imageUrl).toBe('https://example.com/dir.jpg');
    expect(p.feed.items).toHaveLength(1);
    expect(p.directory).toBe(directory);
    // 確定するまで DB は変わらない
    expect((await getShow(db, show.id))!.name).toBe(show.name);
    expect(await listFeedEpisodes(db, show.id)).toEqual([]);
  });

  it('rejects non-HTTPS URLs, http redirects, missing feed URLs and non-feeds', async () => {
    const { svc, show } = await setup({
      'https://redirected.example.com/': {
        url: 'http://plain.example.com/feed',
        text: feedXml(''),
      },
      'https://notfound.example.com/': { status: 404 },
      'https://html.example.com/': { text: '<html><body>hello</body></html>' },
      'https://slow.example.com/': { error: 'import_timeout' },
    });
    expect(await codeOf(svc.preview(show.id, { feedUrl: 'http://example.com/feed' }))).toBe(
      'import_not_https',
    );
    expect(await codeOf(svc.preview(show.id, { feedUrl: 'file:///etc/passwd' }))).toBe(
      'import_not_https',
    );
    expect(await codeOf(svc.preview(show.id, { feedUrl: '   ' }))).toBe('import_no_feed_url');
    expect(await codeOf(svc.preview(show.id, { feedUrl: 'https://redirected.example.com/' }))).toBe(
      'import_not_https',
    );
    expect(await codeOf(svc.preview(show.id, { feedUrl: 'https://notfound.example.com/' }))).toBe(
      'import_http_status',
    );
    expect(await codeOf(svc.preview(show.id, { feedUrl: 'https://html.example.com/' }))).toBe(
      'import_not_a_feed',
    );
    expect(await codeOf(svc.preview(show.id, { feedUrl: 'https://slow.example.com/' }))).toBe(
      'import_timeout',
    );
    const noFeed: DirectoryResult = {
      provider: 'apple_podcasts',
      externalId: '1',
      title: 't',
      author: '',
      artworkUrl: null,
      feedUrl: null,
      genres: [],
    };
    expect(await codeOf(svc.preview(show.id, { directory: noFeed }))).toBe('import_no_feed_url');
  });

  it('passes size and time limits to the HTTP port', async () => {
    const { svc, calls, show } = await setup({ [FEED_URL]: { text: feedXml('') } });
    await svc.preview(show.id, { feedUrl: FEED_URL });
    expect(calls[0]!.opts).toMatchObject({ maxBytes: 20 * 1024 * 1024, timeoutMs: 20_000 });
  });
});

describe('PodcastImportService.nextEpisodeNumberAfter', () => {
  it('previews the next number from the feed, or null when the feed has no numbers', async () => {
    const routes: Record<string, Route> = { [FEED_URL]: { text: feedXml(item(119) + item(120)) } };
    const { svc, show } = await setup(routes);
    expect(
      await svc.nextEpisodeNumberAfter(show.id, await svc.preview(show.id, { feedUrl: FEED_URL })),
    ).toBe(121);
    routes[FEED_URL] = { text: feedXml('<item><guid>a</guid></item>') };
    expect(
      await svc.nextEpisodeNumberAfter(show.id, await svc.preview(show.id, { feedUrl: FEED_URL })),
    ).toBeNull();
  });
});

describe('PodcastImportService.commit', () => {
  it('saves the show, categories, funding, external id, episodes and artwork', async () => {
    const { svc, db, show, root } = await setup({
      [FEED_URL]: { text: feedXml(item(119) + item(120)) },
      [ART_URL]: { contentType: 'image/jpeg', bytes: JPEG },
    });
    const directory: DirectoryResult = {
      provider: 'apple_podcasts',
      externalId: '123',
      title: '',
      author: '',
      artworkUrl: null,
      feedUrl: FEED_URL,
      genres: [],
    };
    const r = await svc.commit(show.id, await svc.preview(show.id, { directory }));
    expect(r).toEqual({ episodes: 2, coverSaved: true });

    const s = (await getShow(db, show.id))!;
    expect(s).toMatchObject({
      name: '取り込んだ番組',
      description: '概要',
      website_url: 'https://example.com',
      language: 'ja',
      explicit: 1,
      feed_url: FEED_URL,
      cover_source_url: ART_URL,
      cover_path: `shows/${show.id}/cover-5000.jpg`,
      feed_imported_at: 5000,
    });
    expect(fs.readFileSync(path.join(root, s.cover_path!))).toEqual(Buffer.from(JPEG));
    expect((await listCategories(db, show.id)).map((c) => c.category)).toEqual(['Technology']);
    expect((await listFunding(db, show.id)).map((f) => f.label)).toEqual(['応援']);
    expect(await getExternalId(db, show.id, 'apple_podcasts')).toBe('123');
    expect((await listFeedEpisodes(db, show.id)).map((e) => e.guid).sort()).toEqual([
      'ep-119',
      'ep-120',
    ]);
    // 話数は配信済みの続きから
    expect(await nextEpisodeNumber(db, show.id)).toBe(121);
  });

  it('keeps existing values the feed does not have, and still imports when artwork fails', async () => {
    const minimal = `<rss><channel><title>最小</title>${item(1)}</channel></rss>`;
    const { svc, db, show } = await setup({
      [FEED_URL]: { text: minimal },
    });
    await updateShow(
      db,
      show.id,
      { author: '手で入れた著者', description: '手で書いた概要' },
      2000,
    );
    const p = await svc.preview(show.id, { feedUrl: FEED_URL });
    const withArt = { ...p, feed: { ...p.feed, show: { ...p.feed.show, imageUrl: ART_URL } } };
    const r = await svc.commit(show.id, withArt);
    expect(r).toEqual({ episodes: 1, coverSaved: false });
    const s = (await getShow(db, show.id))!;
    expect(s).toMatchObject({
      name: '最小',
      author: '手で入れた著者',
      description: '手で書いた概要',
      cover_path: null,
    });
  });

  it('replaces the artwork file when its format changes', async () => {
    const routes: Record<string, Route> = {
      [FEED_URL]: { text: feedXml('') },
      [ART_URL]: { contentType: 'image/jpeg', bytes: JPEG },
    };
    const { svc, db, show, root } = await setup(routes);
    await svc.commit(show.id, await svc.preview(show.id, { feedUrl: FEED_URL }));
    routes[ART_URL] = { contentType: 'image/png', bytes: new Uint8Array([0x89, 0x50]) };
    await svc.commit(show.id, await svc.preview(show.id, { feedUrl: FEED_URL }));
    expect((await getShow(db, show.id))!.cover_path).toBe(`shows/${show.id}/cover-5000.png`);
    expect(fs.readdirSync(path.join(root, `shows/${show.id}`))).toEqual(['cover-5000.png']);
  });

  it('E-4: a failed commit leaves neither the new artwork nor a changed show', async () => {
    const { svc, db, show, root } = await setup({
      [FEED_URL]: { text: feedXml(item(1)) },
      [ART_URL]: { contentType: 'image/jpeg', bytes: JPEG },
    });
    const p = await svc.preview(show.id, { feedUrl: FEED_URL });
    // 書き込みの途中で DB が失敗する状況を作る
    await db.run('DROP TABLE feed_episodes');
    await expect(svc.commit(show.id, p)).rejects.toThrow();
    expect((await getShow(db, show.id))!).toMatchObject({ name: show.name, cover_path: null });
    const dir = path.join(root, `shows/${show.id}`);
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
  });

  it('E-4: cleans up artwork left behind by an interrupted import', async () => {
    const { svc, db, show, root } = await setup({
      [FEED_URL]: { text: feedXml('') },
      [ART_URL]: { contentType: 'image/jpeg', bytes: JPEG },
    });
    const dir = path.join(root, `shows/${show.id}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cover-1.png'), 'left over');
    fs.writeFileSync(path.join(dir, 'cover.jpg'), 'old name');
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'not a cover');
    await svc.commit(show.id, await svc.preview(show.id, { feedUrl: FEED_URL }));
    expect(fs.readdirSync(dir).sort()).toEqual(['cover-5000.jpg', 'keep.txt']);
    expect((await getShow(db, show.id))!.cover_path).toBe(`shows/${show.id}/cover-5000.jpg`);
  });

  it('re-importing updates episodes by guid and keeps ones missing from the feed', async () => {
    const routes: Record<string, Route> = { [FEED_URL]: { text: feedXml(item(1) + item(2)) } };
    const { svc, db, show } = await setup(routes);
    await svc.commit(show.id, await svc.preview(show.id, { feedUrl: FEED_URL }));
    routes[FEED_URL] = { text: feedXml(item(3)) };
    await svc.commit(show.id, await svc.preview(show.id, { feedUrl: FEED_URL }));
    expect((await listFeedEpisodes(db, show.id)).map((e) => e.guid).sort()).toEqual([
      'ep-1',
      'ep-2',
      'ep-3',
    ]);
  });
});

describe('PodcastImportService: same / different show (docs/podcast-import-cases.md §5)', () => {
  const OTHER_URL = 'https://feeds.other.example.com/b.xml';
  const otherFeed = `<rss><channel><title>別の番組</title>${[1, 2]
    .map((n) => `<item><guid>b-${n}</guid><itunes:episode>${n}</itunes:episode></item>`)
    .join('')}</channel></rss>`;

  it('Q3: previewing the already added show is identified as same', async () => {
    const { svc, show } = await setup({ [FEED_URL]: { text: feedXml(item(1) + item(2)) } });
    expect((await svc.preview(show.id, { feedUrl: FEED_URL })).identity).toBe('new');
    await svc.commit(show.id, await svc.preview(show.id, { feedUrl: FEED_URL }));
    expect((await svc.preview(show.id, { feedUrl: FEED_URL })).identity).toBe('same');
  });

  it('B-1 / D-1: refuses another show and leaves episodes and numbering untouched', async () => {
    const { svc, db, show } = await setup({
      [FEED_URL]: { text: feedXml(item(119) + item(120)) },
      [OTHER_URL]: { text: otherFeed },
    });
    await svc.commit(show.id, await svc.preview(show.id, { feedUrl: FEED_URL }));
    const other = await svc.preview(show.id, { feedUrl: OTHER_URL });
    expect(other.identity).toBe('different');
    expect(await codeOf(svc.commit(show.id, other))).toBe('import_other_show');
    expect((await getShow(db, show.id))!.name).toBe('取り込んだ番組');
    expect((await listFeedEpisodes(db, show.id)).map((e) => e.guid).sort()).toEqual([
      'ep-119',
      'ep-120',
    ]);
    expect(await nextEpisodeNumber(db, show.id)).toBe(121);
  });

  it('refresh reads the previous feed again, and refuses when it became another show', async () => {
    const G = (g: string) => `<podcast:guid>${g}</podcast:guid>`;
    const routes: Record<string, Route> = { [FEED_URL]: { text: feedXml(item(1), G('aaa')) } };
    const { svc, db, show } = await setup(routes);
    expect(await codeOf(svc.previewRefresh(show.id))).toBe('import_no_feed_url');
    await svc.commit(show.id, await svc.preview(show.id, { feedUrl: FEED_URL }));
    routes[FEED_URL] = { text: feedXml(item(1) + item(2), G('aaa')) };
    const p = await svc.previewRefresh(show.id);
    expect(p.identity).toBe('same');
    await svc.commit(show.id, p);
    expect(await listFeedEpisodes(db, show.id)).toHaveLength(2);
    // 同じ URL でも番組の ID が変わっていれば別の番組
    routes[FEED_URL] = { text: feedXml(item(1), G('bbb')) };
    expect(await codeOf(svc.previewRefresh(show.id))).toBe('import_other_show');
  });
});
