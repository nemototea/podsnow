import type { EditableDoc } from '@/domain/editing/doc';
import type { CommitResult, EditOp, History } from '@/domain/editing/history';

import type { SqlExecutor, SqlRow } from '../executor';
import { saveDoc } from './editableDocRepo';

/*
 * edit_ops テーブルと episodes.undo_cursor の永続化。
 * undo_cursor には「適用済みの最後の op の seq」を入れる（0 = なし）。
 * 履歴が上限で切り詰められても seq は安定なので、インデックスより堅い。
 */

interface OpRow extends SqlRow {
  id: string;
  seq: number;
  label: string;
  op: string;
  group_key: string | null;
  created_at: number;
}

export async function loadHistory(db: SqlExecutor, episodeId: string): Promise<History> {
  const rows = await db.all<OpRow>(
    'SELECT id, seq, label, op, group_key, created_at FROM edit_ops WHERE episode_id = ? ORDER BY seq',
    [episodeId],
  );
  const cur = await db.get<{ undo_cursor: number }>(
    'SELECT undo_cursor FROM episodes WHERE id = ?',
    [episodeId],
  );
  const lastApplied = cur?.undo_cursor ?? 0;
  const ops: EditOp[] = rows.map((r) => {
    const body = JSON.parse(r.op) as { before: EditableDoc; after: EditableDoc };
    return {
      id: r.id,
      seq: r.seq,
      label: r.label,
      before: body.before,
      after: body.after,
      groupKey: r.group_key,
      createdAt: r.created_at,
    };
  });
  const cursor = ops.filter((o) => o.seq <= lastApplied).length;
  return { ops, cursor };
}

/** commit の結果を 1 トランザクションで永続化する（doc の書き戻しを含む）。 */
export async function persistCommit(
  db: SqlExecutor,
  episodeId: string,
  result: CommitResult,
  docAfter: EditableDoc,
  now: number,
): Promise<void> {
  if (!result.op) return;
  await db.transaction(() => writeCommit(db, episodeId, result, docAfter, now));
}

/**
 * commit の結果を書く。トランザクションは張らないので、呼び出し側のトランザクションの中で使う
 * （録音の確定と同じトランザクションで履歴に積むため。Issue #122）。
 */
export async function writeCommit(
  db: SqlExecutor,
  episodeId: string,
  result: CommitResult,
  docAfter: EditableDoc,
  now: number,
): Promise<void> {
  const { history, op, replacedSeq, droppedSeqs } = result;
  if (!op) return;
  for (const seq of droppedSeqs) {
    await db.run('DELETE FROM edit_ops WHERE episode_id = ? AND seq = ?', [episodeId, seq]);
  }
  if (replacedSeq !== null) {
    await db.run(
      'UPDATE edit_ops SET label = ?, op = ?, created_at = ? WHERE episode_id = ? AND seq = ?',
      [op.label, serialize(op), op.createdAt, episodeId, replacedSeq],
    );
  } else {
    await db.run(
      'INSERT INTO edit_ops (id, episode_id, seq, label, op, group_key, created_at) VALUES (?,?,?,?,?,?,?)',
      [op.id, episodeId, op.seq, op.label, serialize(op), op.groupKey, op.createdAt],
    );
  }
  // 上限で切り詰められた古い op を消す
  const minSeq = history.ops[0]?.seq ?? 0;
  await db.run('DELETE FROM edit_ops WHERE episode_id = ? AND seq < ?', [episodeId, minSeq]);
  await setCursor(db, episodeId, history, now);
  await saveDoc(db, episodeId, docAfter, now);
}

/**
 * 履歴を空にする。取り消しはエピソード画面を開いている間だけ効く（FR-EDIT-7、Issue #122）。
 * doc（声の並び・素材）には触れない。
 */
export async function clearHistory(db: SqlExecutor, episodeId: string, now: number): Promise<void> {
  await db.transaction(async () => {
    await db.run('DELETE FROM edit_ops WHERE episode_id = ?', [episodeId]);
    await db.run('UPDATE episodes SET undo_cursor = 0, updated_at = ? WHERE id = ?', [
      now,
      episodeId,
    ]);
  });
}

/** Undo / Redo 後の状態を永続化する。 */
export async function persistCursorAndDoc(
  db: SqlExecutor,
  episodeId: string,
  history: History,
  doc: EditableDoc,
  now: number,
): Promise<void> {
  await db.transaction(async () => {
    await setCursor(db, episodeId, history, now);
    await saveDoc(db, episodeId, doc, now);
  });
}

async function setCursor(db: SqlExecutor, episodeId: string, h: History, now: number) {
  const lastApplied = h.cursor > 0 ? h.ops[h.cursor - 1]!.seq : 0;
  await db.run('UPDATE episodes SET undo_cursor = ?, updated_at = ? WHERE id = ?', [
    lastApplied,
    now,
    episodeId,
  ]);
}

function serialize(op: EditOp): string {
  return JSON.stringify({ before: op.before, after: op.after });
}
