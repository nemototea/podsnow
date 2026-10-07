// 横に並ぶ棒のレベル（見本 `.meter`、DESIGN_SYSTEM.md §6、Issue #235）。副作用を持たない。
//
// 見本は 24 本の棒を左から点け、添字 19（20 本目）から先を琥珀にする（見本の `i >= 19`）。
// 目盛りは dBFS の -40〜0 を 24 本に等分する。録音していない（値が無い）ときは 1 本も点けない。

/** 棒の本数（見本 `.meter` の 24）。 */
export const LEVEL_BARS = 24;
/** 琥珀にする最初の棒の添字（見本 `i >= 19`）。 */
export const LEVEL_HOT_FROM = 19;
/** 左端と右端の dBFS。 */
export const LEVEL_FLOOR_DB = -40;
export const LEVEL_CEIL_DB = 0;

/** dBFS を点ける棒の数（0〜24）にする。値が無ければ 0。 */
export function litBars(db: number | null): number {
  if (db === null || !Number.isFinite(db)) return 0;
  const t = (db - LEVEL_FLOOR_DB) / (LEVEL_CEIL_DB - LEVEL_FLOOR_DB);
  return Math.max(0, Math.min(LEVEL_BARS, Math.round(t * LEVEL_BARS)));
}

/** 添字 `i` の棒の状態。 */
export function barState(i: number, lit: number): 'off' | 'on' | 'hot' {
  if (i >= lit) return 'off';
  return i >= LEVEL_HOT_FROM ? 'hot' : 'on';
}
