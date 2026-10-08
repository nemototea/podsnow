import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { FakeAudioEngine } from '@/services/audio/__tests__/FakeAudioEngine';

import { AssetsService } from '../AssetsService';

describe('AssetsService', () => {
  it('imports assets as 48 kHz stereo so stereo music survives a stereo export', async () => {
    const db = createNodeSqliteExecutor();
    await migrate(db);
    await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s', 1, 1]);
    const engine = new FakeAudioEngine();
    const svc = new AssetsService({
      db,
      engine,
      root: '/root',
      ensureDir: () => {},
      newId: () => 'a1',
      now: () => 1,
    });
    const row = await svc.import('s', 'bgm', '/tmp/song.m4a', 'Song', 'song.m4a');
    expect(engine.imports).toEqual([{ sampleRate: 48000, channels: 2 }]);
    expect(row.channels).toBe(2);
  });
});
