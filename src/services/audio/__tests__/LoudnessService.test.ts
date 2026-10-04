import { LOUDNESS_ALGO } from '@/domain/render/loudnessCache';
import { DEFAULT_DUCKING, DEFAULT_LOUDNESS } from '@/domain/render/types';
import { smp } from '@/domain/time';
import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { saveDoc } from '@/infra/db/repositories/editableDocRepo';
import { getLoudnessCache, saveLoudnessMeasure } from '@/infra/db/repositories/loudnessCacheRepo';
import { currentSourceFingerprint } from '@/services/export/sourceFingerprint';

import { LoudnessService, type LoudnessStatus } from '../LoudnessService';
import type { SoundSettings } from '../renderDocumentFromDb';
import { FakeAudioEngine } from './FakeAudioEngine';

const TOTAL = 96000;
const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 20; i++) await flush();
};
const SOUND: SoundSettings = { loudness: DEFAULT_LOUDNESS, ducking: DEFAULT_DUCKING };

type Applied = { episodeId: string; sound: SoundSettings; gain: unknown };

async function setup() {
  const db = createNodeSqliteExecutor();
  await migrate(db);
  await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s', 1, 1]);
  await db.run(
    'INSERT INTO episodes (id, show_id, episode_number, created_at, updated_at) VALUES (?,?,?,?,?)',
    ['e', 's', 1, 1, 1],
  );
  await db.run(
    'INSERT INTO takes (id, episode_id, status, started_at, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    ['T', 'e', 'ready', 1, TOTAL, 1, 1],
  );
  await db.run(
    'INSERT INTO take_segments (id, take_id, seq, path, offset_smp, duration_smp, header_valid, reason_closed) VALUES (?,?,?,?,?,?,1,?)',
    ['sg', 'T', 1, 'episodes/e/takes/T/seg-0001.wav', 0, TOTAL, 'stop'],
  );
  const voice = (end: number) => ({
    voice: [
      {
        id: 'v',
        takeId: 'T',
        srcStart: smp(0),
        srcEnd: smp(end),
        gainDb: 0,
        fadeIn: smp(0),
        fadeOut: smp(0),
      },
    ],
    overlays: [],
  });
  await saveDoc(db, 'e', voice(TOTAL), 1);
  const engine = new FakeAudioEngine();
  const applied: Applied[] = [];
  const playback = {
    setTimelineSound: jest.fn(async (episodeId: string, sound: SoundSettings, gain: unknown) => {
      applied.push({ episodeId, sound, gain });
    }),
  };
  const svc = new LoudnessService({
    db,
    root: '/root',
    engine,
    playback,
    now: () => 5000,
    debounceMs: 0,
  });
  const statuses: LoudnessStatus[] = [];
  svc.onStatus((s) => statuses.push(s));
  return { db, engine, svc, applied, statuses, voice };
}

describe('LoudnessService (Issue #158)', () => {
  it('measures when nothing is cached, plays the provisional then the final gain, and saves it', async () => {
    const { db, engine, svc, applied, statuses } = await setup();
    await svc.activate('e', 1);
    // 前回の値が無いので調整なし
    expect(applied.at(-1)).toEqual({
      episodeId: 'e',
      sound: SOUND,
      gain: { channels: 1, gainDb: null },
    });
    expect(engine.measures).toHaveLength(1);
    const m = engine.measures[0]!;
    expect(m.doc).toMatchObject({ channels: 1, totalFrames: TOTAL });
    expect(svc.getStatus()).toEqual({ measuring: true, progress: 0 });

    engine.emit('onMeasureProgress', { jobId: m.jobId, progress: 0.67, gainDb: 6 });
    await settle();
    expect(applied.at(-1)?.gain).toEqual({ channels: 1, gainDb: 6 });
    expect(statuses.at(-1)).toEqual({ measuring: true, progress: 0.67 });

    engine.emit('onMeasureDone', {
      jobId: m.jobId,
      gainDb: 4.8,
      inputLufs: -21,
      inputTruePeakDb: -6,
      trials: 2,
      algo: LOUDNESS_ALGO,
    });
    await settle();
    expect(applied.at(-1)?.gain).toEqual({ channels: 1, gainDb: 4.8 });
    expect(svc.getStatus()).toEqual({ measuring: false, progress: 0 });
    expect(await getLoudnessCache(db, 'e')).toEqual([
      {
        fingerprint: await currentSourceFingerprint(db, 'e'),
        channels: 1,
        algo: LOUDNESS_ALGO,
        gainDb: 4.8,
        targetLufs: -16,
        inputLufs: -21,
        measuredAt: 5000,
      },
    ]);
  });

  it('uses the cached gain without measuring', async () => {
    const { db, engine, svc, applied } = await setup();
    await saveLoudnessMeasure(db, 'e', {
      fingerprint: await currentSourceFingerprint(db, 'e'),
      channels: 2,
      algo: LOUDNESS_ALGO,
      gainDb: 2.5,
      targetLufs: -16,
      inputLufs: -18,
      measuredAt: 1,
    });
    await svc.activate('e', 2);
    expect(engine.measures).toHaveLength(0);
    expect(applied.at(-1)?.gain).toEqual({ channels: 2, gainDb: 2.5 });
    // 別のチャンネル数では使わない
    await svc.activate('e', 1);
    expect(engine.measures).toHaveLength(1);
  });

  it('holds the previous gain of this channel count while re-measuring after an edit', async () => {
    const { db, engine, svc, applied, voice } = await setup();
    await saveLoudnessMeasure(db, 'e', {
      fingerprint: await currentSourceFingerprint(db, 'e'),
      channels: 1,
      algo: LOUDNESS_ALGO,
      gainDb: 3,
      targetLufs: -16,
      inputLufs: -19,
      measuredAt: 1,
    });
    await saveDoc(db, 'e', voice(TOTAL / 2), 2);
    await svc.activate('e', 1);
    expect(applied.at(-1)?.gain).toEqual({ channels: 1, gainDb: 3 });
    expect(engine.measures).toHaveLength(1);
    expect(engine.measures[0]!.doc).toMatchObject({ totalFrames: TOTAL / 2 });
  });

  it('does not measure when loudness adjustment is off', async () => {
    const { db, engine, svc, applied } = await setup();
    const off = { ...SOUND, loudness: { ...DEFAULT_LOUDNESS, enabled: false } };
    await db.run('UPDATE episodes SET sound_settings = ? WHERE id = ?', [JSON.stringify(off), 'e']);
    await svc.activate('e', 1);
    expect(engine.measures).toHaveLength(0);
    expect(applied.at(-1)).toMatchObject({ sound: off, gain: { channels: 1, gainDb: null } });
  });

  it('shifts the gain by the target difference at once, then re-measures', async () => {
    const { db, engine, svc, applied } = await setup();
    await saveLoudnessMeasure(db, 'e', {
      fingerprint: await currentSourceFingerprint(db, 'e'),
      channels: 1,
      algo: LOUDNESS_ALGO,
      gainDb: 3,
      targetLufs: -16,
      inputLufs: -19,
      measuredAt: 1,
    });
    await svc.activate('e', 1);
    const next = { ...SOUND, loudness: { ...DEFAULT_LOUDNESS, targetLufs: -14 } };
    await db.run('UPDATE episodes SET sound_settings = ? WHERE id = ?', [
      JSON.stringify(next),
      'e',
    ]);
    await svc.soundChanged('e', SOUND, next);
    expect(applied.at(-1)).toEqual({
      episodeId: 'e',
      sound: next,
      gain: { channels: 1, gainDb: 5 },
    });
    expect(engine.measures).toHaveLength(0);
    await settle();
    // 指紋が変わった（目標は音の仕上げに含まれる）ので測り直す。測っている間も 5 dB のまま
    expect(engine.measures).toHaveLength(1);
    expect(applied.at(-1)?.gain).toEqual({ channels: 1, gainDb: 5 });
  });

  it('applies ducking changes outside the export tab without a gain', async () => {
    const { svc, applied, engine } = await setup();
    const next = { ...SOUND, ducking: { ...DEFAULT_DUCKING, depthDb: -20 } };
    await svc.soundChanged('e', SOUND, next);
    expect(applied).toEqual([{ episodeId: 'e', sound: next, gain: null }]);
    expect(engine.measures).toHaveLength(0);
  });

  it('stops measuring and plays unadjusted when the export tab is left', async () => {
    const { engine, svc, applied } = await setup();
    await svc.activate('e', 1);
    const m = engine.measures[0]!;
    await svc.deactivate();
    expect(engine.cancelledMeasures).toEqual([m.jobId]);
    expect(applied.at(-1)).toEqual({ episodeId: 'e', sound: SOUND, gain: null });
    expect(svc.getStatus().measuring).toBe(false);
    // 止めた測定の結果が遅れて来ても使わない
    engine.emit('onMeasureDone', {
      jobId: m.jobId,
      gainDb: 9,
      inputLufs: -25,
      inputTruePeakDb: -3,
      trials: 0,
      algo: LOUDNESS_ALGO,
    });
    await settle();
    expect(applied.at(-1)?.gain).toBeNull();
  });

  it('does not measure during an export and picks up the exported gain afterwards', async () => {
    const { db, engine, svc, applied } = await setup();
    await svc.activate('e', 1);
    const m = engine.measures[0]!;
    svc.setExporting(true);
    expect(engine.cancelledMeasures).toEqual([m.jobId]);
    await svc.soundChanged('e', SOUND, SOUND);
    await settle();
    expect(engine.measures).toHaveLength(1);
    // 書き出しが測ったゲインを保存した
    await saveLoudnessMeasure(db, 'e', {
      fingerprint: await currentSourceFingerprint(db, 'e'),
      channels: 1,
      algo: LOUDNESS_ALGO,
      gainDb: 1.25,
      targetLufs: -16,
      inputLufs: -17,
      measuredAt: 2,
    });
    svc.setExporting(false);
    await settle();
    expect(engine.measures).toHaveLength(1);
    expect(applied.at(-1)?.gain).toEqual({ channels: 1, gainDb: 1.25 });
  });

  it('re-measures after an edit while the export tab is open', async () => {
    const { db, engine, svc, voice } = await setup();
    await svc.activate('e', 1);
    expect(engine.measures).toHaveLength(1);
    // 同じ音のまま変更の通知が来ても、走っている測定はそのまま
    svc.contentChanged('e');
    await settle();
    expect(engine.measures).toHaveLength(1);
    await saveDoc(db, 'e', voice(TOTAL / 4), 3);
    svc.contentChanged('e');
    await settle();
    expect(engine.measures).toHaveLength(2);
    expect(engine.cancelledMeasures).toEqual([engine.measures[0]!.jobId]);
    // 書き出しタブを開いていない回の変更では測らない
    svc.contentChanged('other');
    await settle();
    expect(engine.measures).toHaveLength(2);
  });
});
