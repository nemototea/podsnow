/**
 * 見立ての部品（DESIGN_SYSTEM.md §2.6、§8）の計算。描画から切り離してテストする。
 */

/** カセットのテープの半径（px、原寸 358 幅のとき）。 */
export const PACK = { min: 13, max: 29 } as const;

/**
 * テープの半径。巻かれたテープの量（ハブを除いた面積）が割合に比例するので、
 * r² = min² + (max² − min²) × 割合。左右の量の和はいつも同じになる。
 */
export function packRadius(share: number): number {
  const f = Math.max(0, Math.min(1, share));
  return Math.sqrt(PACK.min * PACK.min + (PACK.max * PACK.max - PACK.min * PACK.min) * f);
}

/** レベルメーターの目盛り（dBFS）。基準が VU（0 VU = +4 dBu）ではないので文字盤に VU と書かない。 */
export const METER = {
  floorDb: -40,
  hotDb: -6,
  /** 針の振れ幅（度）。左端と右端。 */
  fromDeg: -48,
  spanDeg: 94,
  /** 上の方の目盛りを広げる曲がり。 */
  curve: 1.5,
  ticks: [-40, -30, -20, -12, -6, -3, 0],
} as const;

/** dBFS → 針の角度（度、真上が 0、左が負）。範囲外は端に止める。 */
export function meterAngle(db: number | null): number {
  if (db === null || !Number.isFinite(db)) return METER.fromDeg;
  const f = (Math.max(METER.floorDb, Math.min(0, db)) - METER.floorDb) / -METER.floorDb;
  return METER.fromDeg + METER.spanDeg * Math.pow(f, METER.curve);
}

/** 中心 (cx, cy)、半径 r の円周上で、角度 deg の点。 */
export function onArc(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}
