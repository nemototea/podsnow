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

  it('punch-in inserts the new take at the requested position', async () => {
    const { db, recorder, session } = await setup();
    await session.start('e');
    recorder.frames = 1000;
    await session.stop();
    await session.start('e', { insertAtSmp: smp(400) });
    recorder.frames = 50;
    await session.stop();
    const doc = await loadDoc(db, 'e');
    expect(doc.voice.map((v) => [v.takeId, v.srcStart, v.srcEnd])).toEqual([
      ['id1', 0, 400],
      ['id5', 0, 50],
      ['id1', 400, 1000],
    ]);
  });

  it('retake drops the last stretch from the voice track but keeps the recording', async () => {
    const { db, recorder, session } = await setup();
    const takeId = await session.start('e');
    // 0..300 を話し、300..500 で噛んで、そこを言い直す
    recorder.frames = 500;
    expect(session.retake(smp(300))).toBe(200);
    recorder.frames = 900;
    await session.stop();

    // 録音ファイルの長さは変わらない（非破壊）
    expect((await getTake(db, takeId))?.duration_smp).toBe(900);
    // 声の並びからは捨てた範囲だけが抜ける
    const doc = await loadDoc(db, 'e');
    expect(doc.voice.map((v) => [v.srcStart, v.srcEnd])).toEqual([
      [0, 300],
      [500, 900],
    ]);
  });

  it('retake can be undone before the take is finalized', async () => {
    const { db, recorder, session } = await setup();
    await session.start('e');
    recorder.frames = 500;
    session.retake(smp(300));
    expect(session.undoRetake()).toBe(true);
    expect(session.undoRetake()).toBe(false);
    recorder.frames = 900;
    await session.stop();

    expect((await loadDoc(db, 'e')).voice.map((v) => [v.srcStart, v.srcEnd])).toEqual([[0, 900]]);
  });

  it('retake returns null when there is nothing to drop', async () => {
    const { recorder, session } = await setup();
    await session.start('e');
    recorder.frames = 100;
    // 現在位置より後ろは捨てられない
    expect(session.retake(smp(500))).toBeNull();
    await session.stop();
    // 録音していなければ何もしない
    expect(session.retake(smp(0))).toBeNull();
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

  it('heartbeat updates the journal', async () => {
    const { db, recorder, session, tick } = await setup();
    await session.start('e');
    recorder.frames = 48000;
    tick();
    await flush();
    const j = (await listOpenJournals(db))[0]!;
    expect(j.last_known_bytes).toBe(44 + 48000 * 2);
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
