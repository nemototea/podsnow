import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { loadDoc, saveDoc } from '@/infra/db/repositories/editableDocRepo';
import { ensureDefaultShow } from '@/infra/db/repositories/showsRepo';
import { TEST_SHOW_SEED } from '@/services/app/__tests__/labels';
import { listSegments, listTakes } from '@/infra/db/repositories/takesRepo';
import { smp } from '@/domain/time';

import { backupFileName, exportEpisodeBackup, importEpisodeBackup } from '../BackupService';
import { nodeFsPort } from './nodeFsPort';

function wavBytes(frames: number, seed: number): Uint8Array {
  const data = new Uint8Array(44 + frames * 2);
  const dv = new DataView(data.buffer);
  const ascii = (o: number, s: string) =>
    [...s].forEach((ch, i) => (data[o + i] = ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + frames * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, 48000, true);
  dv.setUint32(28, 96000, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ascii(36, 'data');
  dv.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++)
    dv.setInt16(44 + i * 2, ((i * 7919 + seed) % 65536) - 32768, true);
  return data;
}

async function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'podsnow-backup-'));
  const root = path.join(tmp, 'root');
  const db = createNodeSqliteExecutor();
  await migrate(db);
  let n = 0;
  const newId = () => `id${++n}`;
  const show = await ensureDefaultShow(db, newId, 1000, TEST_SHOW_SEED);
  const t = 1000;
  await db.run(
    'INSERT INTO episodes (id, show_id, title, description, episode_number, season, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ['E', show.id, 'テスト回', '概要', 3, 2, 'exported', t, t],
  );
  await db.run(
    'INSERT INTO takes (id, episode_id, name, status, started_at, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ['T1', 'E', '録音 1', 'ready', t, 3000, t, t],
  );
  for (const [seq, off, dur] of [
    [1, 0, 2000],
    [2, 2000, 1000],
  ] as const) {
    const rel = `episodes/E/takes/T1/seg-000${seq}.wav`;
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), wavBytes(dur, seq));
    await db.run(
      'INSERT INTO take_segments (id, take_id, seq, path, offset_smp, duration_smp, header_valid, reason_closed) VALUES (?,?,?,?,?,?,1,?)',
      [`S${seq}`, 'T1', seq, rel, off, dur, seq === 1 ? 'interruption' : 'stop'],
    );
  }
  const assetRel = `shows/${show.id}/assets/J.wav`;
  fs.mkdirSync(path.dirname(path.join(root, assetRel)), { recursive: true });
  fs.writeFileSync(path.join(root, assetRel), wavBytes(500, 99));
  await db.run(
    'INSERT INTO assets (id, show_id, kind, name, path, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ['J', show.id, 'jingle', 'Jingle', assetRel, 500, t, t],
  );
  await saveDoc(
    db,
    'E',
    {
      voice: [
        {
          id: 'v1',
          takeId: 'T1',
          srcStart: smp(0),
          srcEnd: smp(1500),
          gainDb: -1,
          fadeIn: smp(0),
          fadeOut: smp(0),
        },
        {
          id: 'v2',
          takeId: 'T1',
          srcStart: smp(2500),
          srcEnd: smp(3000),
          gainDb: 0,
          fadeIn: smp(0),
          fadeOut: smp(0),
        },
      ],
      overlays: [
        {
          id: 'o1',
          assetId: 'J',
          kind: 'jingle',
          anchor: { type: 'source', takeId: 'T1', srcSmp: smp(1000) },
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
    t,
  );
  await db.run(
    'INSERT INTO recording_events (id, episode_id, take_id, src_smp, label, kind, created_at) VALUES (?,?,?,?,?,?,?)',
    ['ev1', 'E', 'T1', 700, '割り込み', 'interruption', t],
  );
  await db.run(
    'INSERT INTO outline_items (id, episode_id, position, heading, body, recorded_take_id, recorded_src_smp, done_at) VALUES (?,?,?,?,?,?,?,?)',
    ['tp', 'E', 0, 'テーマ', '台本の本文', 'T1', 100, t],
  );
  await db.run(
    'INSERT INTO exports (id, episode_id, format, preset, status, progress, path, bytes, duration_smp, created_at, finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ['x1', 'E', 'm4a', '{}', 'done', 1, 'episodes/E/exports/x1.m4a', 10, 3000, t, t],
  );
  const deps = { db, fs: nodeFsPort, root, newId, now: () => 9000 };
  return { tmp, root, db, show, deps };
}

describe('BackupService', () => {
  it('keeps the backed-up episode number when it is free', async () => {
    const { tmp, show, db, deps } = await setup();
    const zip = path.join(tmp, 'out', 'e.podsnow');
    await exportEpisodeBackup(deps, 'E', zip);
    // 元の回を消しておけば #3 は空く（ストレージクリア後の復元と同じ状況）。
    await db.run('UPDATE episodes SET deleted_at = ? WHERE id = ?', [2000, 'E']);

    const res = await importEpisodeBackup(deps, show.id, zip);
    expect(res).toMatchObject({ episodeNumber: 3, renumbered: false });
  });

  it('keeps the RSS guid and item fields, and issues a new guid when it is already in use', async () => {
    const { tmp, show, db, deps } = await setup();
    await db.run(
      "UPDATE episodes SET guid = 'G', episode_type = 'bonus', explicit = 1, website_url = 'https://example.com/3', published_at = 5000 WHERE id = 'E'",
    );
    const zip = path.join(tmp, 'out', 'e.podsnow');
    await exportEpisodeBackup(deps, 'E', zip);

    // 元の回が残っている → 同じ guid は使えないので新しい回として復元する
    const dup = await importEpisodeBackup(deps, show.id, zip);
    expect(await db.get('SELECT guid FROM episodes WHERE id = ?', [dup.episodeId])).toEqual({
      guid: dup.episodeId,
    });

    // 元の回と複製を消せば guid は空く（ストレージクリア後の復元と同じ状況）
    await db.run('UPDATE episodes SET deleted_at = ? WHERE show_id = ?', [2000, show.id]);
    const res = await importEpisodeBackup(deps, show.id, zip);
    expect(
      await db.get(
        'SELECT guid, episode_type, explicit, website_url, published_at FROM episodes WHERE id = ?',
        [res.episodeId],
      ),
    ).toEqual({
      guid: 'G',
      episode_type: 'bonus',
      explicit: 1,
      website_url: 'https://example.com/3',
      published_at: 5000,
    });
  });

  it('round-trips an episode through a .podsnow zip with new IDs and identical audio', async () => {
    const { tmp, root, db, show, deps } = await setup();
    const zip = path.join(tmp, 'out', 'e.podsnow');
    const progress: string[] = [];
    const r = await exportEpisodeBackup(deps, 'E', zip, (p) => progress.push(p.phase));
    expect(r.bytes).toBeGreaterThan(44 * 3);
    expect(r.missingFiles).toEqual([]);
    expect(progress).toContain('zip');

    const res = await importEpisodeBackup(deps, show.id, zip);
    expect(res.episodeId).not.toBe('E');
    // 元の #3 がまだ残っているので、このときだけ振り直す（DATA_MODEL.md §7）。
    expect(res).toMatchObject({
      takes: 1,
      reusedAssets: 1,
      importedAssets: 0,
      episodeNumber: 4,
      renumbered: true,
    });

    const ep = await db.get<{
      title: string;
      season: number;
      status: string;
      episode_number: number;
    }>('SELECT title, season, status, episode_number FROM episodes WHERE id = ?', [res.episodeId]);
    expect(ep).toMatchObject({ title: 'テスト回', season: 2, status: 'ready', episode_number: 4 });

    const takes = await listTakes(db, res.episodeId);
    expect(takes).toHaveLength(1);
    expect(takes[0]!.id).not.toBe('T1');
    const segs = await listSegments(db, takes[0]!.id);
    expect(segs.map((s) => [s.seq, s.offset_smp, s.duration_smp, s.reason_closed])).toEqual([
      [1, 0, 2000, 'interruption'],
      [2, 2000, 1000, 'stop'],
    ]);
    for (const [i, s] of segs.entries()) {
      const restored = fs.readFileSync(path.join(root, s.path));
      const original = fs.readFileSync(path.join(root, `episodes/E/takes/T1/seg-000${i + 1}.wav`));
      expect(Buffer.compare(restored, original)).toBe(0);
    }

    const doc = await loadDoc(db, res.episodeId);
    expect(
      doc.voice.map((v) => [v.takeId === takes[0]!.id, v.srcStart, v.srcEnd, v.gainDb]),
    ).toEqual([
      [true, 0, 1500, -1],
      [true, 2500, 3000, 0],
    ]);
    expect(doc.overlays[0]).toMatchObject({
      assetId: 'J',
      anchor: { type: 'source', takeId: takes[0]!.id, srcSmp: 1000 },
      gainDb: -4,
    });
    expect(
      await db.all('SELECT src_smp, kind, label FROM recording_events WHERE episode_id = ?', [
        res.episodeId,
      ]),
    ).toEqual([{ src_smp: 700, kind: 'interruption', label: '割り込み' }]);
    expect(
      await db.all(
        'SELECT heading, body, recorded_take_id FROM outline_items WHERE episode_id = ?',
        [res.episodeId],
      ),
    ).toEqual([{ heading: 'テーマ', body: '台本の本文', recorded_take_id: takes[0]!.id }]);
    expect(
      await db.all('SELECT format, status, path FROM exports WHERE episode_id = ?', [
        res.episodeId,
      ]),
    ).toEqual([{ format: 'm4a', status: 'done', path: null }]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('carries over the export preset choice (DATA_MODEL.md §4.5.1)', async () => {
    const { tmp, show, db, deps } = await setup();
    const zip = path.join(tmp, 'out', 'e.podsnow');
    // 選んだことのない回は NULL のまま（= 復元後も設定の既定で開く）
    await exportEpisodeBackup(deps, 'E', zip);
    const plain = await importEpisodeBackup(deps, show.id, zip);
    expect(
      await db.get('SELECT export_preset FROM episodes WHERE id = ?', [plain.episodeId]),
    ).toEqual({ export_preset: null });

    await db.run('UPDATE episodes SET export_preset = ? WHERE id = ?', ['wav', 'E']);
    const zip2 = path.join(tmp, 'out', 'e2.podsnow');
    await exportEpisodeBackup(deps, 'E', zip2);
    const res = await importEpisodeBackup(deps, show.id, zip2);
    expect(
      await db.get('SELECT export_preset FROM episodes WHERE id = ?', [res.episodeId]),
    ).toEqual({ export_preset: 'wav' });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('imports the asset when the show does not have it', async () => {
    const { tmp, root, db, show, deps } = await setup();
    const zip = path.join(tmp, 'e.podsnow');
    await exportEpisodeBackup(deps, 'E', zip);
    await db.run('DELETE FROM overlay_clips');
    await db.run('DELETE FROM assets WHERE id = ?', ['J']);
    const res = await importEpisodeBackup(deps, show.id, zip);
    expect(res).toMatchObject({ reusedAssets: 0, importedAssets: 1 });
    const a = await db.get<{ id: string; path: string; name: string }>(
      'SELECT id, path, name FROM assets WHERE show_id = ?',
      [show.id],
    );
    expect(a?.id).not.toBe('J');
    expect(a?.name).toBe('Jingle');
    expect(
      Buffer.compare(fs.readFileSync(path.join(root, a!.path)), Buffer.from(wavBytes(500, 99))),
    ).toBe(0);
    const doc = await loadDoc(db, res.episodeId);
    expect(doc.overlays[0]?.assetId).toBe(a?.id);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects files that are not podsnow backups', async () => {
    const { tmp, deps, show } = await setup();
    const bogus = path.join(tmp, 'bogus.podsnow');
    fs.writeFileSync(bogus, 'not a zip');
    await expect(importEpisodeBackup(deps, show.id, bogus)).rejects.toThrow();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('builds a safe file name', () => {
    expect(backupFileName(3, 'テスト / 回:1', new Date('2026-09-19T00:00:00Z'))).toBe(
      'podsnow_ep3_テスト_回_1_2026-09-19.podsnow',
    );
  });
});
