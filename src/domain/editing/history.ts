import { cloneDoc, docEquals, type EditableDoc } from './doc';

/**
 * 1 つの編集操作。before / after は EditableDoc のスナップショット。
 * Undo = before を適用、Redo = after を適用。
 * スナップショット方式にする理由: 逆操作の実装ミスで録音データの参照が壊れるリスクを避ける
 * （エピソードのセグメント数は高々数百で、JSON にしても小さい）。
 */
export interface EditOp {
  id: string;
  seq: number;
  label: string;
  before: EditableDoc;
  after: EditableDoc;
  /** 連続操作（スライダー等）のまとめキー。 */
  groupKey: string | null;
  createdAt: number;
}

export interface History {
  /** seq 昇順。 */
  ops: readonly EditOp[];
  /** 適用済み操作の数（= 次に Undo される op のインデックス + 1）。 */
  cursor: number;
}

export const EMPTY_HISTORY: History = { ops: [], cursor: 0 };

export interface CommitOptions {
  id: string;
  label: string;
  groupKey?: string | null;
  /** groupKey が同じ直前操作と、この時間内なら 1 つにまとめる。 */
  groupWindowMs?: number;
  now: number;
  /** 履歴の上限。超えた分は古いものから捨てる。 */
  maxOps?: number;
}

export const DEFAULT_GROUP_WINDOW_MS = 1500;
export const DEFAULT_MAX_OPS = 200;

export interface CommitResult {
  history: History;
  /** 新規に追加された、またはまとめ直された op。変更なしなら null。 */
  op: EditOp | null;
  /** まとめ直しで置き換えられた既存 op の seq（無ければ null）。 */
  replacedSeq: number | null;
  /** 新規操作により破棄された Redo 側の op の seq。 */
  droppedSeqs: number[];
}

export function canUndo(h: History): boolean {
  return h.cursor > 0;
}
export function canRedo(h: History): boolean {
  return h.cursor < h.ops.length;
}

/** 現在の doc を返す（履歴が空なら null）。 */
export function currentDoc(h: History): EditableDoc | null {
  if (h.cursor === 0) return h.ops[0]?.before ?? null;
  return h.ops[h.cursor - 1]!.after;
}

export function commit(
  h: History,
  before: EditableDoc,
  after: EditableDoc,
  o: CommitOptions,
): CommitResult {
  if (docEquals(before, after)) {
    return { history: h, op: null, replacedSeq: null, droppedSeqs: [] };
  }
  const applied = h.ops.slice(0, h.cursor);
  const droppedSeqs = h.ops.slice(h.cursor).map((x) => x.seq);
  const last = applied[applied.length - 1];
  const window = o.groupWindowMs ?? DEFAULT_GROUP_WINDOW_MS;
  const groupKey = o.groupKey ?? null;

  if (last && groupKey && last.groupKey === groupKey && o.now - last.createdAt <= window) {
    // まとめ直し: before は最初の操作のまま、after だけ更新
    const merged: EditOp = { ...last, label: o.label, after: cloneDoc(after), createdAt: o.now };
    const ops = [...applied.slice(0, -1), merged];
    return {
      history: { ops, cursor: ops.length },
      op: merged,
      replacedSeq: last.seq,
      droppedSeqs,
    };
  }

  const seq = (last?.seq ?? 0) + 1;
  const op: EditOp = {
    id: o.id,
    seq,
    label: o.label,
    before: cloneDoc(before),
    after: cloneDoc(after),
    groupKey,
    createdAt: o.now,
  };
  let ops = [...applied, op];
  const max = o.maxOps ?? DEFAULT_MAX_OPS;
  if (ops.length > max) ops = ops.slice(ops.length - max);
  return { history: { ops, cursor: ops.length }, op, replacedSeq: null, droppedSeqs };
}

export function undo(h: History): { history: History; op: EditOp; doc: EditableDoc } | null {
  if (!canUndo(h)) return null;
  const op = h.ops[h.cursor - 1]!;
  return { history: { ops: h.ops, cursor: h.cursor - 1 }, op, doc: cloneDoc(op.before) };
}

export function redo(h: History): { history: History; op: EditOp; doc: EditableDoc } | null {
  if (!canRedo(h)) return null;
  const op = h.ops[h.cursor]!;
  return { history: { ops: h.ops, cursor: h.cursor + 1 }, op, doc: cloneDoc(op.after) };
}
