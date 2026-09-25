import { smp } from '@/domain/time';
import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { loadDoc } from '@/infra/db/repositories/editableDocRepo';
import { listRecordingEvents } from '@/infra/db/repositories/recordingEventsRepo';
import { getTake, listOpenJournals, listSegments } from '@/infra/db/repositories/takesRepo';

import {
  RecordingSession,
  DEFAULT_RECORDING_SETTINGS,
  type RecordingSettings,
} from '../RecordingSession';
import { TEST_LABELS } from '@/services/app/__tests__/labels';
import { EditingService } from '@/services/editing/EditingService';
import { recoverUnfinishedTakes } from '../RecoveryService';
import { FakeRecorder } from './FakeRecorder';

const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup(over: Partial<RecordingSettings> = {}) {
  const db = createNodeSqliteExecutor();
  await migrate(db);
  const now = 1_000;
  await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s', now, now]);
  await db.run(
    'INSERT INTO episodes (id, show_id, episode_number, created_at, updated_at) VALUES (?,?,?,?,?)',
    ['e', 's', 1, now, now],
  );
  const recorder = new FakeRecorder();
  let id = 0;
  let clock = 10_000;
  const dirs: string[] = [];
  const settings: RecordingSettings = { ...DEFAULT_RECORDING_SETTINGS, ...over };
  const timers: (() => void)[] = [];
  const session = new RecordingSession({
    labels: () => TEST_LABELS,
    db,
    recorder,
    root: '/root',
    ensureDir: (d) => void dirs.push(d),
    newId: () => `id${++id}`,
    now: () => (clock += 1000),
    settings: () => settings,
    setInterval: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearInterval: () => {},
  });
  return { db, recorder, session, dirs, settings, timers, tick: () => timers.forEach((t) => t()) };
}

describe('RecordingSession', () => {
  it('records a take: creates take/segment/journal, closes them on stop, appends to the voice track', async () => {
    const { db, recorder, session, dirs } = await setup();
    const states: string[] = [];
    session.on('state', (s) => states.push(s));
    const finalized: string[] = [];
    session.on('takeFinalized', (e) => finalized.push(e.takeId));

    const takeId = await session.start('e');
    expect(session.current).toBe('recording');
    expect(dirs[0]).toBe('/root/episodes/e/takes/id1');
    expect(recorder.calls).toEqual(['prepare', 'start:seg-0001.wav']);
    const open = await listOpenJournals(db);
    expect(open).toHaveLength(1);
    expect((await getTake(db, takeId))?.status).toBe('recording');

    recorder.frames = 48000 * 10;
    await session.pause();
    await session.resume();
    const r = await session.stop();
    expect(r).toEqual({ takeId, durationSmp: 480000 });
    expect(session.current).toBe('idle');
    expect(states).toEqual(['preparing', 'recording', 'paused', 'recording', 'stopping', 'idle']);
    expect(finalized).toEqual([takeId]);

    expect(await listOpenJournals(db)).toEqual([]);
    const segs = await listSegments(db, takeId);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      seq: 1,
      duration_smp: 480000,
      header_valid: 1,
      reason_closed: 'stop',
    });
    const take = await getTake(db, takeId);
    expect(take).toMatchObject({
      status: 'ready',
      duration_smp: 480000,
      name: TEST_LABELS.takeName(1),
    });
    const doc = await loadDoc(db, 'e');
    expect(doc.voice).toHaveLength(1);
    expect(doc.voice[0]).toMatchObject({ takeId, srcStart: 0, srcEnd: 480000 });
  });

  it('stop pressed twice finalizes the take once', async () => {
    const { db, recorder, session } = await setup();
    const finalized: string[] = [];
    session.on('takeFinalized', (e) => finalized.push(e.takeId));
    const takeId = await session.start('e');
    recorder.frames = 48000 * 3;
    const [a, b] = await Promise.all([session.stop(), session.stop()]);
    expect([a, b].filter(Boolean)).toEqual([{ takeId, durationSmp: 144000 }]);
    expect(finalized).toEqual([takeId]);
    expect(session.current).toBe('idle');
    expect((await loadDoc(db, 'e')).voice).toHaveLength(1);
  });

  it('refuses to start when disk space is insufficient', async () => {
    const { recorder, session } = await setup();
    recorder.availableBytes = 1000;
    // 文言ではなく AppErrorCode で判定する（表示文言は UI 層の i18n、Issue #80）。
    await expect(session.start('e')).rejects.toMatchObject({
      code: 'disk_space_insufficient',
    });
    expect(session.current).toBe('idle');
    expect(recorder.calls).toEqual([]);
  });

  it('interruption closes the segment; manual resume opens a new segment with an offset and a marker', async () => {
    const { db, recorder, session } = await setup();
    const takeId = await session.start('e');
    recorder.frames = 1000;
    recorder.interrupt();
    await flush();
    expect(session.current).toBe('interrupted');
    recorder.endInterruption(true);
    await flush();
    expect(session.current).toBe('interrupted'); // autoResume=false

    await session.resumeAfterInterruption();
    expect(session.current).toBe('recording');
    expect(recorder.calls).toEqual(['prepare', 'start:seg-0001.wav', 'start:seg-0002.wav']);
    recorder.frames = 500;
    await session.stop();

    const segs = await listSegments(db, takeId);
    expect(segs.map((s) => [s.seq, s.offset_smp, s.duration_smp, s.reason_closed])).toEqual([
      [1, 0, 1000, 'interruption'],
      [2, 1000, 500, 'stop'],
    ]);
    expect((await getTake(db, takeId))?.duration_smp).toBe(1500);
    expect(await listRecordingEvents(db, 'e')).toEqual([
      expect.objectContaining({ kind: 'interruption', takeId, srcSmp: 1000 }),
    ]);
    const doc = await loadDoc(db, 'e');
    expect(doc.voice[0]).toMatchObject({ srcStart: 0, srcEnd: 1500 });
  });

  it('auto-resumes after interruption when enabled and the OS suggests it', async () => {
    const { recorder, session } = await setup({ autoResumeAfterInterruption: true });
    await session.start('e');
    recorder.frames = 10;
    recorder.interrupt();
    await flush();
    recorder.endInterruption(true);
    await flush();
    expect(session.current).toBe('recording');
    expect(recorder.calls.filter((c) => c.startsWith('start'))).toHaveLength(2);
  });

  it('stop during interruption finalizes the take without a new segment', async () => {
    const { db, recorder, session } = await setup();
    const takeId = await session.start('e');
    recorder.frames = 777;
    recorder.interrupt();
    await flush();
    const r = await session.stop();
    expect(r?.durationSmp).toBe(777);
    expect((await getTake(db, takeId))?.status).toBe('ready');
    expect(recorder.calls).toEqual(['prepare', 'start:seg-0001.wav']);
  });

  it('disk-low safe stop from native finalizes the take', async () => {
    const { db, recorder, session } = await setup();
    const takeId = await session.start('e');
    recorder.frames = 100;
    recorder.diskLow();
    await flush();
    await flush();
    expect(session.current).toBe('idle');
    expect((await getTake(db, takeId))?.status).toBe('ready');
    expect((await listSegments(db, takeId))[0]?.reason_closed).toBe('disk_low');
  });

  it('recording at a position inserts the new take there (later voice shifts back)', async () => {
    const { db, recorder, session } = await setup();
    const t1 = await session.start('e');
    recorder.frames = 1000;
    await session.stop();
    const t2 = await session.start('e', { insertAtSmp: smp(400) });
    recorder.frames = 50;
    await session.stop();
    const doc = await loadDoc(db, 'e');
    expect(doc.voice.map((v) => [v.takeId, v.srcStart, v.srcEnd])).toEqual([
      [t1, 0, 400],
      [t2, 0, 50],
      [t1, 400, 1000],
    ]);
  });

  describe('取り消しの履歴（Issue #122）', () => {
    const editing = (db: Awaited<ReturnType<typeof setup>>['db']) => {
      let n = 0;
      return { db, newId: () => `op${++n}`, now: () => 50_000 + n };
    };
    const takeIds = async (db: Awaited<ReturnType<typeof setup>>['db']) =>
      (await loadDoc(db, 'e')).voice.map((v) => v.takeId);

    it('録る → 編集 → 録る → 取り消すで、外れるのは最後に録ったテイクだけ。やり直すと戻る', async () => {
      const { db, recorder, session } = await setup();
      const deps = editing(db);
      await EditingService.open(deps, 'e');
      const t1 = await session.start('e');
      recorder.frames = 1000;
      await session.stop();

      let svc = await EditingService.resume(deps, 'e');
      expect(svc.undoLabel).toBe('Add Recording 1');
      await svc.apply('音量', (d) => ({ ...d, voice: d.voice.map((v) => ({ ...v, gainDb: -3 })) }));

      const t2 = await session.start('e');
      recorder.frames = 500;
      await session.stop();
      expect(await takeIds(db)).toEqual([t1, t2]);

      svc = await EditingService.resume(deps, 'e');
      expect(svc.undoLabel).toBe('Add Recording 2');
      await svc.undo();
      expect(svc.current.voice.map((v) => [v.takeId, v.gainDb])).toEqual([[t1, -3]]);
      await svc.undo();
      expect(svc.current.voice.map((v) => [v.takeId, v.gainDb])).toEqual([[t1, 0]]);
      await svc.redo();
      await svc.redo();
      expect(svc.current.voice.map((v) => [v.takeId, v.gainDb])).toEqual([
        [t1, -3],
        [t2, 0],
      ]);
      expect(await takeIds(db)).toEqual([t1, t2]);
      // 取り消しても録音ファイル（Take）は残る
      await svc.undo();
      expect((await getTake(db, t2))?.status).toBe('ready');
    });

    it('録音中に重ねた素材は、録音の追加と一緒に取り消され、一緒に戻る', async () => {
      const { db, recorder, session } = await setup();
      await db.run(
        'INSERT INTO assets (id, show_id, kind, name, path, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
        ['J', 's', 'jingle', 'Jingle', 'x.wav', 100, 1, 1],
      );
      const deps = editing(db);
      const svc0 = await EditingService.open(deps, 'e');
      const t1 = await session.start('e');
      recorder.frames = 300;
      await svc0.writeWithoutHistory((d) => ({
        ...d,
        overlays: [
          {
            id: 'o1',
            assetId: 'J',
            kind: 'jingle',
            anchor: { type: 'source', takeId: t1, srcSmp: smp(300) },
            srcStart: smp(0),
            srcEnd: null,
            gainDb: 0,
            fadeIn: smp(0),
            fadeOut: smp(0),
            duck: false,
            loop: false,
            endMode: 'asset_end',
          },
        ],
      }));
      recorder.frames = 1000;
      await session.stop();

      const svc = await EditingService.resume(deps, 'e');
      expect(svc.current.overlays).toHaveLength(1);
      await svc.undo();
      expect(svc.current).toEqual({ voice: [], overlays: [] });
      expect(svc.canUndo).toBe(false);
      await svc.redo();
      expect(svc.current.voice.map((v) => v.takeId)).toEqual([t1]);
      expect(svc.current.overlays.map((o) => o.id)).toEqual(['o1']);
    });

    it('割り込みで止まっている間に入れた素材も、録音の追加と一緒に 1 回の取り消しで外れる', async () => {
      const { db, recorder, session } = await setup();
      await db.run(
        'INSERT INTO assets (id, show_id, kind, name, path, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
        ['J', 's', 'jingle', 'Jingle', 'x.wav', 100, 1, 1],
      );
      const deps = editing(db);
      const svc0 = await EditingService.open(deps, 'e');
      const t1 = await session.start('e');
      recorder.frames = 400;
      recorder.interrupt();
      await flush();
      expect(session.current).toBe('interrupted');
      // 画面は割り込み中も録音中と同じく、テイクの位置に履歴の外で付ける
      const pos = session.currentSourcePosition();
      expect(pos).toEqual({ takeId: t1, srcSmp: 400 });
      await svc0.writeWithoutHistory((d) => ({
        ...d,
        overlays: [
          {
            id: 'o1',
            assetId: 'J',
            kind: 'jingle',
            anchor: { type: 'source', takeId: pos!.takeId, srcSmp: pos!.srcSmp },
            srcStart: smp(0),
            srcEnd: null,
            gainDb: 0,
            fadeIn: smp(0),
            fadeOut: smp(0),
            duck: false,
            loop: false,
            endMode: 'asset_end',
          },
        ],
      }));
      await session.stop();

      const svc = await EditingService.resume(deps, 'e');
      expect(svc.undoLabel).toBe('Add Recording 1');
      await svc.undo();
      expect(svc.current).toEqual({ voice: [], overlays: [] });
      expect(svc.canUndo).toBe(false);
    });

    it('取り消したあとに録ると、やり直し側は捨てられる', async () => {
      const { db, recorder, session } = await setup();
      const deps = editing(db);
      await EditingService.open(deps, 'e');
      const t1 = await session.start('e');
      recorder.frames = 1000;
      await session.stop();
      await session.start('e');
      recorder.frames = 500;
      await session.stop();
      let svc = await EditingService.resume(deps, 'e');
      await svc.undo();
      const t3 = await session.start('e');
      recorder.frames = 200;
      await session.stop();
      svc = await EditingService.resume(deps, 'e');
      expect(svc.canRedo).toBe(false);
      expect(svc.current.voice.map((v) => v.takeId)).toEqual([t1, t3]);
      expect(svc.undoLabel).toBe('Add Recording 3');
    });

    it('途中の位置で録ると挿入し、今録った部分の終わりを知らせる', async () => {
      const { recorder, session } = await setup();
      const ends: number[] = [];
      session.on('takeFinalized', (e) => ends.push(e.endSmp));
      await session.start('e');
      recorder.frames = 1000;
      await session.stop();
      await session.start('e', { insertAtSmp: smp(400) });
      recorder.frames = 50;
      await session.stop();
      expect(ends).toEqual([1000, 450]);
    });

    it('長さ 0 の録音は声の並びにも履歴にも何も足さない', async () => {
      const { db, recorder, session } = await setup();
      const deps = editing(db);
      await EditingService.open(deps, 'e');
      await session.start('e');
      recorder.frames = 0;
      await session.stop();
      const svc = await EditingService.resume(deps, 'e');
      expect(svc.canUndo).toBe(false);
      expect(svc.current.voice).toEqual([]);
    });
  });

  it('recordEvent records the current take position', async () => {
    const { db, recorder, session } = await setup();
    const takeId = await session.start('e');
    recorder.frames = 123;
    const e = await session.recordEvent('disk_low', '残り少');
    expect(e).toMatchObject({ takeId, srcSmp: 123, label: '残り少', kind: 'disk_low' });
    expect(await listRecordingEvents(db, 'e')).toHaveLength(1);
    expect(session.currentSourcePosition()).toEqual({ takeId, srcSmp: 123 });
  });

  it.each([1, 2] as const)('heartbeat updates the journal (%i ch)', async (channels) => {
    const { db, recorder, session, tick } = await setup({ channels });
    await session.start('e');
    recorder.frames = 48000;
    tick();
    await flush();
    const j = (await listOpenJournals(db))[0]!;
    expect(j.last_known_bytes).toBe(44 + 48000 * channels * 2);
  });

  it('a take with zero frames is marked failed and not added to the voice track', async () => {
    const { db, session } = await setup();
    const takeId = await session.start('e');
    await session.stop();
    expect((await getTake(db, takeId))?.status).toBe('failed');
    expect((await loadDoc(db, 'e')).voice).toEqual([]);
  });
});

describe('recoverUnfinishedTakes', () => {
  it('repairs open segments after a crash and appends the take to the voice track', async () => {
    const { db, recorder, session } = await setup();
    const takeId = await session.start('e');
    recorder.frames = 100;
    recorder.interrupt();
    await flush();
    await session.resumeAfterInterruption();
    // ここでプロセスが死んだとする: seg-0002 は open のまま
    expect(await listOpenJournals(db)).toHaveLength(1);

    let id = 100;
    const recovered = await recoverUnfinishedTakes({
      db,
      recorder,
      root: '/root',
      fileExists: () => true,
      newId: () => `r${++id}`,
      now: () => 99_999,
    });
    expect(recorder.repaired).toEqual(['/root/episodes/e/takes/id1/seg-0002.wav']);
    expect(recovered).toEqual([{ takeId, episodeId: 'e', durationSmp: 100 + 4800, segments: 1 }]);
    expect(await listOpenJournals(db)).toEqual([]);
    const segs = await listSegments(db, takeId);
    expect(segs.map((s) => [s.seq, s.offset_smp, s.duration_smp, s.reason_closed])).toEqual([
      [1, 0, 100, 'interruption'],
      [2, 100, 4800, 'crash_recovered'],
    ]);
    expect((await getTake(db, takeId))?.status).toBe('recovered');
    const doc = await loadDoc(db, 'e');
    expect(doc.voice[0]).toMatchObject({ takeId, srcStart: 0, srcEnd: 4900 });

    // 二度目は何もしない
    expect(
      await recoverUnfinishedTakes({
        db,
        recorder,
        root: '/root',
        fileExists: () => true,
        newId: () => 'x',
        now: () => 1,
      }),
    ).toEqual([]);
  });

  it('marks a take failed when its file is missing', async () => {
    const { db, recorder, session } = await setup();
    const takeId = await session.start('e');
    const recovered = await recoverUnfinishedTakes({
      db,
      recorder,
      root: '/root',
      fileExists: () => false,
      newId: () => 'x',
      now: () => 1,
    });
    expect(recovered).toEqual([]);
    expect((await getTake(db, takeId))?.status).toBe('failed');
    expect(await listOpenJournals(db)).toEqual([]);
  });
});
