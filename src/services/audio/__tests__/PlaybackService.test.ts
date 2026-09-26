import { smp } from '@/domain/time';
import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { saveDoc } from '@/infra/db/repositories/editableDocRepo';
import { HomeService, type HomeEpisodeItem } from '@/services/home/HomeService';

import { PlaybackService } from '../PlaybackService';
import type { FilePlaybackPort, FilePlaybackStatus } from '../FilePlaybackPort';
import { FakeAudioEngine } from './FakeAudioEngine';

const TOTAL = 96000;

class FakeFilePlayer implements FilePlaybackPort {
  calls: string[] = [];
  listener: ((s: FilePlaybackStatus) => void) | null = null;
  async load(uri: string) {
    this.calls.push(`load:${uri}`);
  }
  play() {
    this.calls.push('play');
  }
  pause() {
    this.calls.push('pause');
  }
  async seek(to: number) {
    this.calls.push(`seek:${to}`);
  }
  onStatus(fn: (s: FilePlaybackStatus) => void) {
    this.listener = fn;
    return { remove: () => (this.listener = null) };
  }
  release() {}
}

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
  const filePlayer = new FakeFilePlayer();
  const existing = new Set(['/root/episodes/e/exports/x1.m4a']);
  const svc = new PlaybackService({
    db,
    engine,
    filePlayer,
    fileExists: (path) => existing.has(path),
    root: '/root',
  });
  return { db, engine, filePlayer, existing, svc };
}

async function localHomeItem(db: ReturnType<typeof createNodeSqliteExecutor>) {
  const item = (await new HomeService(db).list('s'))[0];
  if (!item) throw new Error('home item was not created');
  return item;
}

async function insertFeedEpisode(
  db: ReturnType<typeof createNodeSqliteExecutor>,
  patch: Partial<{ episodeId: string | null; enclosureUrl: string | null }> = {},
): Promise<HomeEpisodeItem> {
  await db.run(
    `INSERT INTO feed_episodes
      (id, show_id, guid, title, description, enclosure_url, episode_type, website_url, episode_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      'f',
      's',
      'feed-guid',
      'Published episode',
      '',
      patch.enclosureUrl ?? 'https://example.test/episode.mp3',
      'full',
      '',
      patch.episodeId ?? null,
      1,
      1,
    ],
  );
  const items = await new HomeService(db).list('s');
  const item = items.find((candidate) => candidate.feed?.id === 'f');
  if (!item) throw new Error('feed item was not created');
  return item;
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

  it('switches from timeline playback to the latest available exported file', async () => {
    const { db, engine, filePlayer, svc } = await setup({ withVoice: true });
    await db.run(
      'INSERT INTO exports (id, episode_id, format, preset, status, path, duration_smp, created_at) VALUES (?,?,?,?,?,?,?,?)',
      ['x1', 'e', 'm4a', '{}', 'done', 'episodes/e/exports/x1.m4a', TOTAL, 2],
    );
    await svc.reload('e');
    await svc.toggle();
    expect(await svc.toggleHome(await localHomeItem(db))).toBe(true);
    expect(engine.playing).toBe(false);
    expect(filePlayer.calls).toEqual([
      'pause',
      'load:file:///root/episodes/e/exports/x1.m4a',
      'play',
    ]);
    expect(svc.source).toMatchObject({ kind: 'export', episodeId: 'e', exportId: 'x1' });
  });

  it('does not expose or play an export whose file is missing', async () => {
    const { db, existing, svc } = await setup();
    existing.clear();
    await db.run(
      'INSERT INTO exports (id, episode_id, format, preset, status, path, duration_smp, created_at) VALUES (?,?,?,?,?,?,?,?)',
      ['x1', 'e', 'm4a', '{}', 'done', 'episodes/e/exports/x1.m4a', TOTAL, 2],
    );
    const item = await localHomeItem(db);
    expect(await svc.availableHomeItemKeys([item])).toEqual(new Set());
    expect(await svc.toggleHome(item)).toBe(false);
    expect(svc.source).toBeNull();
  });

  it('stops exported-file playback before recording starts', async () => {
    const { db, filePlayer, svc } = await setup();
    await db.run(
      'INSERT INTO exports (id, episode_id, format, preset, status, path, duration_smp, created_at) VALUES (?,?,?,?,?,?,?,?)',
      ['x1', 'e', 'm4a', '{}', 'done', 'episodes/e/exports/x1.m4a', TOTAL, 2],
    );
    await svc.toggleHome(await localHomeItem(db));
    await svc.stopForRecording();
    expect(filePlayer.calls.at(-1)).toBe('pause');
  });

  it('stops timeline playback before recording starts', async () => {
    const { engine, svc } = await setup({ withVoice: true });
    await svc.reload('e');
    await svc.toggle();
    await svc.stopForRecording();
    expect(engine.playing).toBe(false);
    expect(svc.isPlaying).toBe(false);
  });

  it('keeps exported-file playback as the single active source while an editor loads', async () => {
    const { db, engine, filePlayer, svc } = await setup({ withVoice: true });
    await db.run(
      'INSERT INTO exports (id, episode_id, format, preset, status, path, duration_smp, created_at) VALUES (?,?,?,?,?,?,?,?)',
      ['x1', 'e', 'm4a', '{}', 'done', 'episodes/e/exports/x1.m4a', TOTAL, 2],
    );
    await svc.toggleHome(await localHomeItem(db));
    await svc.reload('e');
    expect(svc.source).toMatchObject({ kind: 'export', exportId: 'x1' });
    expect(svc.duration).toBe(TOTAL);
    expect(engine.playing).toBe(false);
    expect(filePlayer.calls.at(-1)).toBe('play');
  });

  it('falls back to the newest exported file that still exists', async () => {
    const { db, existing, filePlayer, svc } = await setup();
    existing.add('/root/episodes/e/exports/older.m4a');
    await db.run(
      'INSERT INTO exports (id, episode_id, format, preset, status, path, duration_smp, created_at) VALUES (?,?,?,?,?,?,?,?)',
      ['old', 'e', 'm4a', '{}', 'done', 'episodes/e/exports/older.m4a', TOTAL, 2],
    );
    await db.run(
      'INSERT INTO exports (id, episode_id, format, preset, status, path, duration_smp, created_at) VALUES (?,?,?,?,?,?,?,?)',
      ['new', 'e', 'm4a', '{}', 'done', 'episodes/e/exports/missing.m4a', TOTAL, 3],
    );
    expect(await svc.toggleHome(await localHomeItem(db))).toBe(true);
    expect(filePlayer.calls).toContain('load:file:///root/episodes/e/exports/older.m4a');
  });

  it('falls back to the linked RSS enclosure when no exported file exists', async () => {
    const { db, filePlayer, svc } = await setup();
    const item = await insertFeedEpisode(db, { episodeId: 'e' });
    expect(await svc.toggleHome(item)).toBe(true);
    expect(filePlayer.calls).toContain('load:https://example.test/episode.mp3');
    expect(svc.source).toMatchObject({ kind: 'rss', episodeId: 'e', feedEpisodeId: 'f' });
  });

  it('plays an imported RSS-only episode from its enclosure', async () => {
    const { db, filePlayer, svc } = await setup();
    const item = await insertFeedEpisode(db);
    expect(item.local).toBeNull();
    expect(await svc.toggleHome(item)).toBe(true);
    expect(filePlayer.calls).toContain('load:https://example.test/episode.mp3');
  });

  it('falls back to the local timeline when no export or RSS enclosure exists', async () => {
    const { db, engine, svc } = await setup({ withVoice: true });
    const item = await localHomeItem(db);
    expect(await svc.toggleHome(item)).toBe(true);
    expect(engine.calls).toContain('play:null');
    expect(svc.source).toMatchObject({ kind: 'timeline', episodeId: 'e', homeKey: item.key });
  });

  it('prefers an exported file over RSS and the local timeline', async () => {
    const { db, filePlayer, svc } = await setup({ withVoice: true });
    await db.run(
      'INSERT INTO exports (id, episode_id, format, preset, status, path, duration_smp, created_at) VALUES (?,?,?,?,?,?,?,?)',
      ['x1', 'e', 'm4a', '{}', 'done', 'episodes/e/exports/x1.m4a', TOTAL, 2],
    );
    const item = await insertFeedEpisode(db, { episodeId: 'e' });
    expect(await svc.toggleHome(item)).toBe(true);
    expect(filePlayer.calls).toContain('load:file:///root/episodes/e/exports/x1.m4a');
    expect(filePlayer.calls).not.toContain('load:https://example.test/episode.mp3');
    expect(svc.source).toMatchObject({ kind: 'export', exportId: 'x1' });
  });
});
