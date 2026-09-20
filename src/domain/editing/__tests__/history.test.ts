import { smp, ZERO_SMP } from '../../time';
import type { VoiceSegment } from '../../timeline/types';
import { EMPTY_DOC, type EditableDoc } from '../doc';
import {
  canRedo,
  canUndo,
  commit,
  currentDoc,
  EMPTY_HISTORY,
  redo,
  undo,
  type History,
} from '../history';

const seg = (id: string, a: number, b: number): VoiceSegment => ({
  id,
  takeId: 'T',
  srcStart: smp(a),
  srcEnd: smp(b),
  gainDb: 0,
  fadeIn: ZERO_SMP,
  fadeOut: ZERO_SMP,
});
const d0: EditableDoc = { ...EMPTY_DOC, voice: [seg('a', 0, 100)] };
const d1: EditableDoc = { ...EMPTY_DOC, voice: [seg('a', 0, 50)] };
const d2: EditableDoc = { ...EMPTY_DOC, voice: [seg('a', 0, 25)] };

const c = (
  h: History,
  before: EditableDoc,
  after: EditableDoc,
  id: string,
  now: number,
  groupKey?: string,
) => commit(h, before, after, { id, label: id, now, groupKey: groupKey ?? null });

describe('history', () => {
  it('commit / undo / redo move the cursor and return the right doc', () => {
    let r = c(EMPTY_HISTORY, d0, d1, 'op1', 1000);
    expect(r.op?.seq).toBe(1);
    r = c(r.history, d1, d2, 'op2', 2000);
    expect(r.history.cursor).toBe(2);
    expect(currentDoc(r.history)).toEqual(d2);

    const u1 = undo(r.history)!;
    expect(u1.doc).toEqual(d1);
    expect(u1.op.label).toBe('op2');
    const u2 = undo(u1.history)!;
    expect(u2.doc).toEqual(d0);
    expect(canUndo(u2.history)).toBe(false);
    expect(undo(u2.history)).toBeNull();

    const rd = redo(u2.history)!;
    expect(rd.doc).toEqual(d1);
    expect(canRedo(rd.history)).toBe(true);
  });

  it('a new commit after undo drops the redo branch and reports dropped seqs', () => {
    let r = c(EMPTY_HISTORY, d0, d1, 'op1', 1000);
    r = c(r.history, d1, d2, 'op2', 2000);
    const u = undo(r.history)!;
    const n = c(u.history, d1, d0, 'op3', 3000);
    expect(n.droppedSeqs).toEqual([2]);
    expect(n.history.ops.map((o) => o.seq)).toEqual([1, 2]);
    expect(n.op?.seq).toBe(2);
    expect(canRedo(n.history)).toBe(false);
  });

  it('coalesces consecutive commits with the same groupKey inside the window', () => {
    let r = c(EMPTY_HISTORY, d0, d1, 'g1', 1000, 'gain:a');
    r = c(r.history, d1, d2, 'g2', 1500, 'gain:a');
    expect(r.replacedSeq).toBe(1);
    expect(r.history.ops).toHaveLength(1);
    expect(r.history.ops[0]!.before).toEqual(d0);
    expect(r.history.ops[0]!.after).toEqual(d2);
    // 時間が空けば別操作
    r = c(r.history, d2, d0, 'g3', 9000, 'gain:a');
    expect(r.history.ops).toHaveLength(2);
  });

  it('ignores no-op commits', () => {
    const r = c(EMPTY_HISTORY, d0, d0, 'noop', 1);
    expect(r.op).toBeNull();
    expect(r.history).toBe(EMPTY_HISTORY);
  });

  it('caps the history length', () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < 250; i++) {
      const before = { ...EMPTY_DOC, voice: [seg('a', 0, 1000 - i)] };
      const after = { ...EMPTY_DOC, voice: [seg('a', 0, 999 - i)] };
      h = commit(h, before, after, { id: `op${i}`, label: 'x', now: i, maxOps: 200 }).history;
    }
    expect(h.ops).toHaveLength(200);
    expect(h.cursor).toBe(200);
    expect(h.ops[0]!.seq).toBe(51);
  });

  it('snapshots are independent of later mutation', () => {
    const before: EditableDoc = { ...EMPTY_DOC, voice: [seg('a', 0, 100)] };
    const after: EditableDoc = { ...EMPTY_DOC, voice: [seg('a', 0, 50)] };
    const r = c(EMPTY_HISTORY, before, after, 'op', 1);
    (after.voice[0] as VoiceSegment).srcEnd = smp(1);
    expect(r.history.ops[0]!.after.voice[0]!.srcEnd).toBe(50);
  });
});
