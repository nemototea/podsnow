import type { Smp } from '@/domain/time';
import type { Range } from '@/domain/timeline/types';

/**
 * 波形を押したときの選択（FR-EDIT-2、Issue #177）。再生位置は押すたびに押した位置へ移す（呼び出し側）。
 * - 1 回目のタップは位置を移すだけ。選択中なら外す
 * - 直前のタップと同じ塊をもう一度押すと、その塊を選ぶ
 * - 選択の中をもう一度押すと、選択を外す
 * - 長押しは、その塊をすぐ選ぶ
 *
 * @param last 直前のタップで押した塊（同じ塊への 2 回目かを見る）
 * @returns 新しい選択（null は選択なし）と、次の判定に使う「直前の塊」
 */
export function tapBlock(args: {
  at: Smp;
  blocks: readonly Range[];
  selection: Range | null;
  last: Range | null;
  longPress?: boolean;
}): { selection: Range | null; last: Range | null } {
  const { at, blocks, selection, last, longPress } = args;
  const block = blocks.find((b) => at >= b.start && at < b.end) ?? null;
  if (longPress) return { selection: block, last: block };
  if (selection && at >= selection.start && at < selection.end) {
    return { selection: null, last: null };
  }
  if (block && !selection && last && sameRange(block, last)) {
    return { selection: block, last: block };
  }
  return { selection: null, last: block };
}

function sameRange(a: Range, b: Range): boolean {
  return a.start === b.start && a.end === b.end;
}
