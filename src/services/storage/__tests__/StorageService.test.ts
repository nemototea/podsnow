import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';

import { StorageService } from '../StorageService';

async function setup(free: () => number = () => 5_000) {
  const db = createNodeSqliteExecutor();
  await migrate(db);
  await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s', 1, 1]);
  return { db, svc: new StorageService({ db, availableDiskBytes: free }) };
}

async function addEpisode(
  db: Awaited<ReturnType<typeof setup>>['db'],
  id: string,
  status: string,
  durationSmp: number,
  channels: number,
) {
  await db.run(
    'INSERT INTO episodes (id, show_id, status, created_at, updated_at) VALUES (?,?,?,?,?)',
    [id, 's', status, 1, 1],
  );
  await db.run(
    'INSERT INTO takes (id, episode_id, status, channels, started_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [`t-${id}`, id, 'ready', channels, 1, 1, 1],
  );
  await db.run(
    'INSERT INTO take_segments (id, take_id, seq, path, duration_smp) VALUES (?,?,?,?,?)',
    [`g-${id}`, `t-${id}`, 0, 'x.wav', durationSmp],
  );
}

describe('StorageService', () => {
  it('何も無ければ 0', async () => {
    const { svc } = await setup();
    expect(await svc.summarize()).toEqual({
      recordingsBytes: 0,
      exportsBytes: 0,
      exportedEpisodesRecordingsBytes: 0,
    });
  });

  it('録音は長さ × チャンネル × 2 + 44 で見積もり、書き出し済みの回の分も分けて数える', async () => {
    const { db, svc } = await setup();
    await addEpisode(db, 'e1', 'draft', 48000, 1);
    await addEpisode(db, 'e2', 'exported', 48000, 2);
    await db.run(
      'INSERT INTO exports (id, episode_id, format, status, bytes, created_at) VALUES (?,?,?,?,?,?)',
      ['x1', 'e2', 'm4a', 'done', 1234, 1],
    );
    await db.run(
      'INSERT INTO exports (id, episode_id, format, status, bytes, created_at) VALUES (?,?,?,?,?,?)',
      ['x2', 'e2', 'm4a', 'failed', 999, 1],
    );
    expect(await svc.summarize()).toEqual({
      recordingsBytes: 48000 * 2 + 44 + (48000 * 4 + 44),
      exportsBytes: 1234,
      exportedEpisodesRecordingsBytes: 48000 * 4 + 44,
    });
  });

  it('空き容量が読めなければ 0', async () => {
    const ok = await setup(() => 42);
    expect(ok.svc.freeBytes()).toBe(42);
    const ng = await setup(() => {
      throw new Error('no');
    });
    expect(ng.svc.freeBytes()).toBe(0);
  });
});
