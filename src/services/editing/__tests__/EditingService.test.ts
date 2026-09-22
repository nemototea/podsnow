import { smp, ZERO_SMP } from '@/domain/time';
import { appendTake, deleteRange } from '@/domain/timeline/voice';
import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { loadDoc } from '@/infra/db/repositories/editableDocRepo';

import { EditingService } from '../EditingService';

async function setup() {
  const db = createNodeSqliteExecutor();
  await migrate(db);
  const now = 1_000;
  await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s', now, now]);
  await db.run(
    'INSERT INTO episodes (id, show_id, episode_number, created_at, updated_at) VALUES (?,?,?,?,?)',
    ['e', 's', 1, now, now],
  );
  for (const t of ['T1', 'T2']) {
    await db.run(
      'INSERT INTO takes (id, episode_id, status, started_at, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      [t, 'e', 'ready', now, 1000, now, now],
    );
  }
  await db.run(
    'INSERT INTO assets (id, show_id, kind, name, path, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ['J', 's', 'jingle', 'Jingle', 'x.wav', 100, now, now],
  );
  let id = 0;
  let clock = 10_000;
  const deps = { db, newId: () => `op${++id}`, now: () => (clock += 100) };
  return { db, deps };
}

describe('EditingService', () => {
  it('persists every edit and restores doc + history after reopening', async () => {
    const { db, deps } = await setup();
    let svc = await EditingService.open(deps, 'e');
    expect(svc.current.voice).toEqual([]);

    await svc.writeWithoutHistory((d) => ({
      ...d,
      voice: appendTake(d.voice, { id: 'v1', takeId: 'T1', durationSmp: smp(1000) }),
    }));
    expect(svc.canUndo).toBe(false);

    await svc.apply('範囲を削除', (d) => ({
      ...d,
      voice: deleteRange(d.voice, smp(100), smp(200)),
    }));
    await svc.apply('音量を変える', (d) => ({
      ...d,
      voice: d.voice.map((v, i) => (i === 0 ? { ...v, gainDb: -3 } : v)),
    }));
    await svc.apply('ジングルを挿入', (d) => ({
      ...d,
      overlays: [
        ...d.overlays,
        {
          id: 'o1',
          assetId: 'J',
          kind: 'jingle',
          anchor: { type: 'source', takeId: 'T1', srcSmp: smp(300) },
          srcStart: ZERO_SMP,
          srcEnd: null,
          gainDb: -4,
          fadeIn: ZERO_SMP,
          fadeOut: ZERO_SMP,
          duck: false,
          loop: false,
          endMode: 'asset_end',
        },
      ],
    }));
    expect(svc.undoLabel).toBe('ジングルを挿入');

    // 再オープンしても同じ状態
    svc = await EditingService.open(deps, 'e');
    expect(svc.current.voice.map((s) => [s.srcStart, s.srcEnd])).toEqual([
      [0, 100],
      [200, 1000],
    ]);
    expect(svc.current.voice[0]!.gainDb).toBe(-3);
    expect(svc.current.overlays[0]!.anchor).toEqual({ type: 'source', takeId: 'T1', srcSmp: 300 });
    expect(svc.canUndo).toBe(true);
    expect(svc.canRedo).toBe(false);

    // Undo ×2 → 再オープン → Redo
    expect((await svc.undo())?.label).toBe('ジングルを挿入');
    expect((await svc.undo())?.label).toBe('音量を変える');
    expect(svc.current.overlays).toEqual([]);
    expect(svc.current.voice[0]!.gainDb).toBe(0);
    svc = await EditingService.open(deps, 'e');
    expect(svc.redoLabel).toBe('音量を変える');
    expect((await svc.redo())?.label).toBe('音量を変える');
    expect((await loadDoc(db, 'e')).voice[0]!.gainDb).toBe(-3);

    // Undo 後の新規操作で Redo 側が消える
    await svc.apply('別の削除', (d) => ({ ...d, voice: deleteRange(d.voice, smp(0), smp(50)) }));
    expect(svc.canRedo).toBe(false);
    const rows = await db.all<{ seq: number; label: string }>(
      'SELECT seq, label FROM edit_ops WHERE episode_id = ? ORDER BY seq',
      ['e'],
    );
    expect(rows.map((r) => r.label)).toEqual(['範囲を削除', '音量を変える', '別の削除']);
    const cur = await db.get<{ undo_cursor: number }>(
      'SELECT undo_cursor FROM episodes WHERE id = ?',
      ['e'],
    );
    expect(cur?.undo_cursor).toBe(3);
  });

  it('coalesces grouped edits into one op row', async () => {
    const { db, deps } = await setup();
    const svc = await EditingService.open(deps, 'e');
    await svc.writeWithoutHistory((d) => ({
      ...d,
      voice: appendTake(d.voice, { id: 'v1', takeId: 'T1', durationSmp: smp(1000) }),
    }));
    for (const g of [-1, -2, -3]) {
      await svc.apply('音量を変更', (d) => ({ ...d, voice: [{ ...d.voice[0]!, gainDb: g }] }), {
        groupKey: 'gain:v1',
      });
    }
    const rows = await db.all('SELECT seq FROM edit_ops WHERE episode_id = ?', ['e']);
    expect(rows).toHaveLength(1);
    await svc.undo();
    expect(svc.current.voice[0]!.gainDb).toBe(0);
  });

  it('ignores no-op edits', async () => {
    const { db, deps } = await setup();
    const svc = await EditingService.open(deps, 'e');
    expect(await svc.apply('nothing', (d) => d)).toBeNull();
    expect(await db.all('SELECT seq FROM edit_ops')).toEqual([]);
  });
});
