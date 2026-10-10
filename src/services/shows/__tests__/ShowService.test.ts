import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { ensureDefaultShow } from '@/infra/db/repositories/showsRepo';
import { TEST_SHOW_SEED } from '@/services/app/__tests__/labels';

import { ShowService } from '../ShowService';

async function setup() {
  const db = createNodeSqliteExecutor();
  await migrate(db);
  let id = 0;
  const newId = () => `id${++id}`;
  let clock = 1000;
  const now = () => ++clock;
  const show = await ensureDefaultShow(db, newId, 1000, TEST_SHOW_SEED);
  return { db, show, svc: new ShowService({ db, newId, now }) };
}

describe('ShowService', () => {
  it('番組とカテゴリーを読む。無い番組は null', async () => {
    const { svc, show } = await setup();
    const info = await svc.getInfo(show.id);
    expect(info?.show.id).toBe(show.id);
    expect(info?.categories).toEqual([]);
    expect(await svc.getInfo('missing')).toBeNull();
  });

  it('言語・explicit・Web サイト・カテゴリーを書き、渡していない項目は変えない', async () => {
    const { svc, show } = await setup();
    await svc.updateInfo(show.id, {
      websiteUrl: 'https://example.com',
      language: 'ja',
      explicit: true,
      categories: [
        { category: 'Comedy', subcategory: 'Improv' },
        { category: 'Arts', subcategory: '' },
      ],
    });
    const info = (await svc.getInfo(show.id))!;
    expect(info.show).toMatchObject({
      name: show.name,
      website_url: 'https://example.com',
      language: 'ja',
      explicit: 1,
    });
    expect(Number(info.show.updated_at)).toBeGreaterThan(Number(show.updated_at));
    expect(info.categories).toEqual([
      { category: 'Comedy', subcategory: 'Improv' },
      { category: 'Arts', subcategory: '' },
    ]);

    await svc.updateInfo(show.id, { name: '新しい名前' });
    const after = (await svc.getInfo(show.id))!;
    expect(after.show.name).toBe('新しい名前');
    expect(after.categories).toHaveLength(2);
  });

  it('カテゴリーは丸ごと置き換え、空にもできる', async () => {
    const { svc, show } = await setup();
    await svc.updateInfo(show.id, { categories: [{ category: 'News', subcategory: '' }] });
    await svc.updateInfo(show.id, { categories: [] });
    expect((await svc.getInfo(show.id))!.categories).toEqual([]);
  });

  it('カテゴリーの書き込みに失敗したら番組情報も戻す', async () => {
    const { db, svc, show } = await setup();
    await db.exec('DROP TABLE show_categories');
    await expect(
      svc.updateInfo(show.id, {
        name: '途中で落ちる',
        categories: [{ category: 'News', subcategory: '' }],
      }),
    ).rejects.toThrow();
    const row = await db.get<{ name: string }>('SELECT name FROM shows WHERE id = ?', [show.id]);
    expect(row?.name).toBe(show.name);
  });

  it('既定の構成と概要欄テンプレートを読み書きする', async () => {
    const { svc, show } = await setup();
    await svc.updateLayout(show.id, { bgmDuckDb: -14 });
    expect((await svc.getLayout(show.id)).bgm_duck_db).toBe(-14);
    const tpl = (await svc.getDescriptionTemplate(show.id))!;
    await svc.updateDescriptionTemplate(tpl.id, '本文 {{title}}');
    expect((await svc.getDescriptionTemplate(show.id))?.body).toBe('本文 {{title}}');
  });
});
