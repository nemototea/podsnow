import { moveItem } from '@/domain/outline';
import { smp } from '@/domain/time';
import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';

import { OutlineService } from '../OutlineService';

async function setup() {
  const db = createNodeSqliteExecutor();
  await migrate(db);
  let id = 0;
  const newId = () => `id${++id}`;
  const now = Date.now();
  await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s1', now, now]);
  await db.run(
    'INSERT INTO episodes (id, show_id, episode_number, created_at, updated_at) VALUES (?,?,?,?,?)',
    ['e1', 's1', 1, now, now],
  );
  await db.run(
    'INSERT INTO takes (id, episode_id, status, started_at, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    ['t1', 'e1', 'ready', now, now, now],
  );
  return { db, svc: new OutlineService({ db, newId, now: () => 5000 }) };
}

describe('OutlineService', () => {
  it('貼り付けたテキストを 1 行ずつの項目にする', async () => {
    const { svc } = await setup();
    await svc.addFromText('e1', '- 近況\n\n- 最近読んだ本\n1. お便り');
    expect((await svc.list('e1')).map((i) => i.heading)).toEqual([
      '近況',
      '最近読んだ本',
      'お便り',
    ]);
  });

  it('本文（台本）を足しても、項目の種類は変わらない', async () => {
    const { svc } = await setup();
    await svc.addFromText('e1', '近況\nお便り');
    const [first] = await svc.list('e1');
    await svc.update('e1', first!.id, { body: '今日は…' });
    const items = await svc.list('e1');
    expect(items.map((i) => [i.heading, i.body])).toEqual([
      ['近況', '今日は…'],
      ['お便り', ''],
    ]);
  });

  it('次へ進むと、その位置がチャプターになる', async () => {
    const { svc } = await setup();
    await svc.addFromText('e1', 'A\nB');
    const first = await svc.advance('e1', { takeId: 't1', srcSmp: smp(0) });
    expect(first?.heading).toBe('A');
    const second = await svc.advance('e1', { takeId: 't1', srcSmp: smp(48000) });
    expect(second?.heading).toBe('B');
    expect(await svc.advance('e1', { takeId: 't1', srcSmp: smp(96000) })).toBeNull();

    expect((await svc.list('e1')).map((i) => [i.heading, i.recordedSrcSmp])).toEqual([
      ['A', 0],
      ['B', 48000],
    ]);
  });

  it('録音していないときに進めても、位置は持たない', async () => {
    const { svc } = await setup();
    await svc.addFromText('e1', 'A');
    const item = await svc.advance('e1', null);
    expect(item?.recordedTakeId).toBeNull();
    expect((await svc.list('e1'))[0]!.doneAt).toBe(5000);
  });

  it('並べ替えと削除', async () => {
    const { svc } = await setup();
    await svc.addFromText('e1', 'A\nB\nC');
    await svc.move('e1', 2, 0);
    expect((await svc.list('e1')).map((i) => i.heading)).toEqual(['C', 'A', 'B']);
    const items = await svc.list('e1');
    await svc.remove('e1', items[1]!.id);
    expect((await svc.list('e1')).map((i) => i.heading)).toEqual(['C', 'B']);
  });

  it('ドラッグの並べ替え（並びごと保存）は、本文とチャプターの位置を連れて動く', async () => {
    const { svc } = await setup();
    await svc.addFromText('e1', 'A\nB\nC');
    const [a] = await svc.list('e1');
    await svc.update('e1', a!.id, { body: 'Aの台本' });
    await svc.advance('e1', { takeId: 't1', srcSmp: smp(4800) });

    // 画面は moveItem で並べ替えた列を save に渡す
    const items = await svc.list('e1');
    await svc.save('e1', moveItem(items, 0, 2));

    const saved = await svc.list('e1');
    expect(saved.map((i) => i.heading)).toEqual(['B', 'C', 'A']);
    expect(saved[2]).toMatchObject({
      id: a!.id,
      body: 'Aの台本',
      recordedTakeId: 't1',
      recordedSrcSmp: 4800,
      doneAt: 5000,
    });
  });

  it('番組のひな形をエピソードへ写す。写した後は独立したデータ', async () => {
    const { svc } = await setup();
    await svc.saveTemplate('s1', [
      { heading: 'オープニング', body: 'こんばんは' },
      { heading: 'お便り', body: '' },
    ]);
    await svc.applyTemplate('s1', 'e1');
    const items = await svc.list('e1');
    expect(items.map((i) => [i.heading, i.body])).toEqual([
      ['オープニング', 'こんばんは'],
      ['お便り', ''],
    ]);

    // ひな形を書き換えても、写し終えたエピソードは変わらない
    await svc.saveTemplate('s1', [{ heading: '別の並び', body: '' }]);
    expect((await svc.list('e1')).map((i) => i.heading)).toEqual(['オープニング', 'お便り']);
  });

  it('ひな形が空なら何も入れない', async () => {
    const { svc } = await setup();
    await svc.applyTemplate('s1', 'e1');
    expect(await svc.list('e1')).toEqual([]);
  });
});
