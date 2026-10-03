import { smp, type Smp } from '@/domain/time';

/** シークバー上の x（幅 `width`）を、長さ `max` の中の位置にする。端の外は端に止める。 */
export function seekTarget(x: number, width: number, max: Smp): Smp {
  if (width <= 0 || max <= 0) return smp(0);
  const ratio = Math.max(0, Math.min(1, x / width));
  return smp(Math.round(ratio * max));
}

/** 再生位置の割合（0〜1）。長さが分からないときは 0。 */
export function progressRatio(position: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(1, position / duration));
}

/**
 * シークを離したあと、実際の位置が離した位置に追いついたか（Issue #188）。追いつくまでは
 * つまみを離した位置に留める。手前 1 秒から、留める上限（`player.seekSettleMs`）の間に
 * 再生で進む分（2 秒）までを「追いついた」とみなす。
 */
export function seekSettled(position: number, target: number): boolean {
  return position >= target - 48000 && position <= target + 2 * 48000;
}
