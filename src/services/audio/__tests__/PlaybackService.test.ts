import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';

import { PlaybackService } from '../PlaybackService';
import { FakeAudioEngine } from './FakeAudioEngine';

describe('PlaybackService', () => {
  it('loads the timeline in stereo so stereo recordings keep left and right', async () => {
    const db = createNodeSqliteExecutor();
    await migrate(db);
    await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s', 1, 1]);
    await db.run(
      'INSERT INTO episodes (id, show_id, episode_number, created_at, updated_at) VALUES (?,?,?,?,?)',
      ['e', 's', 1, 1, 1],
    );
    const engine = new FakeAudioEngine();
    const svc = new PlaybackService({ db, engine, root: '/root' });
    await svc.reload('e');
    expect(engine.timelines).toHaveLength(1);
    expect(engine.timelines[0]).toMatchObject({ channels: 2, sampleRate: 48000 });
  });
});
