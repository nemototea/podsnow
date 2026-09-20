import { smp, type Smp } from '../time';
import type { Range } from './types';
import { mergeRanges } from './voice';

export interface SilencePlanOptions {
  /** 無音区間の前後に残す余白。 */
  padSmp: Smp;
  /** 余白を引いた後、これより短い削除は行わない。 */
  minRemoveSmp: Smp;
}

/**
 * 無音検出結果（声トラック座標）から削除範囲を作る。
 * 各区間の両端を padSmp だけ縮め、短すぎるものは捨てる。
 */
export function planSilenceRemoval(silences: readonly Range[], opts: SilencePlanOptions): Range[] {
  const out: Range[] = [];
  for (const r of mergeRanges(silences)) {
    const start = smp(r.start + opts.padSmp);
    const end = smp(r.end - opts.padSmp);
    if (end - start >= opts.minRemoveSmp && end > start) out.push({ start, end });
  }
  return out;
}

export function totalRemoved(ranges: readonly Range[]): Smp {
  return smp(ranges.reduce((acc, r) => acc + (r.end - r.start), 0));
}
