/**
 * 素材の帯を動かすときの計算（Issue #254）。画面に依存しない部分だけを置き、Jest で試す。
 * px は波形の中身の座標。時間は本編の始まりを 0 としたサンプル数。
 */

/** 吸い付く距離（px）。 */
export const SNAP_PX = 12;

/** いちばん近い吸い付く位置。`SNAP_PX` より遠ければそのまま返す。UI スレッドからも呼ぶ。 */
export function snapPx(x: number, snaps: readonly number[]): number {
  'worklet';
  let best = x;
  let dist = SNAP_PX;
  for (let i = 0; i < snaps.length; i++) {
    const d = Math.abs(snaps[i]! - x);
    if (d < dist) {
      dist = d;
      best = snaps[i]!;
    }
  }
  return best;
}

/** 動かした px をサンプル数に直す。 */
export function pxToSmp(px: number, pps: number, sampleRate = 48000): number {
  return Math.round((px / pps) * sampleRate);
}

/** フェードの長さ（px）をサンプル数に直す。0.1 秒に丸める。 */
export function fadePxToSmp(px: number, pps: number, sampleRate = 48000): number {
  const tenth = sampleRate / 10;
  return Math.max(0, Math.round(pxToSmp(px, pps, sampleRate) / tenth) * tenth);
}
