import { smp } from '@/domain/time';
import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { saveDoc } from '@/infra/db/repositories/editableDocRepo';
import { listExports } from '@/infra/db/repositories/exportsRepo';
import { FakeAudioEngine } from '@/services/audio/__tests__/FakeAudioEngine';

import { estimateExportBytes, EXPORT_PRESETS, ExportService } from '../ExportService';

const flush = () => new Promise((r) => setTimeout(r, 0));

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
          duck: false,
          loop: false,
          endMode: 'asset_end',
        },
      ],
    },
    now,
  );
  const engine = new FakeAudioEngine();
  let id = 0;
  const svc = new ExportService({
    db,
    engine,
    root: '/root',
    ensureDir: () => {},
    fileSize: () => 12345,
    newId: () => `x${++id}`,
    now: () => 5000,
  });
  return { db, engine, svc };
}

describe('ExportService', () => {
  it('builds the render document from the DB, tracks progress and finishes', async () => {
    const { db, engine, svc } = await setup();
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
    engine.emit('onRenderDone', {
      jobId: r.jobId,
      path: r.opts.path,
      frames: 96000,
      measuredLufs: -20.5,
      measuredTruePeakDb: -3,
      appliedGainDb: 4.5,
    });
    await flush();
    await flush();
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

  it('estimates file sizes', () => {
    expect(estimateExportBytes(EXPORT_PRESETS.podcast, 48000 * 60)).toBe(960000);
    expect(estimateExportBytes(EXPORT_PRESETS.wav, 48000 * 60)).toBe(48000 * 60 * 2 + 44);
  });
});
