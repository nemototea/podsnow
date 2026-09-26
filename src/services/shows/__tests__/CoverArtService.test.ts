import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { ensureDefaultShow, getShow, updateShow } from '@/infra/db/repositories/showsRepo';
import { nodeFsPort } from '@/services/backup/__tests__/nodeFsPort';
import { TEST_SHOW_SEED } from '@/services/app/__tests__/labels';

import { CoverArtService } from '../CoverArtService';
import type { ImageProcessorPort } from '../ImageProcessorPort';
import type { ImagePickerPort } from '../ImagePickerPort';

async function setup(processor?: ImageProcessorPort, picker?: ImagePickerPort) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'podsnow-cover-'));
  const db = createNodeSqliteExecutor();
  await migrate(db);
  let id = 0;
  let coverId = 0;
  const show = await ensureDefaultShow(db, () => `id-${++id}`, 1000, TEST_SHOW_SEED);
  const normalized = path.join(root, 'normalized.jpg');
  const seen: unknown[] = [];
  const imageProcessor: ImageProcessorPort =
    processor ??
    ({
      async normalizeSquareJpeg(source, maxPixels) {
        seen.push({ source, maxPixels });
        fs.writeFileSync(normalized, Buffer.from('normalized-jpeg'));
        return { uri: `file://${normalized}`, width: 3000, height: 3000 };
      },
    } satisfies ImageProcessorPort);
  const service = new CoverArtService({
    db,
    fs: nodeFsPort,
    imagePicker: picker ?? { pickSquare: async () => null },
    imageProcessor,
    root,
    newId: () => `cover-${++coverId}`,
    now: () => 5000,
  });
  return { root, db, show, service, seen };
}

describe('CoverArtService', () => {
  it('picks through the service boundary and reports cancellation without writing', async () => {
    const canceled = await setup();
    await expect(canceled.service.pickAndSet(canceled.show.id)).resolves.toBe(false);
    expect((await getShow(canceled.db, canceled.show.id))?.cover_path).toBeNull();

    const selected = await setup(undefined, {
      pickSquare: async () => ({ uri: 'file:///picked.png', width: 200, height: 100 }),
    });
    await expect(selected.service.pickAndSet(selected.show.id)).resolves.toBe(true);
    expect((await getShow(selected.db, selected.show.id))?.cover_path).toContain('/cover-');
    fs.rmSync(canceled.root, { recursive: true, force: true });
    fs.rmSync(selected.root, { recursive: true, force: true });
  });

  it('normalizes into a new file, commits the DB path, then removes the old file', async () => {
    const { root, db, show, service, seen } = await setup();
    const oldRel = `shows/${show.id}/cover-1000.png`;
    const oldAbs = path.join(root, oldRel);
    fs.mkdirSync(path.dirname(oldAbs), { recursive: true });
    fs.writeFileSync(oldAbs, Buffer.from('old'));
    await updateShow(db, show.id, { coverPath: oldRel }, 2000);

    const rel = await service.set(show.id, {
      uri: 'file:///picked.png',
      width: 4200,
      height: 3600,
    });

    expect(rel).toBe(`shows/${show.id}/cover-5000-cover-1.jpg`);
    expect((await getShow(db, show.id))?.cover_path).toBe(rel);
    expect(fs.readFileSync(path.join(root, rel))).toEqual(Buffer.from('normalized-jpeg'));
    expect(fs.existsSync(oldAbs)).toBe(false);
    expect(seen).toEqual([
      {
        source: { uri: 'file:///picked.png', width: 4200, height: 3600 },
        maxPixels: 3000,
      },
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps the current cover when processing fails', async () => {
    const failing: ImageProcessorPort = {
      normalizeSquareJpeg: async () => {
        throw new Error('decode failed');
      },
    };
    const { root, db, show, service } = await setup(failing);
    const oldRel = `shows/${show.id}/cover-1000.jpg`;
    const oldAbs = path.join(root, oldRel);
    fs.mkdirSync(path.dirname(oldAbs), { recursive: true });
    fs.writeFileSync(oldAbs, Buffer.from('old'));
    await updateShow(db, show.id, { coverPath: oldRel }, 2000);

    await expect(
      service.set(show.id, { uri: 'file:///broken.jpg', width: 100, height: 100 }),
    ).rejects.toMatchObject({ code: 'cover_processing_failed' });
    expect((await getShow(db, show.id))?.cover_path).toBe(oldRel);
    expect(fs.readFileSync(oldAbs)).toEqual(Buffer.from('old'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('uses a distinct path for replacements created in the same millisecond', async () => {
    const { root, show, service } = await setup();
    const source = { uri: 'file:///picked.png', width: 100, height: 100 };

    const first = await service.set(show.id, source);
    const second = await service.set(show.id, source);

    expect(second).not.toBe(first);
    expect(fs.existsSync(path.join(root, first))).toBe(false);
    expect(fs.readFileSync(path.join(root, second))).toEqual(Buffer.from('normalized-jpeg'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('clears the DB reference before deleting cover files', async () => {
    const { root, db, show, service } = await setup();
    const rel = `shows/${show.id}/cover-1000.jpg`;
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from('cover'));
    fs.writeFileSync(path.join(path.dirname(abs), 'cover-orphan.png'), Buffer.from('orphan'));
    await updateShow(
      db,
      show.id,
      { coverPath: rel, coverSourceUrl: 'https://example.com/a.jpg' },
      2000,
    );

    await service.remove(show.id);

    expect(await getShow(db, show.id)).toMatchObject({ cover_path: null, cover_source_url: null });
    expect(fs.existsSync(abs)).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(abs), 'cover-orphan.png'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
