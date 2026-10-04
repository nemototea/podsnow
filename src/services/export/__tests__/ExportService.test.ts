import * as nodeFs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { mp4Boxes, readMp4Tags } from '@/domain/metadata/mp4Tags';
import { readRiffInfo } from '@/domain/metadata/riffInfo';
import { smp } from '@/domain/time';
import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { saveDoc } from '@/infra/db/repositories/editableDocRepo';
import { listExports } from '@/infra/db/repositories/exportsRepo';
import { getLoudnessCache, saveLoudnessMeasure } from '@/infra/db/repositories/loudnessCacheRepo';
import { LOUDNESS_ALGO } from '@/domain/render/loudnessCache';
import { currentSourceFingerprint } from '../sourceFingerprint';
import { nodeFsPort } from '@/infra/files/__tests__/nodeFsPort';
import type { FsPort } from '@/infra/files/fsPort';
import { FakeAudioEngine } from '@/services/audio/__tests__/FakeAudioEngine';

import { DEFAULT_SETTINGS } from '@/infra/db/repositories/settingsRepo';

import {
  CUSTOM_BITRATES,
  DEFAULT_CUSTOM_EXPORT,
  episodeExportPreset,
  estimateExportBytes,
  exportLoudness,
  EXPORT_PRESETS,
  ExportService,
  normalizeCustomExport,
  resolveExportPreset,
} from '../ExportService';

const flush = () => new Promise((r) => setTimeout(r, 0));
/** 書き出しの完了処理（メタデータの埋め込みを含む）が終わるまで回す。 */
const settle = async () => {
  for (let i = 0; i < 20; i++) await flush();
};

const FIXTURES = path.join(__dirname, 'fixtures');

/** テストの仮の root（`/root`）を一時ディレクトリに写す FsPort。 */
function rootedFs(real: string): { fs: FsPort; real: (abs: string) => string } {
  const map = (abs: string) => (abs.startsWith('/root/') ? path.join(real, abs.slice(6)) : abs);
  return {
    real: map,
    fs: {
      open: (p, m) => nodeFsPort.open(map(p), m),
      size: (p) => nodeFsPort.size(map(p)),
      exists: (p) => nodeFsPort.exists(map(p)),
      ensureDir: (d) => nodeFsPort.ensureDir(map(d)),
      delete: (p) => nodeFsPort.delete(map(p)),
      move: (a, b) => nodeFsPort.move(map(a), map(b)),
      list: (d) => nodeFsPort.list(map(d)),
    },
  };
}

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => nodeFs.rmSync(d, { recursive: true, force: true })));

async function setup() {
  const db = createNodeSqliteExecutor();
  await migrate(db);
  const now = 1000;
  await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s', now, now]);
  await db.run(
    'INSERT INTO episodes (id, show_id, episode_number, created_at, updated_at) VALUES (?,?,?,?,?)',
    ['e', 's', 1, now, now],
  );
  await db.run(
    'INSERT INTO takes (id, episode_id, status, started_at, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    ['T', 'e', 'ready', now, 96000, now, now],
  );
  await db.run(
    'INSERT INTO take_segments (id, take_id, seq, path, offset_smp, duration_smp, header_valid, reason_closed) VALUES (?,?,?,?,?,?,1,?)',
    ['sg', 'T', 1, 'episodes/e/takes/T/seg-0001.wav', 0, 96000, 'stop'],
  );
  await db.run(
    'INSERT INTO assets (id, show_id, kind, name, path, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ['J', 's', 'jingle', 'J', 'shows/s/assets/J.wav', 4800, now, now],
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
          srcEnd: smp(96000),
          gainDb: 0,
          fadeIn: smp(0),
          fadeOut: smp(0),
        },
      ],
      overlays: [
        {
          id: 'o',
          assetId: 'J',
          kind: 'jingle',
          anchor: { type: 'source', takeId: 'T', srcSmp: smp(1000) },
          srcStart: smp(0),
          srcEnd: null,
          gainDb: -4,
          fadeIn: smp(0),
          fadeOut: smp(0),
          loop: false,
          endMode: 'asset_end',
        },
      ],
    },
    now,
  );
  const engine = new FakeAudioEngine();
  const deleted: string[] = [];
  const copies: { src: string; dir: string; name: string }[] = [];
  const missing = new Set<string>();
  let id = 0;
  const tmp = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'podsnow-export-'));
  tmpDirs.push(tmp);
  const rooted = rootedFs(tmp);
  const svc = new ExportService({
    db,
    engine,
    root: '/root',
    ensureDir: () => {},
    fileSize: () => 12345,
    fileExists: (abs) => !missing.has(abs),
    deleteFile: (abs) => deleted.push(abs),
    copyAsNamed: (src, dir, name) => {
      copies.push({ src, dir, name });
      return Promise.resolve(`file://${dir}/${encodeURIComponent(name)}`);
    },
    fs: rooted.fs,
    newId: () => `x${++id}`,
    now: () => 5000,
    utcOffsetMinutes: () => 540,
  });
  /** レンダが書いたことにして、`/root/...` の位置へ実ファイルを置く。 */
  const place = (abs: string, fixture: string | Buffer) => {
    const dst = rooted.real(abs);
    nodeFs.mkdirSync(path.dirname(dst), { recursive: true });
    if (typeof fixture === 'string') nodeFs.copyFileSync(path.join(FIXTURES, fixture), dst);
    else nodeFs.writeFileSync(dst, fixture);
    return dst;
  };
  return { db, engine, svc, deleted, copies, missing, place, real: rooted.real };
}

async function insertExportRow(
  db: Awaited<ReturnType<typeof setup>>['db'],
  id: string,
  status: string,
  path: string | null,
) {
  await db.run(
    'INSERT INTO exports (id, episode_id, format, preset, status, path, duration_smp, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [id, 'e', 'm4a', '{}', status, path, 96000, 2],
  );
}

describe('ExportService', () => {
  it('builds the render document from the DB, tracks progress and finishes', async () => {
    const { db, engine, svc, place } = await setup();
    const events: string[] = [];
    svc.on('progress', (e) => events.push(`p:${e.progress}`));
    svc.on('done', (e) => events.push(`done:${e.bytes}`));
    const exportId = await svc.start('e', EXPORT_PRESETS.podcast);
    expect(engine.renders).toHaveLength(1);
    const r = engine.renders[0]!;
    expect(r.opts).toMatchObject({
      path: '/root/episodes/e/exports/x1.m4a',
      format: 'm4a',
      bitrate: 128000,
    });
    const doc = r.doc as {
      voice: { path: string }[];
      overlays: { path: string; tlStart: number }[];
      totalFrames: number;
    };
    expect(doc.totalFrames).toBe(96000);
    expect(doc.voice[0]!.path).toBe('/root/episodes/e/takes/T/seg-0001.wav');
    expect(doc.overlays[0]).toMatchObject({ path: '/root/shows/s/assets/J.wav', tlStart: 1000 });

    engine.emit('onRenderProgress', { jobId: r.jobId, progress: 0.5, phase: 'encoding' });
    await flush();
    place(r.opts.path, 'moov-last.m4a');
    engine.emit('onRenderDone', {
      jobId: r.jobId,
      path: r.opts.path,
      frames: 96000,
      measuredLufs: -20.5,
      measuredTruePeakDb: -3,
      appliedGainDb: 4.5,
    });
    await settle();
    const rows = await listExports(db, 'e');
    expect(rows[0]).toMatchObject({
      id: exportId,
      status: 'done',
      path: 'episodes/e/exports/x1.m4a',
      bytes: 12345,
      measured_lufs: -20.5,
    });
    expect(events).toEqual(['p:0.5', 'done:12345']);
    const ep = await db.get<{ status: string }>('SELECT status FROM episodes WHERE id = ?', ['e']);
    expect(ep?.status).toBe('exported');
  });

  it('marks cancelled exports', async () => {
    const { db, svc } = await setup();
    const exportId = await svc.start('e', EXPORT_PRESETS.wav);
    svc.cancel(exportId);
    await flush();
    await flush();
    expect((await listExports(db, 'e'))[0]?.status).toBe('cancelled');
  });

  describe('metadata (Issue #56)', () => {
    async function withShow(db: Awaited<ReturnType<typeof setup>>['db']) {
      await db.run("UPDATE shows SET name = ?, author = ?, cover_path = ? WHERE id = 's'", [
        'ねもとのラジオ',
        'ねもと',
        'shows/s/cover-1.jpg',
      ]);
      await db.run(
        "UPDATE episodes SET title = ?, episode_number = 12, publish_planned_at = ? WHERE id = 'e'",
        ['初回ゲスト回', Date.UTC(2026, 9, 3, 12)],
      );
    }

    function done(
      engine: Awaited<ReturnType<typeof setup>>['engine'],
      r: { jobId: string; opts: { path: string } },
    ) {
      engine.emit('onRenderDone', {
        jobId: r.jobId,
        path: r.opts.path,
        frames: 96000,
        measuredLufs: -16,
        measuredTruePeakDb: -1.2,
        appliedGainDb: 3,
      });
    }

    it('embeds title, show, author, number, date and artwork into the M4A before finishing', async () => {
      const { db, engine, svc, place } = await setup();
      await withShow(db);
      const cover = place('/root/shows/s/cover-1.jpg', 'cover.jpg');
      await svc.start('e', EXPORT_PRESETS.podcast);
      const r = engine.renders[0]!;
      const file = place(r.opts.path, 'moov-first.m4a');
      done(engine, r);
      await settle();
      expect((await listExports(db, 'e'))[0]).toMatchObject({ status: 'done', error: null });

      const b = new Uint8Array(nodeFs.readFileSync(file));
      const moov = mp4Boxes(b).find((x) => x.type === 'moov')!;
      const tags = readMp4Tags(b.subarray(moov.start, moov.start + moov.size));
      expect(tags).toMatchObject({
        title: '初回ゲスト回',
        artist: 'ねもと',
        album: 'ねもとのラジオ',
        track: 12,
        date: '2026-10-03T21:00:00+09:00',
        genre: 'Podcast',
        encoder: 'PodsNow 0.1.0',
      });
      expect(Buffer.from(tags.cover!.bytes).equals(nodeFs.readFileSync(cover))).toBe(true);
    });

    it('still embeds the text when the artwork file is missing', async () => {
      const { db, engine, svc, place } = await setup();
      await withShow(db);
      await svc.start('e', EXPORT_PRESETS.podcast);
      const r = engine.renders[0]!;
      const file = place(r.opts.path, 'moov-last.m4a');
      done(engine, r);
      await settle();
      expect((await listExports(db, 'e'))[0]?.status).toBe('done');
      const b = new Uint8Array(nodeFs.readFileSync(file));
      const moov = mp4Boxes(b).find((x) => x.type === 'moov')!;
      const tags = readMp4Tags(b.subarray(moov.start, moov.start + moov.size));
      expect(tags.title).toBe('初回ゲスト回');
      expect(tags.cover).toBeUndefined();
    });

    it('writes LIST/INFO into WAV exports', async () => {
      const { db, engine, svc, place } = await setup();
      await withShow(db);
      await svc.start('e', EXPORT_PRESETS.wav);
      const r = engine.renders[0]!;
      const h = Buffer.alloc(44);
      h.write('RIFF', 0);
      h.writeUInt32LE(36 + 4, 4);
      h.write('WAVEfmt ', 8);
      h.writeUInt32LE(16, 16);
      h.write('data', 36);
      h.writeUInt32LE(4, 40);
      const file = place(r.opts.path, Buffer.concat([h, Buffer.alloc(4)]));
      done(engine, r);
      await settle();
      expect((await listExports(db, 'e'))[0]?.status).toBe('done');
      expect(readRiffInfo(new Uint8Array(nodeFs.readFileSync(file)))).toMatchObject({
        INAM: '初回ゲスト回',
        IART: 'ねもと',
        IPRD: 'ねもとのラジオ',
        ITRK: '12',
        ICRD: '2026-10-03',
      });
    });

    it('still finishes the export, keeping the audio, when the metadata cannot be written', async () => {
      const { db, engine, svc, place, deleted } = await setup();
      const embedded: boolean[] = [];
      const failed: string[] = [];
      svc.on('done', (e) => embedded.push(e.metadataEmbedded));
      svc.on('failed', (e) => failed.push(e.message));
      await svc.start('e', EXPORT_PRESETS.podcast);
      const r = engine.renders[0]!;
      const broken = Buffer.from('not an mp4 file');
      const file = place(r.opts.path, broken);
      done(engine, r);
      await settle();
      const row = (await listExports(db, 'e'))[0]!;
      // 行は done。error は警告として残り、履歴に「題名・アートワークなし」と出す
      expect(row).toMatchObject({
        status: 'done',
        error: 'export_metadata_failed',
        path: 'episodes/e/exports/x1.m4a',
      });
      expect(nodeFs.readFileSync(file).equals(broken)).toBe(true);
      expect(deleted).toEqual([]);
      expect(embedded).toEqual([false]);
      expect(failed).toEqual([]);
      const ep = await db.get<{ status: string }>('SELECT status FROM episodes WHERE id = ?', [
        'e',
      ]);
      expect(ep?.status).toBe('exported');
    });

    it('retries without the artwork when embedding with it fails', async () => {
      const { db, engine, place, real } = await setup();
      await withShow(db);
      place('/root/shows/s/cover-1.jpg', 'cover.jpg');
      // 1 回目の写し（アートワーク込み）だけ書けない端末を真似る
      let tmpOpens = 0;
      const flaky: FsPort = {
        ...rootedFs(path.dirname(real('/root/x'))).fs,
        open: (p, m) => {
          if (p.endsWith('.tagging') && m === 'w' && tmpOpens++ === 0) throw new Error('ENOSPC');
          return nodeFsPort.open(real(p), m);
        },
      };
      const svc = new ExportService({
        db,
        engine,
        root: '/root',
        ensureDir: () => {},
        fileSize: () => 1,
        fileExists: () => true,
        deleteFile: () => {},
        copyAsNamed: () => Promise.resolve(''),
        fs: flaky,
        newId: () => 'y1',
        now: () => 5000,
        utcOffsetMinutes: () => 540,
      });
      await svc.start('e', EXPORT_PRESETS.podcast);
      const r = engine.renders[0]!;
      const file = place(r.opts.path, 'moov-last.m4a');
      done(engine, r);
      await settle();
      expect((await listExports(db, 'e'))[0]).toMatchObject({ status: 'done', error: null });
      const b = new Uint8Array(nodeFs.readFileSync(file));
      const moov = mp4Boxes(b).find((x) => x.type === 'moov')!;
      const tags = readMp4Tags(b.subarray(moov.start, moov.start + moov.size));
      expect(tags.title).toBe('初回ゲスト回');
      expect(tags.cover).toBeUndefined();
      expect(tmpOpens).toBe(2);
    });
  });

  describe('loudness cache (Issue #158)', () => {
    it('uses the gain measured for the preview and does not overwrite it', async () => {
      const { db, engine, svc } = await setup();
      const fingerprint = await currentSourceFingerprint(db, 'e');
      await saveLoudnessMeasure(db, 'e', {
        fingerprint,
        channels: 1,
        algo: LOUDNESS_ALGO,
        gainDb: 3.25,
        targetLufs: -16,
        inputLufs: -19,
        measuredAt: 1,
      });
      await svc.start('e', EXPORT_PRESETS.podcast);
      const r = engine.renders[0]!;
      expect((r.doc as { loudness: { gainDb?: number } }).loudness.gainDb).toBe(3.25);
      engine.emit('onRenderDone', {
        jobId: r.jobId,
        path: r.opts.path,
        frames: 96000,
        measuredLufs: -16,
        measuredTruePeakDb: -1.1,
        appliedGainDb: 3.25,
        inputLufs: -120,
      });
      await settle();
      expect((await getLoudnessCache(db, 'e'))[0]?.measuredAt).toBe(1);
    });

    it('measures when the cached gain is for another sound or channel count, and saves it', async () => {
      const { db, engine, svc } = await setup();
      await saveLoudnessMeasure(db, 'e', {
        fingerprint: await currentSourceFingerprint(db, 'e'),
        channels: 2,
        algo: LOUDNESS_ALGO,
        gainDb: 1,
        targetLufs: -16,
        inputLufs: null,
        measuredAt: 1,
      });
      await svc.start('e', EXPORT_PRESETS.podcast);
      const r = engine.renders[0]!;
      expect((r.doc as { loudness: { gainDb?: number } }).loudness.gainDb).toBeUndefined();
      engine.emit('onRenderDone', {
        jobId: r.jobId,
        path: r.opts.path,
        frames: 96000,
        measuredLufs: -16,
        measuredTruePeakDb: -1.2,
        appliedGainDb: 4.5,
        inputLufs: -20.5,
      });
      await settle();
      const cache = await getLoudnessCache(db, 'e');
      expect(cache.map((c) => [c.channels, c.gainDb, c.inputLufs])).toEqual([
        [1, 4.5, -20.5],
        [2, 1, null],
      ]);
      expect(cache[0]?.fingerprint).toBe(await currentSourceFingerprint(db, 'e'));
    });

    it('does not save a gain when loudness adjustment is off', async () => {
      const { db, engine, svc } = await setup();
      await db.run('UPDATE episodes SET sound_settings = ? WHERE id = ?', [
        JSON.stringify({ loudness: { enabled: false } }),
        'e',
      ]);
      await svc.start('e', EXPORT_PRESETS.podcast);
      const r = engine.renders[0]!;
      engine.emit('onRenderDone', {
        jobId: r.jobId,
        path: r.opts.path,
        frames: 96000,
        measuredLufs: -23,
        measuredTruePeakDb: -6,
        appliedGainDb: 0,
      });
      await settle();
      expect(await getLoudnessCache(db, 'e')).toEqual([]);
    });
  });

  it('estimates file sizes', () => {
    expect(estimateExportBytes(EXPORT_PRESETS.podcast, 48000 * 60)).toBe(960000);
    expect(estimateExportBytes(EXPORT_PRESETS.wav, 48000 * 60)).toBe(48000 * 60 * 2 + 44);
  });

  it('mixes at the timeline rate and asks the renderer to convert to 44.1 kHz (Issue #174)', async () => {
    const { db, engine, svc } = await setup();
    const preset = resolveExportPreset('custom', {
      format: 'm4a',
      bitrate: 192_000,
      channels: 2,
      sampleRate: 44100,
    });
    await svc.start('e', preset);
    const r = engine.renders[0]!;
    expect((r.doc as { sampleRate: number }).sampleRate).toBe(48000);
    expect(r.opts).toMatchObject({ sampleRate: 44100 });
    const row = (await listExports(db, 'e'))[0]!;
    expect(JSON.parse(row.preset)).toMatchObject({ sampleRate: 44100 });
    // 長さはタイムラインのサンプル数のまま（再生・表示は 48 kHz で数える）
    expect(row.duration_smp).toBe((r.doc as { totalFrames: number }).totalFrames);
  });

  it('passes custom bitrate and channels to the renderer and records them', async () => {
    const { db, engine, svc } = await setup();
    const preset = resolveExportPreset('custom', { format: 'm4a', bitrate: 256_000, channels: 1 });
    await svc.start('e', preset);
    const r = engine.renders[0]!;
    expect(r.opts).toMatchObject({ format: 'm4a', bitrate: 256_000 });
    expect((r.doc as { channels: number }).channels).toBe(1);
    const row = (await listExports(db, 'e'))[0]!;
    expect(JSON.parse(row.preset)).toEqual({
      format: 'm4a',
      bitrate: 256_000,
      channels: 1,
      sampleRate: 48000,
      loudness: { enabled: true, targetLufs: -16, truePeakDbtp: -1 },
    });
  });
});

describe('exportLoudness', () => {
  const preset = (loudness?: object) =>
    JSON.stringify({ format: 'm4a', bitrate: 128000, channels: 1, sampleRate: 48000, loudness });
  const on = { enabled: true, targetLufs: -16, truePeakDbtp: -1 };

  it('shows the measured output loudness', () => {
    expect(exportLoudness({ preset: preset(on), measured_lufs: -16.04 })).toEqual({
      lufs: -16.04,
      shortOfTarget: null,
    });
  });

  it('flags outputs more than 1 LU below the target (recording too quiet)', () => {
    expect(exportLoudness({ preset: preset(on), measured_lufs: -23.8 })?.shortOfTarget).toBe(-16);
    expect(exportLoudness({ preset: preset(on), measured_lufs: -16.9 })?.shortOfTarget).toBeNull();
  });

  it('does not flag when loudness adjustment was off', () => {
    const off = { ...on, enabled: false };
    expect(exportLoudness({ preset: preset(off), measured_lufs: -30 })).toEqual({
      lufs: -30,
      shortOfTarget: null,
    });
  });

  it('hides values from older rows that stored the pre-adjustment loudness', () => {
    expect(exportLoudness({ preset: preset(), measured_lufs: -23.4 })).toBeNull();
    expect(exportLoudness({ preset: 'broken', measured_lufs: -16 })).toBeNull();
  });

  it('hides silence and missing values', () => {
    expect(exportLoudness({ preset: preset(on), measured_lufs: -120 })).toBeNull();
    expect(exportLoudness({ preset: preset(on), measured_lufs: null })).toBeNull();
  });
});

describe('custom export settings', () => {
  it('resolves fixed presets unchanged', () => {
    expect(resolveExportPreset('podcast', null)).toBe(EXPORT_PRESETS.podcast);
    expect(resolveExportPreset('high', { bitrate: 64_000 })).toBe(EXPORT_PRESETS.high);
  });

  it('builds stereo WAV without a bitrate', () => {
    expect(resolveExportPreset('custom', { format: 'wav', bitrate: 256_000, channels: 2 })).toEqual(
      { format: 'wav', bitrate: 0, channels: 2, sampleRate: 48000 },
    );
  });

  it('falls back per field for broken stored values', () => {
    expect(normalizeCustomExport(undefined)).toEqual(DEFAULT_CUSTOM_EXPORT);
    expect(normalizeCustomExport('x')).toEqual(DEFAULT_CUSTOM_EXPORT);
    expect(normalizeCustomExport({ format: 'mp3', bitrate: 999, channels: 6 })).toEqual(
      DEFAULT_CUSTOM_EXPORT,
    );
    expect(normalizeCustomExport({ format: 'wav', bitrate: 999, channels: 2 })).toEqual({
      format: 'wav',
      bitrate: DEFAULT_CUSTOM_EXPORT.bitrate,
      channels: 2,
      sampleRate: 48000,
    });
    expect(normalizeCustomExport({ sampleRate: 44100 }).sampleRate).toBe(44100);
    expect(normalizeCustomExport({ sampleRate: 96000 }).sampleRate).toBe(48000);
  });

  it('keeps the settings default in sync and within the offered bitrates', () => {
    expect(DEFAULT_SETTINGS.export.custom).toEqual(DEFAULT_CUSTOM_EXPORT);
    expect(CUSTOM_BITRATES).toContain(DEFAULT_CUSTOM_EXPORT.bitrate);
  });

  it('estimates AAC size from bitrate only, WAV from channels', () => {
    const min = 48000 * 60;
    const aacMono = resolveExportPreset('custom', { format: 'm4a', bitrate: 256_000, channels: 1 });
    expect(estimateExportBytes(aacMono, min)).toBe(1_920_000);
    const wavStereo = resolveExportPreset('custom', { format: 'wav', channels: 2 });
    expect(estimateExportBytes(wavStereo, min)).toBe(min * 2 * 2 + 44);
    // 長さはタイムライン（48 kHz）で数え、大きさは出力のレートで見積もる
    const wav441 = resolveExportPreset('custom', { format: 'wav', channels: 1, sampleRate: 44100 });
    expect(estimateExportBytes(wav441, min)).toBe(44100 * 60 * 2 + 44);
  });
});

describe('episodeExportPreset (DATA_MODEL.md §4.5.1 / Issue #136)', () => {
  it("prefers the preset last chosen for the episode over the settings' default", () => {
    expect(episodeExportPreset('wav', 'podcast')).toBe('wav');
    expect(episodeExportPreset('custom', 'high')).toBe('custom');
    expect(episodeExportPreset('podcast', 'wav')).toBe('podcast');
  });

  it("falls back to the settings' default when the episode has never chosen one", () => {
    expect(episodeExportPreset(null, 'podcast')).toBe('podcast');
    expect(episodeExportPreset(undefined, 'high')).toBe('high');
  });

  it("falls back to the settings' default for unknown stored values", () => {
    expect(episodeExportPreset('mp3', 'high')).toBe('high');
    expect(episodeExportPreset('', 'wav')).toBe('wav');
  });

  describe('remove (Issue #152)', () => {
    it('keeps the row when the file cannot be deleted', async () => {
      const { db, engine } = await setup();
      await insertExportRow(db, 'a', 'done', 'episodes/e/exports/a.m4a');
      const svc = new ExportService({
        db,
        engine,
        root: '/root',
        ensureDir: () => {},
        fileSize: () => 0,
        fileExists: () => true,
        copyAsNamed: () => Promise.resolve(''),
        deleteFile: () => {
          throw new Error('busy');
        },
        fs: nodeFsPort,
        newId: () => 'n',
        now: () => 5000,
      });
      await expect(svc.remove('a')).rejects.toMatchObject({ code: 'file_delete_failed' });
      expect((await listExports(db, 'e')).map((x) => x.id)).toEqual(['a']);
    });

    it('deletes the file and then the row', async () => {
      const { db, svc, deleted } = await setup();
      await insertExportRow(db, 'a', 'done', 'episodes/e/exports/a.m4a');
      await svc.remove('a');
      expect(await listExports(db, 'e')).toEqual([]);
      expect(deleted).toEqual(['/root/episodes/e/exports/a.m4a']);
      // 録音には触らない（FR-SAFE-7）。
      expect(await db.get("SELECT id FROM takes WHERE id = 'T' AND deleted_at IS NULL")).toEqual({
        id: 'T',
      });
    });

    it('removes failed rows that have no file', async () => {
      const { db, svc, deleted } = await setup();
      await insertExportRow(db, 'f', 'failed', null);
      await svc.remove('f');
      expect(await listExports(db, 'e')).toEqual([]);
      expect(deleted).toEqual([]);
    });

    it('refuses to remove an export that is still being written', async () => {
      const { db, svc, deleted } = await setup();
      await insertExportRow(db, 'r', 'rendering', null);
      await expect(svc.remove('r')).rejects.toThrow();
      expect((await listExports(db, 'e')).map((x) => x.id)).toEqual(['r']);
      expect(deleted).toEqual([]);
    });

    it('does nothing for an unknown export', async () => {
      const { svc, deleted } = await setup();
      await svc.remove('nope');
      expect(deleted).toEqual([]);
    });
  });

  describe('share (Issue #166)', () => {
    it('names the file from the show name, episode number and title', async () => {
      const { db, svc } = await setup();
      await db.run("UPDATE shows SET name = 'ねもとのラジオ' WHERE id = 's'");
      await db.run("UPDATE episodes SET title = '初回/ゲスト' WHERE id = 'e'");
      await insertExportRow(db, 'a', 'done', 'episodes/e/exports/a.m4a');
      expect(await svc.shareFileName('a')).toBe('ねもとのラジオ - 001 - 初回 ゲスト.m4a');
      expect(await svc.shareFileName('nope')).toBeNull();
    });

    it('copies the export under that name into tmp/share and leaves the original', async () => {
      const { db, svc, copies, deleted } = await setup();
      await db.run("UPDATE episodes SET title = 'T' WHERE id = 'e'");
      await insertExportRow(db, 'a', 'done', 'episodes/e/exports/a.m4a');
      const shared = await svc.prepareShare('a');
      expect(copies).toEqual([
        { src: '/root/episodes/e/exports/a.m4a', dir: '/root/tmp/share', name: '001 - T.m4a' },
      ]);
      expect(shared).toEqual({
        uri: `file:///root/tmp/share/${encodeURIComponent('001 - T.m4a')}`,
        fileName: '001 - T.m4a',
        format: 'm4a',
      });
      // 書き出しの実物と行はそのまま（履歴・試聴が path で指している）。
      expect(deleted).toEqual([]);
      expect((await listExports(db, 'e'))[0]?.path).toBe('episodes/e/exports/a.m4a');
    });

    it('returns null when there is nothing to share', async () => {
      const { db, svc, copies, missing } = await setup();
      await insertExportRow(db, 'run', 'rendering', null);
      await insertExportRow(db, 'gone', 'done', 'episodes/e/exports/gone.m4a');
      missing.add('/root/episodes/e/exports/gone.m4a');
      expect(await svc.prepareShare('run')).toBeNull();
      expect(await svc.prepareShare('gone')).toBeNull();
      expect(await svc.prepareShare('nope')).toBeNull();
      expect(copies).toEqual([]);
    });

    it('reports share_prepare_failed when the copy fails', async () => {
      const { db, engine } = await setup();
      await insertExportRow(db, 'a', 'done', 'episodes/e/exports/a.m4a');
      const svc = new ExportService({
        db,
        engine,
        root: '/root',
        ensureDir: () => {},
        fileSize: () => 0,
        fileExists: () => true,
        deleteFile: () => {},
        copyAsNamed: () => Promise.reject(new Error('ENOSPC')),
        fs: nodeFsPort,
        newId: () => 'n',
        now: () => 5000,
      });
      await expect(svc.prepareShare('a')).rejects.toMatchObject({ code: 'share_prepare_failed' });
    });
  });

  describe('removalImpact (Issue #152)', () => {
    it('is not the last way to listen while the timeline still has voice', async () => {
      const { db, svc } = await setup();
      await insertExportRow(db, 'a', 'done', 'episodes/e/exports/a.m4a');
      expect(await svc.removalImpact('a')).toEqual({ lastListenable: false });
    });

    it('is the last way to listen when recordings are gone and nothing is published', async () => {
      const { db, svc } = await setup();
      await db.run('DELETE FROM voice_segments');
      await insertExportRow(db, 'a', 'done', 'episodes/e/exports/a.m4a');
      expect(await svc.removalImpact('a')).toEqual({ lastListenable: true });
    });

    it('is not the last way to listen when another export remains', async () => {
      const { db, svc } = await setup();
      await db.run('DELETE FROM voice_segments');
      await insertExportRow(db, 'a', 'done', 'episodes/e/exports/a.m4a');
      await insertExportRow(db, 'b', 'done', 'episodes/e/exports/b.m4a');
      expect(await svc.removalImpact('a')).toEqual({ lastListenable: false });
    });

    it('is not the last way to listen when the episode is published with audio', async () => {
      const { db, svc } = await setup();
      await db.run('DELETE FROM voice_segments');
      await insertExportRow(db, 'a', 'done', 'episodes/e/exports/a.m4a');
      await db.run(
        `INSERT INTO feed_episodes (id, show_id, guid, enclosure_url, episode_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`,
        ['f', 's', 'g', 'https://example.test/1.mp3', 'e', 1, 1],
      );
      expect(await svc.removalImpact('a')).toEqual({ lastListenable: false });
    });

    it('matches a published episode by GUID like Home does (FR-EP-7)', async () => {
      const { db, svc } = await setup();
      await db.run('DELETE FROM voice_segments');
      await db.run("UPDATE episodes SET guid = 'g' WHERE id = 'e'");
      await insertExportRow(db, 'a', 'done', 'episodes/e/exports/a.m4a');
      await db.run(
        `INSERT INTO feed_episodes (id, show_id, guid, enclosure_url, created_at, updated_at)
         VALUES (?,?,?,?,?,?)`,
        ['f', 's', 'g', 'https://example.test/1.mp3', 1, 1],
      );
      expect(await svc.removalImpact('a')).toEqual({ lastListenable: false });
    });

    it('does not warn for rows without a file', async () => {
      const { db, svc } = await setup();
      await db.run('DELETE FROM voice_segments');
      await insertExportRow(db, 'f', 'failed', null);
      expect(await svc.removalImpact('f')).toEqual({ lastListenable: false });
    });
  });
});
