import { smp, type Smp } from '../time';
import type { Range } from './types';

/**
 * 声の塊（発話ブロック）の検出（FR-EDIT-2、docs/ux-restructure.md §6.1）。
 *
 * 編集の最小単位を「無音で区切られた声の塊」にする。ユーザーは範囲を作るのではなく、
 * 目の前にある塊をタップして選ぶ。判定は波形のピーク（表示に使っているのと同じ値）から
 * 導くので、見えているものと選べるものがずれない。
 *
 * DB には持たない。しきい値を変えれば分割も変わる。
 */
export interface BlockOptions {
  /** これより静かなら無音とみなす（dBFS）。設定の無音しきい値と同じ値を使う。 */
  thresholdDb: number;
  /** これ以上続いた静かな区間だけを区切りとみなす。短い息継ぎで切らないため。 */
  minSilenceSmp: Smp;
}

/**
 * 振幅の列から塊を求める。
 * `levels` は 0..1 の振幅（各要素が `stepSmp` 分の区間の最大値）。
 */
export function detectBlocks(
  levels: readonly number[],
  stepSmp: number,
  total: Smp,
  opts: BlockOptions,
): Range[] {
  if (!levels.length || stepSmp <= 0 || total <= 0) return [];
  const threshold = Math.pow(10, opts.thresholdDb / 20);
  const minSilenceSteps = Math.max(1, Math.round(opts.minSilenceSmp / stepSmp));

  const out: Range[] = [];
  let start: number | null = null;
  let quiet = 0;
  for (let i = 0; i < levels.length; i++) {
    const loud = (levels[i] ?? 0) > threshold;
    if (loud) {
      if (start === null) start = i;
      quiet = 0;
      continue;
    }
    quiet++;
    // 十分に長く静かになったら、そこで塊を閉じる
    if (start !== null && quiet >= minSilenceSteps) {
      out.push(range(start, i - quiet + 1, stepSmp, total));
      start = null;
    }
  }
  if (start !== null) out.push(range(start, levels.length, stepSmp, total));
  return out.filter((r) => r.end > r.start);
}

/** `at` を含む塊。無ければ null。 */
export function blockAt(blocks: readonly Range[], at: Smp): Range | null {
  return blocks.find((b) => at >= b.start && at < b.end) ?? null;
}

/**
 * `at` にいちばん近い塊の境界。スナップ幅（`withinSmp`）の外なら `at` のまま。
 * ハンドルのドラッグで、隣の塊の切れ目に吸い付かせるのに使う。
 */
export function snapToBoundary(blocks: readonly Range[], at: Smp, withinSmp: number): Smp {
  let best = at;
  let bestDist = withinSmp;
  for (const b of blocks) {
    for (const edge of [b.start, b.end]) {
      const d = Math.abs(edge - at);
      if (d <= bestDist) {
        bestDist = d;
        best = edge;
      }
    }
  }
  return best;
}

function range(fromIndex: number, toIndex: number, stepSmp: number, total: Smp): Range {
  return {
    start: smp(Math.max(0, Math.min(total, fromIndex * stepSmp))),
    end: smp(Math.max(0, Math.min(total, toIndex * stepSmp))),
  };
}
