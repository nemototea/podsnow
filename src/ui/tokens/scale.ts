// 寸法・書体・動きのトークン（DESIGN_SYSTEM.md §4, §6）。
//
// 画面に生の数値（`fontSize: 13`、`padding: 10`、`borderRadius: 14`）を書かない。
// 0.1.0 の途中まではそうなっていて、文字サイズが 14 種類、余白が 14 種類、
// 角丸が 16 種類に増えていた。どれも意図ではなく、その場の目分量だった。

/**
 * 余白。4 の倍数。
 *
 * **グループの外側は内側の 2 倍以上あける**（better-layout）。内側が `sm` なら
 * 外側は `lg` 以上。ここが崩れると、まとまりが線ではなく騒がしさに見える。
 */
export const space = {
  hair: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  section: 48,
} as const;

export const gutter = 20;
export const gutterCompact = space.lg;
export const compactWidth = 360;
/** ダイアログの最大幅（DESIGN_SYSTEM.md §6.3）。狭い画面では左右に `gutter` を残して縮む。 */
export const dialogWidth = 400;

/** 角丸。部品ごとの値は DESIGN_SYSTEM.md §6 で決める。 */
export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** 余白 `pad` だけ内側に密着して重なる要素（セグメント、トーストの押下面など）の角丸。 */
export function concentric(outer: number, pad: number): number {
  return Math.max(0, outer - pad);
}

export const family = {
  latin: 'Manrope',
  ja: 'Noto Sans JP',
  numeric: 'Manrope',
} as const;

export type FamilyRole = 'ui' | 'numeric';

/** 数字だけ幅を揃える。本文全体を等幅書体にはしない。 */
export const tabularNums = { fontVariant: ['tabular-nums' as const] };

/**
 * 役割ごとの書体。大きさ・行間・太さをひとまとめにして、役割の選択ひとつで決まるようにする。
 *
 * - 18px 未満で太さ 300 以下は使わない（細い字は本文サイズだと消える）。
 * - 3 行以上に折り返しうる文字の行間は 1.4 以上。
 * - 11px は波形の目盛りだけ（`tick`）。説明やボタンに使わない。
 */
export const typography = {
  /** 収録中の時間。幅 320 では `timerCompact`。 */
  timer: {
    fontSize: 48,
    lineHeight: 58,
    fontWeight: '500',
    fontFamily: family.numeric,
    ...tabularNums,
  },
  timerCompact: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '500',
    fontFamily: family.numeric,
    ...tabularNums,
  },
  clock: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '500',
    fontFamily: family.numeric,
    ...tabularNums,
  },
  clockCompact: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '500',
    fontFamily: family.numeric,
    ...tabularNums,
  },
  /** 番組名、短い主要見出し。 */
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
  /** 画面タイトル。 */
  title: { fontSize: 24, lineHeight: 34, fontWeight: '700' },
  /** セクション見出し。 */
  heading: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  /** 本文。説明、トークテーマ。 */
  body: { fontSize: 16, lineHeight: 26, fontWeight: '400' },
  /** 本文の強調。大きさは変えず太さだけ一段上げる。 */
  bodyStrong: { fontSize: 16, lineHeight: 26, fontWeight: '600' },
  /** ボタン・設定項目。 */
  label: { fontSize: 14, lineHeight: 21, fontWeight: '600' },
  /** 日時、補助情報。 */
  caption: { fontSize: 13, lineHeight: 20, fontWeight: '500' },
  /** 小見出し、分類。 */
  overline: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  numeric: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    fontFamily: family.numeric,
    ...tabularNums,
  },
  tick: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    fontFamily: family.numeric,
    ...tabularNums,
  },
} as const;

export type TypeRole = keyof typeof typography;

/** アイコンの大きさ。24 を基準に線幅 2 で描く（`src/ui/Icon.tsx`）。 */
export const icon = {
  sm: 18,
  md: 24,
  lg: 28,
} as const;

/**
 * 触れる面の大きさ（DESIGN_SYSTEM.md §6、§10.1）。
 *
 * 48 は製品独自のタッチ目標。WCAG 2.5.8 (AA) の下限 24x24 とは別物。
 * 出典: https://www.w3.org/TR/WCAG22/#target-size-minimum
 */
export const hit = {
  /** すべての操作。これを下回らない。 */
  min: 48,
  button: 52,
  record: 72,
  secondary: 56,
} as const;

/** 見た目の大きさ `size` の要素を `hit.min` まで広げるための hitSlop。 */
export function hitSlop(size: number): number {
  return Math.max(0, Math.round((hit.min - size) / 2));
}

/** アイコンひとつを押させるときの hitSlop。 */
export const glyphSlop = hitSlop(icon.md);

export const stroke = {
  hairline: 1,
  selected: 2,
  focus: 3,
} as const;

/**
 * 動き。
 *
 * 頻繁に起きる操作の反応は 150ms 以下（better-ui）。
 * 動きだけで状態を伝えない。色・文字・アイコンのどれかを必ず併せる。
 */
export const motion = {
  /** 押した・離したの反応。 */
  instant: 120,
  /** トーストの出入り、要素の退避。 */
  quick: 160,
  /** シートなど面の大きい要素。 */
  moderate: 240,
} as const;

/** 押し込みの縮小率（better-ui: 0.95 より小さいと大げさに見える）。 */
export const pressScale = 0.96;

/** Button の硬い影と押し込み。配置は動かさず描画だけを移動する。 */
export const buttonDepth = { offsetX: 2, offsetY: 3, travel: 2, pressedOffsetY: 1 } as const;
