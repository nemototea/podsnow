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

/** カンペの付箋（DESIGN_SYSTEM.md §2.7）。番号の付箋か、外れた分をまとめた「＋数」の付箋。 */
export type IndexTab =
  | { kind: 'topic'; index: number }
  | { kind: 'before'; from: number; count: number }
  | { kind: 'after'; from: number; count: number };

/** 付箋の枠の数。ページの高さに、押せる大きさを保って並べられる上限。 */
export const INDEX_SLOTS = 7;

/**
 * 付箋の並びを決める（DESIGN_SYSTEM.md §2.7）。
 *
 * - 話題が枠の数以下なら全部を番号で出す。
 * - 多いときは今の話題が上から 3 番目に来る範囲を番号で出し、外れた分を前後の「＋数」1 枚にまとめる。
 * - 「＋1」は作らない（1 本ならその付箋を出すのと同じ場所を取る）。終わりに近づいたら範囲を下端で止める。
 *
 * `current` は今の話題の添字。話し始める前は null（先頭から並べる）。
 */
export function indexTabs(total: number, current: number | null, slots = INDEX_SLOTS): IndexTab[] {
  const topics = (from: number, to: number): IndexTab[] =>
    Array.from({ length: Math.max(0, to - from) }, (_, i) => ({ kind: 'topic', index: from + i }));
  if (total <= slots) return topics(0, total);
  const anchor = current ?? 0;
  const start = Math.max(0, anchor - 2);
  // 前にまとめる話題が 1 本以下なら、前の「＋」は作らず先頭から並べる
  if (start <= 1) {
    const shown = slots - 1;
    return [...topics(0, shown), { kind: 'after', from: shown, count: total - shown }];
  }
  const width = slots - 2;
  // 後ろにまとめる話題が 1 本以下なら、後ろの「＋」は作らず下端で止める
  if (start + width >= total - 1) {
    const from = total - (slots - 1);
    return [{ kind: 'before', from: 0, count: from }, ...topics(from, total)];
  }
  return [
    { kind: 'before', from: 0, count: start },
    ...topics(start, start + width),
    { kind: 'after', from: start + width, count: total - start - width },
  ];
}
