import type { PodcastFeedItem } from '@/domain/podcast/feed';
import { smp } from '@/domain/time';
import { TEST_SHOW_SEED } from '@/services/app/__tests__/labels';

import { migrate } from '../migrate';
import {
  getEpisode,
  insertEpisode,
  episodeGuidTaken,
  updateEpisode,
} from '../repositories/episodesRepo';
import {
  linkFeedEpisode,
  listFeedEpisodes,
  upsertFeedEpisodes,
} from '../repositories/feedEpisodesRepo';
import {
  ensureDefaultShow,
  getExternalId,
  getShow,
  listCategories,
  listFunding,
  replaceCategories,
  replaceFunding,
  setExternalId,
  updateShow,
} from '../repositories/showsRepo';
import { createNodeSqliteExecutor } from './nodeSqliteExecutor';

async function setup() {
  const db = createNodeSqliteExecutor();
  await migrate(db);
  let n = 0;
  const newId = () => `id-${++n}`;
  const show = await ensureDefaultShow(db, newId, 1000, TEST_SHOW_SEED);
  return { db, newId, show };
}

function item(guid: string, patch: Partial<PodcastFeedItem> = {}): PodcastFeedItem {
  return {
    guid,
    title: `title ${guid}`,
    description: '',
    publishedAt: null,
    enclosureUrl: null,
    enclosureLength: null,
    enclosureType: null,
    durationSmp: null,
    episodeNumber: null,
    season: null,
    episodeType: 'full',
    explicit: null,
    websiteUrl: '',
    imageUrl: null,
    ...patch,
  };
}

describe('shows: podcast RSS fields', () => {
  it('updates channel-level fields and stores booleans as 0/1', async () => {
    const { db, show } = await setup();
    await updateShow(
      db,
      show.id,
      {
        websiteUrl: 'https://example.com',
        language: 'ja',
        explicit: true,
        showType: 'serial',
        copyright: '© 2026',
        ownerName: 'Owner',
        ownerEmail: 'owner@example.com',
        complete: true,
        feedUrl: 'https://example.com/feed.xml',
        podcastGuid: 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6',
        coverSourceUrl: 'https://example.com/art.jpg',
        feedImportedAt: 2000,
      },
      2000,
    );
    const s = await getShow(db, show.id);
    expect(s).toMatchObject({
      website_url: 'https://example.com',
      language: 'ja',
      explicit: 1,
      show_type: 'serial',
      copyright: '© 2026',
      owner_name: 'Owner',
      owner_email: 'owner@example.com',
      complete: 1,
      feed_url: 'https://example.com/feed.xml',
      podcast_guid: 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6',
      cover_source_url: 'https://example.com/art.jpg',
      feed_imported_at: 2000,
      updated_at: 2000,
    });
    await updateShow(db, show.id, { explicit: false }, 3000);
    expect((await getShow(db, show.id))!.explicit).toBe(0);
  });

  it('replaces categories and funding in order', async () => {
    const { db, newId, show } = await setup();
    await replaceCategories(
      db,
      show.id,
      [
        { category: 'Technology', subcategory: '' },
        { category: 'Society & Culture', subcategory: 'Documentary' },
      ],
      newId,
    );
    await replaceCategories(
      db,
      show.id,
      [
        { category: 'Arts', subcategory: 'Books' },
        { category: 'Technology', subcategory: '' },
      ],
      newId,
    );
    expect(
      (await listCategories(db, show.id)).map((c) => [c.position, c.category, c.subcategory]),
    ).toEqual([
      [0, 'Arts', 'Books'],
      [1, 'Technology', ''],
    ]);

    await replaceFunding(
      db,
      show.id,
      [{ url: 'https://example.com/support', label: 'Support' }],
      newId,
    );
    expect((await listFunding(db, show.id)).map((f) => [f.url, f.label])).toEqual([
      ['https://example.com/support', 'Support'],
    ]);
    await replaceFunding(db, show.id, [], newId);
    expect(await listFunding(db, show.id)).toEqual([]);
  });

  it('keeps one external id per provider', async () => {
    const { db, show } = await setup();
    expect(await getExternalId(db, show.id, 'apple_podcasts')).toBeNull();
    await setExternalId(db, show.id, 'apple_podcasts', '123', 1);
    await setExternalId(db, show.id, 'apple_podcasts', '456', 2);
    await setExternalId(db, show.id, 'podcast_index', '789', 2);
    expect(await getExternalId(db, show.id, 'apple_podcasts')).toBe('456');
    expect(await getExternalId(db, show.id, 'podcast_index')).toBe('789');
  });
});

describe('episodes: podcast RSS fields', () => {
  it('fixes guid to the id at creation and updates item-level fields', async () => {
    const { db, show } = await setup();
    await insertEpisode(db, {
      id: 'e1',
      showId: show.id,
      title: 't',
      description: '',
      episodeNumber: 1,
      season: 1,
      now: 1000,
    });
    expect(await episodeGuidTaken(db, show.id, 'e1')).toBe(true);
    expect(await episodeGuidTaken(db, show.id, 'other')).toBe(false);

    await updateEpisode(
      db,
      'e1',
      {
        episodeType: 'bonus',
        explicit: true,
        websiteUrl: 'https://example.com/1',
        publishedAt: 5000,
      },
      2000,
    );
    expect(await getEpisode(db, 'e1')).toMatchObject({
      guid: 'e1',
      episode_type: 'bonus',
      explicit: 1,
      website_url: 'https://example.com/1',
      published_at: 5000,
    });
    // null で「番組の設定に従う」へ戻せる
    await updateEpisode(db, 'e1', { explicit: null }, 3000);
    expect((await getEpisode(db, 'e1'))!.explicit).toBeNull();
  });
});

describe('feed_episodes', () => {
  it('upserts by guid, keeps rows missing from a later feed, and preserves links', async () => {
    const { db, newId, show } = await setup();
    await upsertFeedEpisodes(
      db,
      show.id,
      [
        item('g1', { publishedAt: 100, episodeNumber: 1, explicit: false }),
        item('g2', {
          publishedAt: 200,
          episodeNumber: 2,
          durationSmp: smp(90 * 48000),
          enclosureUrl: 'https://example.com/2.mp3',
          enclosureLength: 1234,
          enclosureType: 'audio/mpeg',
          episodeType: 'trailer',
        }),
      ],
      newId,
      1000,
    );
    const first = await listFeedEpisodes(db, show.id);
    expect(first.map((r) => r.guid)).toEqual(['g2', 'g1']);
    expect(first[0]).toMatchObject({
      duration_smp: 90 * 48000,
      enclosure_url: 'https://example.com/2.mp3',
      enclosure_length: 1234,
      enclosure_type: 'audio/mpeg',
      episode_type: 'trailer',
      explicit: null,
    });
    expect(first[1]!.explicit).toBe(0);

    await insertEpisode(db, {
      id: 'e1',
      showId: show.id,
      title: '',
      description: '',
      episodeNumber: 1,
      season: 1,
      now: 1000,
    });
    const g1 = first.find((r) => r.guid === 'g1')!;
    await linkFeedEpisode(db, g1.id, 'e1', 1500);

    // 2 回目の取り込み: g1 は題名が変わり、g2 はフィードから消え、g3 が増えた
    await upsertFeedEpisodes(
      db,
      show.id,
      [item('g1', { title: 'renamed', publishedAt: 100 }), item('g3', { publishedAt: 300 })],
      newId,
      2000,
    );
    const second = await listFeedEpisodes(db, show.id);
    expect(second.map((r) => r.guid)).toEqual(['g3', 'g2', 'g1']);
    const g1After = second.find((r) => r.guid === 'g1')!;
    expect(g1After).toMatchObject({
      id: g1.id,
      title: 'renamed',
      episode_id: 'e1',
      created_at: 1000,
      updated_at: 2000,
    });
  });
});
