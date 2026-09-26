import { smp } from '@/domain/time';
import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { saveDoc } from '@/infra/db/repositories/editableDocRepo';

import { PlaybackService } from '../PlaybackService';
import { FakeAudioEngine } from './FakeAudioEngine';

const TOTAL = 96000;

async function setup(opts: { withVoice?: boolean } = {}) {
  const db = createNodeSqliteExecutor();
  await migrate(db);
  await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s', 1, 1]);
  await db.run(
    'INSERT INTO episodes (id, show_id, episode_number, created_at, updated_at) VALUES (?,?,?,?,?)',
    ['e', 's', 1, 1, 1],
  );
  if (opts.withVoice) {
    await db.run(
      'INSERT INTO takes (id, episode_id, status, started_at, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      ['T', 'e', 'ready', 1, TOTAL, 1, 1],
    );
    await db.run(
      'INSERT INTO take_segments (id, take_id, seq, path, offset_smp, duration_smp, header_valid, reason_closed) VALUES (?,?,?,?,?,?,1,?)',
      ['sg', 'T', 1, 'episodes/e/takes/T/seg-0001.wav', 0, TOTAL, 'stop'],
    );
    await saveDoc(
      db,
      'e',
      {
        voice: [
          {
            id: 'v',
            takeId: 'T',
            srcStart: smp(0),
            srcEnd: smp(TOTAL),
            gainDb: 0,
            fadeIn: smp(0),
            fadeOut: smp(0),
          },
        ],
        overlays: [],
      },
      1,
    );
  }
  const engine = new FakeAudioEngine();
  const svc = new PlaybackService({ db, engine, root: '/root' });
  return { db, engine, svc };
}

describe('PlaybackService', () => {
  it('loads the timeline in stereo so stereo recordings keep left and right', async () => {
    const { engine, svc } = await setup();
    await svc.reload('e');
    expect(engine.timelines).toHaveLength(1);
    expect(engine.timelines[0]).toMatchObject({ channels: 2, sampleRate: 48000 });
  });

  // Issue #134: 収録を止めると再生位置は末尾に置かれる。そのまま「通して聴く」を押すと
  // 末尾から鳴らしてすぐ終わり、何も聞こえなかった。
  it('plays from the start when toggled at the end of the timeline', async () => {
    const { engine, svc } = await setup({ withVoice: true });
    await svc.reload('e');
    await svc.seek(smp(TOTAL)); // 収録直後（takeFinalized → placePlayhead(endSmp)）
    await svc.toggle();
    expect(engine.calls).toContain('play:0');
    expect(svc.isPlaying).toBe(true);
    expect(svc.position).toBe(0);
  });

  it('plays from the start again after playing through to the end', async () => {
    const { engine, svc } = await setup({ withVoice: true });
    await svc.reload('e');
    // 最後まで鳴り終えた（ネイティブは位置を末尾に残して ended を送る）
    engine.position = TOTAL;
    engine.emit('onPlaybackState', { playing: false, frame: TOTAL, ended: true });
    await svc.toggle();
    expect(svc.isPlaying).toBe(true);
    expect(svc.position).toBe(0);
  });

  it('resumes from the current position when toggled in the middle', async () => {
    const { engine, svc } = await setup({ withVoice: true });
    await svc.reload('e');
    await svc.seek(smp(48000));
    await svc.toggle();
    expect(engine.calls).toContain('play:null');
    expect(svc.isPlaying).toBe(true);
    expect(svc.position).toBe(48000);
  });

  // Issue #134: 書き出しタブでダッキングを変えたら、聴いている位置のまま新しい設定で鳴らし直す
  it('reloads with the latest ducking settings and keeps playing at the same position', async () => {
    const { db, engine, svc } = await setup({ withVoice: true });
    await svc.reload('e');
    await svc.seek(smp(48000));
    await svc.toggle();
    await db.run('UPDATE episodes SET sound_settings = ? WHERE id = ?', [
      JSON.stringify({ ducking: { enabled: false, depthDb: -20 } }),
      'e',
    ]);
    await svc.reload('e');
    expect(engine.timelines.at(-1)).toMatchObject({ ducking: { enabled: false, depthDb: -20 } });
    expect(svc.isPlaying).toBe(true);
    expect(svc.position).toBe(48000);
  });

  it('pauses when toggled while playing', async () => {
    const { svc } = await setup({ withVoice: true });
    await svc.reload('e');
    await svc.toggle();
    await svc.toggle();
    expect(svc.isPlaying).toBe(false);
  });
});
