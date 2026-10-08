import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';

import { NotesService } from '../NotesService';

async function setup() {
  const db = createNodeSqliteExecutor();
  await migrate(db);
  const now = 1000;
  await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s1', now, now]);
  for (const id of ['e1', 'e2']) {
    await db.run('INSERT INTO episodes (id, show_id, created_at, updated_at) VALUES (?,?,?,?)', [
      id,
      's1',
      now,
      now,
    ]);
  }
  return { db, svc: new NotesService({ db }) };
}

describe('NotesService', () => {
  it('starts empty and keeps the text as written (line breaks included)', async () => {
    const { svc } = await setup();
    expect(await svc.get('e1')).toBe('');
    await svc.save('e1', 'オープニング\n\n・近況\n  → 本の話\n');
    expect(await svc.get('e1')).toBe('オープニング\n\n・近況\n  → 本の話\n');
  });

  it('saves notes per episode', async () => {
    const { svc } = await setup();
    await svc.save('e1', 'A');
    await svc.save('e2', 'B');
    expect([await svc.get('e1'), await svc.get('e2')]).toEqual(['A', 'B']);
  });

  it('does not touch updated_at (typing must not reorder the lists)', async () => {
    const { db, svc } = await setup();
    await svc.save('e1', 'x');
    expect(await db.get('SELECT updated_at FROM episodes WHERE id = ?', ['e1'])).toEqual({
      updated_at: 1000,
    });
  });

  it('keeps one template per show', async () => {
    const { svc } = await setup();
    expect(await svc.getTemplate('s1')).toBe('');
    await svc.saveTemplate('s1', 'オープニング\nお便り\nエンディング');
    expect(await svc.getTemplate('s1')).toBe('オープニング\nお便り\nエンディング');
  });
});
