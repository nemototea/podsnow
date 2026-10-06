import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { ensureDefaultShow, getShow, updateShow } from '@/infra/db/repositories/showsRepo';
import { nodeFsPort } from '@/infra/files/__tests__/nodeFsPort';
import { TEST_SHOW_SEED } from '@/services/app/__tests__/labels';

import type { ImageProcessorPort } from '../ImageProcessorPort';
import { SAMPLE_SIZE, ShowColorService } from '../ShowColorService';

const BLUE = [31, 95, 214, 255];

async function setup(sample?: ImageProcessorPort['samplePixels']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'podsnow-color-'));
  const db = createNodeSqliteExecutor();
  await migrate(db);
  const show = await ensureDefaultShow(db, () => 'show-1', 1000, TEST_SHOW_SEED);
  const calls: [string, number][] = [];
  const tmp = path.join(root, 'sample.png');
  const imageProcessor: ImageProcessorPort = {
    normalizeSquareJpeg: async () => {
      throw new Error('unused');
    },
    samplePixels:
      sample ??
      (async (source, size) => {
        calls.push([source, size]);
        fs.writeFileSync(tmp, 'png');
        return {
          rgba: new Uint8Array(
            Array(size * size)
              .fill(BLUE)
              .flat(),
          ),
          uri: `file://${tmp}`,
        };
      }),
  };
  const service = new ShowColorService({
    db,
    fs: nodeFsPort,
    imageProcessor,
    root,
    now: () => 9000,
  });
  return { root, db, show, service, calls, tmp };
}

describe('ShowColorService（番組のアートワークの代表色）', () => {
  it('アートワークが無ければ null で、画像を読まない', async () => {
    const { db, show, service, calls, root } = await setup();
    await expect(service.ensure(show.id)).resolves.toBeNull();
    expect(calls).toEqual([]);
    expect((await getShow(db, show.id))?.cover_color).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('16×16 に縮めて代表色を計算し、保存して、一時ファイルを消す', async () => {
    const { db, show, service, calls, tmp, root } = await setup();
    await updateShow(db, show.id, { coverPath: 'shows/show-1/cover-1.jpg' }, 2000);
    await expect(service.ensure(show.id)).resolves.toBe('#1F5FD6');
    expect(calls).toEqual([[`file://${root}/shows/show-1/cover-1.jpg`, SAMPLE_SIZE]]);
    expect((await getShow(db, show.id))?.cover_color).toBe('#1F5FD6');
    expect(fs.existsSync(tmp)).toBe(false);
    // 保存済みなら読み直さない
    await expect(service.ensure(show.id)).resolves.toBe('#1F5FD6');
    expect(calls).toHaveLength(1);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('同じ番組を同時に頼まれても 1 回だけ計算する', async () => {
    const { db, show, service, calls, root } = await setup();
    await updateShow(db, show.id, { coverPath: 'shows/show-1/cover-1.jpg' }, 2000);
    await Promise.all([service.ensure(show.id), service.ensure(show.id)]);
    expect(calls).toHaveLength(1);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('画像を読めなければ null のまま（番組の操作は止めない）', async () => {
    const { db, show, service, root } = await setup(async () => {
      throw new Error('decode failed');
    });
    await updateShow(db, show.id, { coverPath: 'shows/show-1/cover-1.jpg' }, 2000);
    await expect(service.ensure(show.id)).resolves.toBeNull();
    expect((await getShow(db, show.id))?.cover_color).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
