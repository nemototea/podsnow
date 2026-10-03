import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import type { SqlExecutor } from '@/infra/db/executor';
import { migrate } from '@/infra/db/migrate';
import { currentSourceFingerprint } from '@/services/export/sourceFingerprint';

import { HomeService } from '../HomeService';

async function insertLocal(
  db: SqlExecutor,
  id: string,
  episodeNumber: number,
  guid: string,
  title = `Local ${episodeNumber}`,
) {
  await db.run(
    `INSERT INTO episodes
      (id, show_id, title, episode_number, guid, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    [id, 's', title, episodeNumber, guid, episodeNumber, episodeNumber],
  );
}

async function insertFeed(
  db: SqlExecutor,
  id: string,
  episodeNumber: number,
  guid: string,
  episodeId: string | null = null,
  title = `Feed ${episodeNumber}`,
) {
  await db.run(
    `INSERT INTO feed_episodes
      (id, show_id, guid, title, description, enclosure_url, episode_number, episode_type,
       website_url, episode_id, published_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      's',
      guid,
      title,
      '',
      `https://example.test/${id}.mp3`,
      episodeNumber,
      'full',
      '',
      episodeId,
      episodeNumber,
      episodeNumber,
      episodeNumber,
    ],
  );
}

async function setup() {
  const db = createNodeSqliteExecutor();
  await migrate(db);
  await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s', 1, 1]);
  return { db, home: new HomeService(db) };
}

describe('HomeService', () => {
  it('combines a local episode and an imported episode with the same exact GUID', async () => {
    const { db, home } = await setup();
    await insertLocal(db, 'e1', 1, 'shared-guid');
    await insertFeed(db, 'f1', 1, 'shared-guid');

    expect(await home.list('s')).toMatchObject([
      { key: 'local:e1', local: { id: 'e1' }, feed: { id: 'f1' } },
    ]);
  });

  it('prefers an explicit episode link over a GUID match', async () => {
    const { db, home } = await setup();
    await insertLocal(db, 'e1', 1, 'shared-guid');
    await insertLocal(db, 'e2', 2, 'other-guid');
    await insertFeed(db, 'f1', 2, 'shared-guid', 'e2');

    const items = await home.list('s');
    expect(items.find((item) => item.local?.id === 'e2')?.feed?.id).toBe('f1');
    expect(items.find((item) => item.local?.id === 'e1')?.feed).toBeNull();
  });

  it('keeps an unmatched imported episode as an RSS-only Home row', async () => {
    const { db, home } = await setup();
    await insertLocal(db, 'e1', 1, 'local-guid');
    await insertFeed(db, 'f2', 2, 'feed-guid');

    const items = await home.list('s');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ key: 'feed:f2', local: null, feed: { id: 'f2' } });
  });

  it('does not merge rows by title or episode number alone', async () => {
    const { db, home } = await setup();
    await insertLocal(db, 'e1', 1, 'local-guid', 'Same title');
    await insertFeed(db, 'f1', 1, 'feed-guid', null, 'Same title');

    const items = await home.list('s');
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.key)).toEqual(['local:e1', 'feed:f1']);
  });

  // Issue #168: 「書き出し済み」は今の編集と同じ音の書き出しがあるときだけ（FR-EP-3 / FR-EP-7）
  describe('hasCurrentExport', () => {
    async function insertExport(
      db: SqlExecutor,
      id: string,
      episodeId: string,
      fingerprint: string | null,
      status = 'done',
    ) {
      await db.run(
        'INSERT INTO exports (id, episode_id, format, preset, status, path, duration_smp, source_fingerprint, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [
          id,
          episodeId,
          'm4a',
          '{}',
          status,
          `episodes/${episodeId}/exports/${id}.m4a`,
          1,
          fingerprint,
          1,
        ],
      );
    }

    it('is true only while an export matches the current edit', async () => {
      const { db, home } = await setup();
      await insertLocal(db, 'e1', 1, 'g1');
      await insertExport(db, 'x1', 'e1', await currentSourceFingerprint(db, 'e1'));
      expect((await home.list('s'))[0]?.hasCurrentExport).toBe(true);

      // 音の仕上げを変えた（書き出したあとに編集した）
      await db.run('UPDATE episodes SET sound_settings = ? WHERE id = ?', [
        JSON.stringify({ loudness: { enabled: false } }),
        'e1',
      ]);
      expect((await home.list('s'))[0]?.hasCurrentExport).toBe(false);
    });

    it('ignores unfinished exports, exports without a fingerprint and other episodes', async () => {
      const { db, home } = await setup();
      await insertLocal(db, 'e1', 1, 'g1');
      await insertLocal(db, 'e2', 2, 'g2');
      const fp = await currentSourceFingerprint(db, 'e1');
      await insertExport(db, 'x1', 'e1', fp, 'rendering');
      await insertExport(db, 'x2', 'e1', null);
      await insertExport(db, 'x3', 'e2', 'not-the-current-edit');
      const items = await home.list('s');
      expect(items.map((i) => [i.key, i.hasCurrentExport])).toEqual([
        ['local:e2', false],
        ['local:e1', false],
      ]);
    });

    it('is false for RSS-only rows', async () => {
      const { db, home } = await setup();
      await insertFeed(db, 'f1', 1, 'g1');
      expect((await home.list('s'))[0]?.hasCurrentExport).toBe(false);
    });
  });
});
