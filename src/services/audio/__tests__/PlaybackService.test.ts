import { smp } from '@/domain/time';
import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { saveDoc } from '@/infra/db/repositories/editableDocRepo';
import { currentSourceFingerprint } from '@/services/export/sourceFingerprint';
import { HomeService, type HomeEpisodeItem } from '@/services/home/HomeService';

import { TEST_LABELS } from '@/services/app/__tests__/labels';

import type { NowPlayingCommand, NowPlayingInfo, NowPlayingPort } from '../NowPlayingPort';
import { PlaybackService } from '../PlaybackService';
import type { FilePlaybackPort, FilePlaybackStatus } from '../FilePlaybackPort';
import { FakeAudioEngine } from './FakeAudioEngine';

const TOTAL = 96000;

class FakeFilePlayer implements FilePlaybackPort {
  calls: string[] = [];
  listener: ((s: FilePlaybackStatus) => void) | null = null;
  /** 次の load を失敗させる */
  failNextLoad = false;
  /** 設定すると、load はこの Promise が解決するまで待つ（読み込みの遅い回線） */
  gate: Promise<void> | null = null;
  async load(uri: string) {
    this.calls.push(`load:${uri}`);
    if (this.gate) await this.gate;
    if (this.failNextLoad) {
      this.failNextLoad = false;
      throw new Error('load failed');
    }
  }
  emit(patch: Partial<FilePlaybackStatus>) {
    this.listener?.({
      playing: false,
      position: smp(0),
      duration: smp(TOTAL),
      ended: false,
      loading: false,
      failed: false,
      ...patch,
    });
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

class FakeNowPlaying implements NowPlayingPort {
  /** 送った内容（null は消した）。 */
  log: (NowPlayingInfo | null)[] = [];
  private fn: ((c: NowPlayingCommand) => void) | null = null;
  update(info: NowPlayingInfo) {
    this.log.push(info);
  }
  clear() {
    this.log.push(null);
  }
  onCommand(fn: (c: NowPlayingCommand) => void) {
    this.fn = fn;
    return { remove: () => (this.fn = null) };
  }
  /** ロック画面から操作した。 */
  send(c: NowPlayingCommand) {
    this.fn?.(c);
  }
  get last() {
    return this.log.at(-1);
  }
  get shown() {
    return this.log.length > 0 && this.log.at(-1) !== null;
  }
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
  const session = { enterPlayback: jest.fn(async () => {}) };
  const recorder = { busy: false };
  const nowPlaying = new FakeNowPlaying();
  const svc = new PlaybackService({
    db,
    engine,
    filePlayer,
    fileExists: (path) => existing.has(path),
    root: '/root',
    session,
    recorderBusy: () => recorder.busy,
    nowPlaying,
    labels: () => TEST_LABELS.nowPlaying,
  });
  return { db, engine, filePlayer, existing, svc, session, recorder, nowPlaying };
}

/** 今の編集と同じ音の書き出し（`source_fingerprint` が今の値）を入れる。Issue #168 */
async function insertCurrentExport(
  db: ReturnType<typeof createNodeSqliteExecutor>,
  id: string,
  opts: { file?: string; createdAt?: number; fingerprint?: string | null } = {},
) {
  const fingerprint =
    opts.fingerprint === undefined ? await currentSourceFingerprint(db, 'e') : opts.fingerprint;
  await db.run(
    'INSERT INTO exports (id, episode_id, format, preset, status, path, duration_smp, source_fingerprint, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [
      id,
      'e',
      'm4a',
      '{}',
      'done',
      `episodes/e/exports/${opts.file ?? id}.m4a`,
      TOTAL,
      fingerprint,
      opts.createdAt ?? 2,
    ],
  );
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

  // Issue #174: 書き出しタブの試聴は書き出すチャンネルで鳴らす。サンプルレートはタイムラインのまま
  it('reloads in the export channels at the same position, and back to stereo', async () => {
    const { engine, svc } = await setup({ withVoice: true });
    await svc.reload('e');
    await svc.seek(smp(48000));
    await svc.toggle();
    await svc.setTimelineChannels(1);
    expect(engine.timelines.at(-1)).toMatchObject({ channels: 1, sampleRate: 48000 });
    expect(svc.isPlaying).toBe(true);
    expect(svc.position).toBe(48000);
    const loads = engine.timelines.length;
    await svc.setTimelineChannels(1);
    expect(engine.timelines).toHaveLength(loads);
    await svc.setTimelineChannels(2);
    expect(engine.timelines.at(-1)).toMatchObject({ channels: 2 });
    // 編集で読み直してもチャンネルは保たれる
    await svc.setTimelineChannels(1);
    await svc.reload('e');
    expect(engine.timelines.at(-1)).toMatchObject({ channels: 1 });
  });

  it('remembers the channels before any timeline is loaded', async () => {
    const { engine, svc } = await setup();
    await svc.setTimelineChannels(1);
    expect(engine.timelines).toHaveLength(0);
    await svc.reload('e');
    expect(engine.timelines[0]).toMatchObject({ channels: 1 });
  });

  describe('playing a range (Issue #177)', () => {
    it('stops at the end of the range and leaves the position there', async () => {
      const { engine, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      const positions: number[] = [];
      svc.on('position', (e) => positions.push(e.frame));
      await svc.playRange(smp(12000), smp(36000));
      expect(engine.calls).toContain('play:12000');
      expect(svc.isPlaying).toBe(true);
      engine.emit('onPosition', { frame: 24000 });
      expect(svc.isPlaying).toBe(true);
      // 位置の通知は少し過ぎてから届く
      engine.emit('onPosition', { frame: 37000 });
      await new Promise((r) => setImmediate(r));
      expect(svc.isPlaying).toBe(false);
      expect(svc.position).toBe(36000);
      expect(positions).not.toContain(37000);
      expect(positions.at(-1)).toBe(36000);
    });

    it('does not stop at the end once the user pauses and plays again', async () => {
      const { engine, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.playRange(smp(12000), smp(36000));
      await svc.toggle(); // 止める
      await svc.toggle(); // 続きから
      engine.emit('onPosition', { frame: 40000 });
      await new Promise((r) => setImmediate(r));
      expect(svc.isPlaying).toBe(true);
      expect(svc.position).toBe(40000);
    });

    it('does not stop at the end after a seek', async () => {
      const { engine, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.playRange(smp(12000), smp(36000));
      await svc.seek(smp(30000));
      engine.emit('onPosition', { frame: 40000 });
      await new Promise((r) => setImmediate(r));
      expect(svc.isPlaying).toBe(true);
    });
  });

  describe('preview sound (Issue #158)', () => {
    const sound = {
      loudness: { enabled: true, targetLufs: -16, truePeakDbtp: -1 },
      ducking: { enabled: true, depthDb: -10, attackMs: 50, releaseMs: 500, thresholdDb: -40 },
    };

    it('changes the sound while playing without reloading the timeline', async () => {
      const { engine, svc } = await setup({ withVoice: true });
      await svc.setTimelineChannels(1);
      await svc.reload('e');
      await svc.play(smp(48000));
      const loads = engine.timelines.length;
      await svc.setTimelineSound('e', sound, { channels: 1, gainDb: 3.5 });
      expect(engine.timelines).toHaveLength(loads);
      expect(svc.isPlaying).toBe(true);
      expect(engine.sounds.at(-1)).toEqual({
        ducking: sound.ducking,
        loudness: { ...sound.loudness, gainDb: 3.5 },
      });
    });

    it('loads the timeline with the gain only for the channels it was measured for', async () => {
      const { engine, svc } = await setup({ withVoice: true });
      await svc.setTimelineChannels(1);
      await svc.setTimelineSound('e', sound, { channels: 1, gainDb: -2 });
      // 読み込む前は覚えておくだけ
      expect(engine.sounds).toHaveLength(0);
      await svc.reload('e');
      expect(engine.timelines.at(-1)).toMatchObject({ loudness: { gainDb: -2 } });
      // ステレオで鳴らすときは、モノラルで測ったゲインを使わない（約 3 LU 違う）
      await svc.setTimelineChannels(2);
      expect(
        (engine.timelines.at(-1) as { loudness: { gainDb?: number } }).loudness.gainDb,
      ).toBeUndefined();
      // 別の回のゲインも使わない
      await svc.setTimelineChannels(1);
      await svc.setTimelineSound('other', sound, { channels: 1, gainDb: 5 });
      await svc.reload('e');
      expect(
        (engine.timelines.at(-1) as { loudness: { gainDb?: number } }).loudness.gainDb,
      ).toBeUndefined();
    });

    it('drops the gain when the export tab is left', async () => {
      const { engine, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.setTimelineSound('e', sound, { channels: 2, gainDb: 4 });
      await svc.setTimelineSound('e', sound, null);
      expect(engine.sounds.at(-1)).toEqual({ ducking: sound.ducking, loudness: sound.loudness });
      await svc.reload('e');
      expect(
        (engine.timelines.at(-1) as { loudness: { gainDb?: number } }).loudness.gainDb,
      ).toBeUndefined();
    });
  });

  it('pauses when toggled while playing', async () => {
    const { svc } = await setup({ withVoice: true });
    await svc.reload('e');
    await svc.toggle();
    await svc.toggle();
    expect(svc.isPlaying).toBe(false);
  });

  // Issue #229: iOS は音声セッションの有効化を別スレッドで待つので、playing の通知は少し遅れて届く。
  // その間にもう一度押したら「止める」として扱い、始めかけの再生を取り消す。
  describe('toggled again while starting (Issue #229)', () => {
    it('pauses instead of starting twice while the engine is starting', async () => {
      const { engine, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      let finish = () => {};
      let reached = () => {};
      const playCalled = new Promise<void>((r) => (reached = r));
      const play = jest.spyOn(engine, 'play').mockImplementation(() => {
        reached();
        return new Promise<void>((r) => (finish = r));
      });
      const pause = jest.spyOn(engine, 'pause');
      const first = svc.toggle();
      await playCalled;
      await svc.toggle();
      finish();
      await first;
      expect(play).toHaveBeenCalledTimes(1);
      expect(pause).toHaveBeenCalledTimes(1);
      expect(svc.isPlaying).toBe(false);
    });

    it('does not start the engine when paused while the audio mode is being set', async () => {
      const { engine, session, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      let entered = () => {};
      session.enterPlayback.mockImplementationOnce(() => new Promise<void>((r) => (entered = r)));
      const play = jest.spyOn(engine, 'play');
      const first = svc.toggle();
      await svc.pause();
      entered();
      await first;
      expect(play).not.toHaveBeenCalled();
      expect(svc.isPlaying).toBe(false);
    });

    it('plays normally once the start has finished', async () => {
      const { engine, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.toggle();
      expect(engine.playing).toBe(true);
      expect(svc.isPlaying).toBe(true);
    });
  });

  it('switches from timeline playback to the latest available exported file', async () => {
    const { db, engine, filePlayer, svc } = await setup({ withVoice: true });
    await insertCurrentExport(db, 'x1');
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

  it('stops and forgets an export that is being deleted (Issue #152)', async () => {
    const { db, filePlayer, svc } = await setup({ withVoice: true });
    await insertCurrentExport(db, 'x1');
    const states: boolean[] = [];
    svc.on('state', (e) => states.push(e.playing));
    await svc.toggleHome(await localHomeItem(db));
    filePlayer.calls = [];
    await svc.forgetExport('other');
    expect(svc.source).toMatchObject({ kind: 'export', exportId: 'x1' });
    await svc.forgetExport('x1');
    expect(filePlayer.calls).toEqual(['pause']);
    expect(svc.source).toBeNull();
    expect(svc.isPlaying).toBe(false);
    expect(states.at(-1)).toBe(false);
  });

  // Issue #164: エピソード画面を開いたら Home の再生を止め、再生音が録音に入らないようにする
  it('stops and releases exported-file playback started from Home', async () => {
    const { db, filePlayer, svc } = await setup({ withVoice: true });
    await insertCurrentExport(db, 'x1');
    const states: boolean[] = [];
    svc.on('state', (e) => states.push(e.playing));
    await svc.toggleHome(await localHomeItem(db));
    filePlayer.calls = [];
    await svc.stopHome();
    expect(filePlayer.calls).toEqual(['pause']);
    expect(svc.source).toBeNull();
    expect(svc.isPlaying).toBe(false);
    expect(states.at(-1)).toBe(false);
  });

  it('stops Home timeline playback and does not resume it when the editor reloads', async () => {
    const { db, engine, svc } = await setup({ withVoice: true });
    await svc.toggleHome(await localHomeItem(db));
    expect(engine.playing).toBe(true);
    const stopping = svc.stopHome();
    // 画面はすぐに読み込み直す。await を待たずに状態が止まっていること
    expect(svc.isPlaying).toBe(false);
    await stopping;
    await svc.reload('e');
    expect(engine.playing).toBe(false);
    expect(svc.isPlaying).toBe(false);
    expect(svc.source?.homeKey).toBeUndefined();
    expect(svc.source).toMatchObject({ kind: 'timeline', episodeId: 'e' });
  });

  it('leaves editor playback alone when nothing was started from Home', async () => {
    const { engine, svc } = await setup({ withVoice: true });
    await svc.reload('e');
    await svc.toggle();
    await svc.stopHome();
    expect(engine.playing).toBe(true);
    expect(svc.isPlaying).toBe(true);
  });

  it('does not expose or play an export whose file is missing', async () => {
    const { db, existing, svc } = await setup();
    existing.clear();
    await insertCurrentExport(db, 'x1');
    const item = await localHomeItem(db);
    expect(await svc.availableHomeItemKeys([item])).toEqual(new Set());
    expect(await svc.toggleHome(item)).toBe(false);
    expect(svc.source).toBeNull();
  });

  it('stops exported-file playback before recording starts', async () => {
    const { db, filePlayer, svc } = await setup();
    await insertCurrentExport(db, 'x1');
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
    await insertCurrentExport(db, 'x1');
    await svc.toggleHome(await localHomeItem(db));
    await svc.reload('e');
    expect(svc.source).toMatchObject({ kind: 'export', exportId: 'x1' });
    expect(svc.duration).toBe(TOTAL);
    expect(engine.playing).toBe(false);
    expect(filePlayer.calls.at(-1)).toBe('play');
  });

  // Issue #168: 書き出したあとに編集した回は、古い書き出しではなく今のタイムラインを鳴らす（FR-EP-7）
  it('plays the timeline instead of an export older than the current edit', async () => {
    const { db, engine, filePlayer, svc } = await setup({ withVoice: true });
    await insertCurrentExport(db, 'x1');
    await saveDoc(db, 'e', { voice: [], overlays: [] }, 3);
    await saveDoc(
      db,
      'e',
      {
        voice: [
          {
            id: 'v2',
            takeId: 'T',
            srcStart: smp(0),
            srcEnd: smp(TOTAL / 2),
            gainDb: 0,
            fadeIn: smp(0),
            fadeOut: smp(0),
          },
        ],
        overlays: [],
      },
      3,
    );
    const item = await localHomeItem(db);
    expect(await svc.availableHomeItemKeys([item])).toEqual(new Set([item.key]));
    expect(await svc.toggleHome(item)).toBe(true);
    expect(filePlayer.calls).not.toContain('load:file:///root/episodes/e/exports/x1.m4a');
    expect(engine.playing).toBe(true);
    expect(svc.source).toMatchObject({ kind: 'timeline', episodeId: 'e' });
  });

  it('plays the export again once the edit is undone to the exported state', async () => {
    const { db, filePlayer, svc } = await setup({ withVoice: true });
    await insertCurrentExport(db, 'x1');
    const exported = await currentSourceFingerprint(db, 'e');
    await db.run('UPDATE episodes SET sound_settings = ? WHERE id = ?', [
      JSON.stringify({ ducking: { enabled: false } }),
      'e',
    ]);
    expect(await currentSourceFingerprint(db, 'e')).not.toBe(exported);
    await db.run("UPDATE episodes SET sound_settings = '{}' WHERE id = ?", ['e']);
    expect(await svc.toggleHome(await localHomeItem(db))).toBe(true);
    expect(filePlayer.calls).toContain('load:file:///root/episodes/e/exports/x1.m4a');
  });

  it('treats an export without a fingerprint (before 0006) as old', async () => {
    const { db, engine, filePlayer, svc } = await setup({ withVoice: true });
    await insertCurrentExport(db, 'x1', { fingerprint: null });
    expect(await svc.toggleHome(await localHomeItem(db))).toBe(true);
    expect(filePlayer.calls).not.toContain('load:file:///root/episodes/e/exports/x1.m4a');
    expect(engine.playing).toBe(true);
  });

  it('falls back to the newest exported file that still exists', async () => {
    const { db, existing, filePlayer, svc } = await setup();
    existing.add('/root/episodes/e/exports/older.m4a');
    await insertCurrentExport(db, 'old', { file: 'older' });
    await insertCurrentExport(db, 'new', { file: 'missing', createdAt: 3 });
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
    await insertCurrentExport(db, 'x1');
    const item = await insertFeedEpisode(db, { episodeId: 'e' });
    expect(await svc.toggleHome(item)).toBe(true);
    expect(filePlayer.calls).toContain('load:file:///root/episodes/e/exports/x1.m4a');
    expect(filePlayer.calls).not.toContain('load:https://example.test/episode.mp3');
    expect(svc.source).toMatchObject({ kind: 'export', exportId: 'x1' });
  });

  describe('loading and failure of file playback (Issue #185)', () => {
    it('reports loading before the audio is ready, then playing once it is loaded', async () => {
      const { db, filePlayer, svc } = await setup();
      const item = await insertFeedEpisode(db);
      const states: boolean[] = [];
      svc.on('state', () => states.push(svc.isLoading));
      expect(await svc.toggleHome(item)).toBe(true);
      expect(states[0]).toBe(true);
      expect(svc.isPlaying).toBe(true);

      // 読み込み中・バッファ待ちの通知（expo-audio は playing=false を返すことがある）
      filePlayer.emit({ loading: true, playing: false });
      expect(svc.isLoading).toBe(true);
      expect(svc.isPlaying).toBe(true);

      filePlayer.emit({ loading: false, playing: true, position: smp(4800) });
      expect(svc.isLoading).toBe(false);
      expect(svc.isPlaying).toBe(true);
      expect(svc.error).toBeNull();
    });

    it('reports a stream failure with a code and retries on the next toggle', async () => {
      const { db, filePlayer, svc } = await setup();
      const item = await insertFeedEpisode(db);
      await svc.toggleHome(item);
      filePlayer.emit({ failed: true, loading: true });
      expect(svc.error).toBe('playback_stream_failed');
      expect(svc.isLoading).toBe(false);
      expect(svc.isPlaying).toBe(false);
      expect(svc.source).toMatchObject({ kind: 'rss', homeKey: item.key });

      filePlayer.calls = [];
      expect(await svc.toggleCurrentHome()).toBe(true);
      expect(filePlayer.calls).toEqual(['load:https://example.test/episode.mp3', 'play']);
      expect(svc.error).toBeNull();
      expect(svc.isLoading).toBe(true);
    });

    it('turns a load that throws into a failure instead of rejecting', async () => {
      const { db, filePlayer, svc } = await setup();
      await insertCurrentExport(db, 'x1');
      filePlayer.failNextLoad = true;
      await expect(svc.toggleHome(await localHomeItem(db))).resolves.toBe(true);
      expect(svc.error).toBe('playback_file_failed');
      expect(svc.isPlaying).toBe(false);
      expect(filePlayer.calls).not.toContain('play');
    });

    it('does not start playing when paused while the audio is still loading', async () => {
      const { db, filePlayer, svc } = await setup();
      const item = await insertFeedEpisode(db);
      let open: () => void = () => undefined;
      filePlayer.gate = new Promise((resolve) => (open = resolve));
      const started = svc.toggleHome(item);
      await new Promise((r) => setImmediate(r));
      expect(svc.isLoading).toBe(true);
      await svc.toggleCurrentHome();
      expect(svc.isPlaying).toBe(false);
      expect(svc.isLoading).toBe(false);
      open();
      await started;
      expect(filePlayer.calls).not.toContain('play');
    });

    it('ignores a slow load that was replaced by another episode', async () => {
      const { db, filePlayer, svc } = await setup();
      const rss = await insertFeedEpisode(db);
      await insertCurrentExport(db, 'x1');
      let open: () => void = () => undefined;
      filePlayer.gate = new Promise((resolve) => (open = resolve));
      filePlayer.failNextLoad = true;
      const first = svc.toggleHome(rss);
      await new Promise((r) => setImmediate(r));
      filePlayer.gate = null;
      const local = (await new HomeService(db).list('s')).find((i) => i.local?.id === 'e');
      if (!local) throw new Error('local item missing');
      // 2 本目の読み込みを先に終わらせ、1 本目の失敗が後から届いても上書きしない
      filePlayer.failNextLoad = false;
      await svc.toggleHome(local);
      filePlayer.failNextLoad = true;
      open();
      await first;
      expect(svc.source).toMatchObject({ kind: 'export', exportId: 'x1' });
      expect(svc.error).toBeNull();
    });
  });
});

// Issue #183: 再生の音声モードと割り込み（AUDIO_DESIGN.md §10）
describe('PlaybackService asset preview (Issue #174)', () => {
  const ASSET = { assetId: 'a1', path: 'assets/a1.wav', duration: smp(TOTAL) };

  it('plays the asset after applying the playback mode, and does not show it as a Home source', async () => {
    const { filePlayer, session, svc } = await setup();
    const play = jest.spyOn(filePlayer, 'play');
    expect(await svc.toggleAssetPreview(ASSET)).toBe(true);
    expect(filePlayer.calls).toEqual(['load:file:///root/assets/a1.wav', 'play']);
    expect(session.enterPlayback.mock.invocationCallOrder[0]).toBeLessThan(
      play.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(svc.previewingAssetId).toBe('a1');
    // ミニプレーヤーには出さない
    expect(svc.source).toBeNull();
  });

  it('stops when the same asset is toggled again, and switches when another is toggled', async () => {
    const { filePlayer, svc } = await setup();
    await svc.toggleAssetPreview(ASSET);
    await svc.toggleAssetPreview({ ...ASSET, assetId: 'a2', path: 'assets/a2.wav' });
    expect(svc.previewingAssetId).toBe('a2');
    filePlayer.calls = [];
    expect(await svc.toggleAssetPreview({ ...ASSET, assetId: 'a2', path: 'assets/a2.wav' })).toBe(
      false,
    );
    expect(filePlayer.calls).toEqual(['pause']);
    expect(svc.previewingAssetId).toBeNull();
    expect(svc.isPlaying).toBe(false);
  });

  it('stops other playback when a preview starts', async () => {
    const { db, engine, svc } = await setup({ withVoice: true });
    await insertCurrentExport(db, 'x1');
    await svc.reload('e');
    await svc.toggle();
    expect(engine.playing).toBe(true);
    await svc.toggleAssetPreview(ASSET);
    expect(engine.playing).toBe(false);
    // Home の再生を始めると試聴は終わる
    await svc.toggleHome(await localHomeItem(db));
    expect(svc.previewingAssetId).toBeNull();
    expect(svc.source).toMatchObject({ kind: 'export' });
  });

  it('does not start while the recorder holds the audio session', async () => {
    const { filePlayer, recorder, svc } = await setup();
    recorder.busy = true;
    expect(await svc.toggleAssetPreview(ASSET)).toBe(false);
    expect(filePlayer.calls).toEqual([]);
    expect(svc.previewingAssetId).toBeNull();
  });

  it('is released by stopAssetPreview, and leaves Home playback alone', async () => {
    const { db, filePlayer, svc } = await setup({ withVoice: true });
    await svc.toggleAssetPreview(ASSET);
    filePlayer.calls = [];
    svc.stopAssetPreview();
    expect(filePlayer.calls).toEqual(['pause']);
    expect(svc.previewingAssetId).toBeNull();

    await insertCurrentExport(db, 'x1');
    await svc.toggleHome(await localHomeItem(db));
    filePlayer.calls = [];
    svc.stopAssetPreview();
    expect(filePlayer.calls).toEqual([]);
    expect(svc.source).toMatchObject({ kind: 'export' });
  });

  it('ends the preview when the file finishes', async () => {
    const { filePlayer, svc } = await setup();
    await svc.toggleAssetPreview(ASSET);
    filePlayer.emit({ playing: false, ended: true, position: smp(TOTAL) });
    expect(svc.previewingAssetId).toBeNull();
  });
});

describe('PlaybackService audio session (Issue #183)', () => {
  async function withExport(db: ReturnType<typeof createNodeSqliteExecutor>) {
    await insertCurrentExport(db, 'x1');
    return localHomeItem(db);
  }

  /** a が b より先に呼ばれた。 */
  function calledBefore(a: jest.Mock | jest.SpyInstance, b: jest.Mock | jest.SpyInstance) {
    expect(a.mock.invocationCallOrder[0]).toBeLessThan(b.mock.invocationCallOrder[0] ?? Infinity);
  }

  describe('playback mode is applied right before every start', () => {
    it('timeline', async () => {
      const { engine, session, svc } = await setup({ withVoice: true });
      const play = jest.spyOn(engine, 'play');
      await svc.reload('e');
      await svc.toggle();
      expect(session.enterPlayback).toHaveBeenCalledTimes(1);
      calledBefore(session.enterPlayback, play);
      await svc.toggle(); // 一時停止
      await svc.toggle(); // 再開（録音のあとに録音用の設定が残っていても、ここで戻す）
      expect(session.enterPlayback).toHaveBeenCalledTimes(2);
    });

    it('exported file, and resuming it', async () => {
      const { db, filePlayer, session, svc } = await setup({ withVoice: true });
      const play = jest.spyOn(filePlayer, 'play');
      await svc.toggleHome(await withExport(db));
      expect(play).toHaveBeenCalledTimes(1);
      calledBefore(session.enterPlayback, play);
      await svc.toggleCurrentHome(); // 一時停止
      await svc.toggleCurrentHome(); // 再開
      expect(session.enterPlayback).toHaveBeenCalledTimes(2);
      expect(play).toHaveBeenCalledTimes(2);
    });

    it('still plays when the mode cannot be applied', async () => {
      const { engine, session, svc } = await setup({ withVoice: true });
      session.enterPlayback.mockRejectedValueOnce(new Error('session busy'));
      await svc.reload('e');
      await svc.toggle();
      expect(engine.playing).toBe(true);
    });
  });

  describe('does not start while the recorder holds the session', () => {
    it('timeline', async () => {
      const { engine, recorder, session, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      recorder.busy = true;
      await svc.toggle();
      expect(engine.playing).toBe(false);
      expect(session.enterPlayback).not.toHaveBeenCalled();
    });

    it('home', async () => {
      const { db, filePlayer, recorder, svc } = await setup({ withVoice: true });
      recorder.busy = true;
      expect(await svc.toggleHome(await withExport(db))).toBe(false);
      expect(filePlayer.calls).toEqual([]);
      expect(svc.source).toBeNull();
    });
  });

  describe('interruption (call, other app)', () => {
    it('pauses the timeline and resumes it when the OS suggests', async () => {
      const { engine, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.seek(smp(48000));
      await svc.toggle();
      // ネイティブは割り込みを送ってから止める
      engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
      await flush();
      expect(engine.playing).toBe(false);
      expect(svc.isPlaying).toBe(false);
      engine.emit('onPlaybackInterruption', { type: 'ended', shouldResume: true });
      await flush();
      expect(engine.playing).toBe(true);
      expect(engine.calls.at(-1)).toBe('play:null'); // 止めた位置から
    });

    it('pauses the file and resumes it when the OS suggests', async () => {
      const { db, engine, filePlayer, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      filePlayer.calls = [];
      engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
      await flush();
      expect(filePlayer.calls).toEqual(['pause']);
      expect(svc.isPlaying).toBe(false);
      engine.emit('onPlaybackInterruption', { type: 'ended', shouldResume: true });
      await flush();
      expect(filePlayer.calls).toEqual(['pause', 'play']);
      expect(svc.isPlaying).toBe(true);
    });

    it('stays paused when the OS does not suggest resuming', async () => {
      const { engine, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.toggle();
      engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
      await flush();
      engine.emit('onPlaybackInterruption', { type: 'ended', shouldResume: false });
      await flush();
      expect(engine.playing).toBe(false);
    });

    it('does not start playing when nothing was playing at the interruption', async () => {
      const { engine, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
      engine.emit('onPlaybackInterruption', { type: 'ended', shouldResume: true });
      await flush();
      expect(engine.playing).toBe(false);
      expect(engine.calls).not.toContain('play:null');
    });

    it('does not resume after the user paused during the interruption', async () => {
      const { db, engine, filePlayer, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
      await flush();
      await svc.stopHome(); // ミニプレーヤーを閉じた
      filePlayer.calls = [];
      engine.emit('onPlaybackInterruption', { type: 'ended', shouldResume: true });
      await flush();
      expect(filePlayer.calls).toEqual([]);
      expect(svc.isPlaying).toBe(false);
    });

    it('does not resume once recording has started', async () => {
      const { engine, recorder, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.toggle();
      engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
      await flush();
      recorder.busy = true; // 割り込みの間に録音（入力モニター）を始めた
      engine.emit('onPlaybackInterruption', { type: 'ended', shouldResume: true });
      await flush();
      expect(engine.playing).toBe(false);
    });

    it('does not resume after stopForRecording', async () => {
      const { engine, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.toggle();
      engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
      await flush();
      await svc.stopForRecording();
      engine.emit('onPlaybackInterruption', { type: 'ended', shouldResume: true });
      await flush();
      expect(engine.playing).toBe(false);
    });

    it('does not resume a file after the user switched to the timeline', async () => {
      const { db, engine, filePlayer, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
      await flush();
      await svc.reload('e');
      await svc.toggle(); // 書き出しタブで試聴を始めた
      await svc.toggle(); // 止めた
      filePlayer.calls = [];
      engine.emit('onPlaybackInterruption', { type: 'ended', shouldResume: true });
      await flush();
      expect(filePlayer.calls).toEqual([]);
      expect(engine.playing).toBe(false);
    });
  });

  // expo-audio は割り込みの終了で、自分が止めたプレイヤーを利用者の操作に関係なく鳴らし直す
  describe('expo-audio resuming the file by itself', () => {
    it('is stopped again when the user closed the player during the interruption', async () => {
      const { db, engine, filePlayer, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      filePlayer.emit({ playing: true });
      engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
      await flush();
      await svc.stopHome();
      const states: boolean[] = [];
      svc.on('state', (e) => states.push(e.playing));
      filePlayer.calls = [];
      filePlayer.emit({ playing: true }); // expo-audio が鳴らし直した
      expect(filePlayer.calls).toEqual(['pause']);
      expect(svc.isPlaying).toBe(false);
      expect(states).toEqual([]);
    });

    it('is stopped again when the user paused during the interruption', async () => {
      const { db, filePlayer, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      filePlayer.emit({ playing: true });
      filePlayer.emit({ playing: false }); // Android: expo-audio がフォーカスの喪失で止めた（イベントは来ない）
      await svc.pause();
      filePlayer.calls = [];
      filePlayer.emit({ playing: true }); // AUDIOFOCUS_GAIN で expo-audio が鳴らし直した
      expect(filePlayer.calls).toEqual(['pause']);
      expect(svc.isPlaying).toBe(false);
    });

    it('is accepted when nobody touched it (Android: no interruption event for files)', async () => {
      const { db, filePlayer, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      filePlayer.emit({ playing: true });
      filePlayer.emit({ playing: false });
      expect(svc.isPlaying).toBe(false);
      filePlayer.calls = [];
      filePlayer.emit({ playing: true });
      expect(filePlayer.calls).toEqual([]);
      expect(svc.isPlaying).toBe(true);
    });

    it('still resumes when the paused status arrives before the interruption event (iOS)', async () => {
      const { db, engine, filePlayer, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      filePlayer.emit({ playing: true });
      filePlayer.emit({ playing: false }); // expo-audio が先に止めた
      engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
      await flush();
      filePlayer.calls = [];
      engine.emit('onPlaybackInterruption', { type: 'ended', shouldResume: true });
      await flush();
      expect(filePlayer.calls).toEqual(['play']);
      filePlayer.emit({ playing: true });
      expect(svc.isPlaying).toBe(true);
      expect(filePlayer.calls).toEqual(['play']);
    });

    it('does not resume after an unplug that expo-audio reported first', async () => {
      const { db, engine, filePlayer, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      filePlayer.emit({ playing: true });
      filePlayer.emit({ playing: false }); // iOS: expo-audio も抜去で止める
      engine.emit('onOutputDisconnected', { reason: 'old_device_unavailable' });
      await flush();
      // 止めたあとに着信が来て終わった
      engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
      engine.emit('onPlaybackInterruption', { type: 'ended', shouldResume: true });
      await flush();
      expect(filePlayer.calls.filter((c) => c === 'play')).toHaveLength(1); // 最初の再生だけ
      expect(svc.isPlaying).toBe(false);
    });
  });

  describe('headphones / Bluetooth disconnected', () => {
    it('pauses the timeline and does not resume it', async () => {
      const { engine, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.toggle();
      engine.emit('onOutputDisconnected', { reason: 'old_device_unavailable' });
      await flush();
      expect(engine.playing).toBe(false);
      expect(svc.isPlaying).toBe(false);
      // 抜去のあとに割り込みの終了が来ても鳴らさない
      engine.emit('onPlaybackInterruption', { type: 'ended', shouldResume: true });
      await flush();
      expect(engine.playing).toBe(false);
    });

    it('pauses the file and does not resume it', async () => {
      const { db, engine, filePlayer, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
      await flush();
      await svc.toggleCurrentHome(); // 利用者が再開した
      filePlayer.calls = [];
      engine.emit('onOutputDisconnected', { reason: 'becoming_noisy' });
      await flush();
      expect(filePlayer.calls).toEqual(['pause']);
      expect(svc.isPlaying).toBe(false);
      engine.emit('onPlaybackInterruption', { type: 'ended', shouldResume: true });
      await flush();
      expect(filePlayer.calls).toEqual(['pause']);
    });

    it('ignores the event when nothing is playing', async () => {
      const { engine, filePlayer, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      engine.emit('onOutputDisconnected', { reason: 'becoming_noisy' });
      await flush();
      expect(filePlayer.calls).toEqual([]);
      expect(engine.playing).toBe(false);
    });
  });
});

// Issue #184: ロック画面・通知（AUDIO_DESIGN.md §10.5）
describe('PlaybackService lock screen (Issue #184)', () => {
  async function withExport(db: ReturnType<typeof createNodeSqliteExecutor>) {
    await insertCurrentExport(db, 'x1');
    return localHomeItem(db);
  }

  it('is not shown until the user starts playing', async () => {
    const { nowPlaying, svc } = await setup({ withVoice: true });
    await svc.reload('e');
    await svc.seek(smp(48000));
    await flush();
    expect(nowPlaying.log).toEqual([]);
  });

  it('shows the episode, show and artwork for the timeline', async () => {
    const { db, existing, nowPlaying, svc } = await setup({ withVoice: true });
    await db.run("UPDATE shows SET name = 'My Show', cover_path = 'show/cover.jpg' WHERE id = 's'");
    await db.run("UPDATE episodes SET title = 'Episode One' WHERE id = 'e'");
    existing.add('/root/show/cover.jpg');
    await svc.reload('e');
    await svc.toggle();
    await flush();
    expect(nowPlaying.last).toMatchObject({
      title: 'Episode One',
      artist: 'My Show',
      artworkPath: '/root/show/cover.jpg',
      duration: TOTAL,
      playing: true,
      labels: TEST_LABELS.nowPlaying,
    });
  });

  it('falls back to the untitled label and no artwork when the cover file is missing', async () => {
    const { db, nowPlaying, svc } = await setup({ withVoice: true });
    await db.run("UPDATE shows SET cover_path = 'show/gone.jpg' WHERE id = 's'");
    await svc.reload('e');
    await svc.toggle();
    await flush();
    expect(nowPlaying.last).toMatchObject({ title: 'Untitled', artworkPath: null });
  });

  it('follows pause and play, but not every status tick', async () => {
    const { db, filePlayer, nowPlaying, svc } = await setup({ withVoice: true });
    await svc.toggleHome(await withExport(db));
    filePlayer.emit({ playing: true, position: smp(100) });
    filePlayer.emit({ playing: true, position: smp(12100) });
    filePlayer.emit({ playing: true, position: smp(24100) });
    await flush();
    const sent = nowPlaying.log.length;
    expect(nowPlaying.last).toMatchObject({ playing: true });
    await svc.toggleCurrentHome();
    await flush();
    expect(nowPlaying.log.length).toBe(sent + 1);
    expect(nowPlaying.last).toMatchObject({ playing: false, position: 24100 });
  });

  it('sends the new position after seeking (the OS advances it in between)', async () => {
    const { db, nowPlaying, svc } = await setup({ withVoice: true });
    await svc.toggleHome(await withExport(db));
    await svc.seekHome(smp(48000));
    await flush();
    expect(nowPlaying.last).toMatchObject({ position: 48000 });
  });

  describe('is removed', () => {
    it('when the mini player is closed', async () => {
      const { db, nowPlaying, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      await flush();
      await svc.stopHome();
      expect(nowPlaying.last).toBeNull();
    });

    it('when recording starts, and stays hidden while recording', async () => {
      const { nowPlaying, recorder, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.toggle();
      await flush();
      await svc.stopForRecording();
      expect(nowPlaying.last).toBeNull();
      recorder.busy = true;
      const count = nowPlaying.log.length;
      nowPlaying.send({ type: 'play' });
      await flush();
      expect(nowPlaying.log.length).toBe(count);
    });

    it('when the playing export is deleted', async () => {
      const { db, nowPlaying, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      await flush();
      await svc.forgetExport('x1');
      expect(nowPlaying.last).toBeNull();
    });

    it('when an asset preview starts, which is not shown itself', async () => {
      const { db, nowPlaying, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      await flush();
      expect(nowPlaying.shown).toBe(true);
      await svc.toggleAssetPreview({ assetId: 'a1', path: 'assets/a1.wav', duration: smp(TOTAL) });
      await flush();
      expect(nowPlaying.last).toBeNull();
      // 試聴中にロック画面の操作が届いても何もしない
      nowPlaying.send({ type: 'pause' });
      await flush();
      expect(svc.previewingAssetId).toBe('a1');
    });

    it('when leaving the episode screen, which also stops the timeline', async () => {
      const { engine, nowPlaying, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.toggle();
      await flush();
      await svc.leaveEpisode();
      expect(nowPlaying.last).toBeNull();
      expect(engine.playing).toBe(false);
    });

    it('but leaving the episode screen does not touch playback started from Home', async () => {
      const { db, filePlayer, nowPlaying, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      await flush();
      filePlayer.calls = [];
      await svc.leaveEpisode();
      expect(nowPlaying.shown).toBe(true);
      expect(filePlayer.calls).toEqual([]);
    });
  });

  describe('commands go through the service, so the app shows the same state', () => {
    it('pause and play the file', async () => {
      const { db, filePlayer, nowPlaying, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      filePlayer.emit({ playing: true });
      filePlayer.calls = [];
      nowPlaying.send({ type: 'pause' });
      await flush();
      expect(filePlayer.calls).toEqual(['pause']);
      expect(svc.isPlaying).toBe(false);
      nowPlaying.send({ type: 'play' });
      await flush();
      expect(filePlayer.calls).toEqual(['pause', 'play']);
      expect(svc.isPlaying).toBe(true);
      // ロック画面から鳴らしたものは止め返さない
      filePlayer.emit({ playing: true });
      expect(filePlayer.calls).toEqual(['pause', 'play']);
    });

    it('toggle the timeline (headphone button)', async () => {
      const { engine, nowPlaying, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.toggle();
      nowPlaying.send({ type: 'toggle' });
      await flush();
      expect(engine.playing).toBe(false);
      nowPlaying.send({ type: 'toggle' });
      await flush();
      expect(engine.playing).toBe(true);
    });

    it('skip back 15 s and forward 30 s, within the episode', async () => {
      const { engine, nowPlaying, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.seek(smp(48000)); // 1 秒
      await svc.toggle();
      nowPlaying.send({ type: 'skipBackward' });
      await flush();
      expect(svc.position).toBe(0);
      nowPlaying.send({ type: 'skipForward' });
      await flush();
      expect(svc.position).toBe(TOTAL); // 2 秒の回なので末尾で止まる
      expect(engine.position).toBe(TOTAL);
    });

    it('seek the file to a position', async () => {
      const { db, filePlayer, nowPlaying, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      filePlayer.calls = [];
      nowPlaying.send({ type: 'seek', position: smp(30000) });
      await flush();
      expect(filePlayer.calls).toEqual(['seek:30000']);
      expect(svc.position).toBe(30000);
      expect(nowPlaying.last).toMatchObject({ position: 30000 });
    });

    it('stop and close is the same as closing the mini player', async () => {
      const { db, nowPlaying, svc } = await setup({ withVoice: true });
      await svc.toggleHome(await withExport(db));
      nowPlaying.send({ type: 'stop' });
      await flush();
      expect(svc.source).toBeNull();
      expect(nowPlaying.last).toBeNull();
    });

    it('cancel the resume after an interruption', async () => {
      const { engine, nowPlaying, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      await svc.toggle();
      engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
      await flush();
      nowPlaying.send({ type: 'skipForward' });
      await flush();
      engine.emit('onPlaybackInterruption', { type: 'ended', shouldResume: true });
      await flush();
      expect(engine.playing).toBe(false);
    });

    it('are ignored when nothing is shown', async () => {
      const { engine, nowPlaying, svc } = await setup({ withVoice: true });
      await svc.reload('e');
      nowPlaying.send({ type: 'play' });
      await flush();
      expect(engine.playing).toBe(false);
    });
  });

  it('shows the paused state after an interruption', async () => {
    const { engine, nowPlaying, svc } = await setup({ withVoice: true });
    await svc.reload('e');
    await svc.toggle();
    engine.emit('onPlaybackInterruption', { type: 'began', shouldResume: false });
    await flush();
    expect(nowPlaying.last).toMatchObject({ playing: false });
  });
});

/** イベントから始まった非同期の処理を流し切る。 */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
