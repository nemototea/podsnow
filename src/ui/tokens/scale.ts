// 寸法・書体・動きのトークン（DESIGN_SYSTEM.md §3-§5）。
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
} as const;

/** 画面の左右余白。操作と文字はこの内側に入れる（better-layout: 面は端まで、操作は内側）。 */
export const gutter = space.lg;

/**
 * 角丸。
 *
 * 入れ子にするときは **外側 = 内側 + 余白**（better-ui: concentric border radius）。
 * `concentric()` で計算する。目分量で合わせない。
 */
export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 24,
  pill: 999,
} as const;

/** 余白 `pad` の内側に置く要素の角丸。外側 `outer` と同心になる。 */
export function concentric(outer: number, pad: number): number {
  return Math.max(0, outer - pad);
}

/**
 * 役割ごとの書体。大きさ・行間・太さをひとまとめにして、役割の選択ひとつで決まるようにする。
 *
 * - 18px 未満で太さ 300 以下は使わない（細い字は本文サイズだと消える）。
 * - 3 行以上に折り返しうる文字の行間は 1.4 以上。
 * - 日本語は英字より字面が大きいので、行間は英語の目安より気持ち広く取る。
 */
export const typography = {
  /** 画面の主役。数字の大きな表示（録音時間など）。 */
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  /** 画面タイトル。 */
  title: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  /** セクション見出し。 */
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '700' },
  /** 本文。行の一覧、説明文。 */
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  /** 本文の強調。大きさは変えず太さだけ一段上げる。 */
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  /** ボタン・チップのラベル。 */
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  /** 補足。行の下に付く説明、空状態の文。 */
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '400' },
  /** 見出しの上に置く小見出し。字間を広げる。 */
  overline: { fontSize: 11, lineHeight: 15, fontWeight: '600', letterSpacing: 1.2 },
} as const;

export type TypeRole = keyof typeof typography;

/**
 * 変わり続ける数値（タイムコード、カウンタ、残り時間）に付ける。
 * 等幅数字にしないと、桁が変わるたびに右の要素が揺れる（better-typography）。
 */
export const tabularNums = { fontVariant: ['tabular-nums' as const] };

/**
 * 字形アイコン（`⋮` `▶` `＋`）の大きさ。
 *
 * 書体の役割とは別の尺度にする。アイコンは行の中の文字ではなく、押せる的だから。
 * 隣の文字と並ぶときは、文字の太さに合わせて `md` を基準にする（better-ui）。
 */
export const icon = {
  sm: 18,
  md: 22,
  lg: 28,
} as const;

/**
 * 触れる面の大きさ。
 *
 * WCAG 2.5.8 (AA) の下限は 24x24、Apple HIG の推奨は 44x44。
 * 見た目が小さくてよくても、触れる面は `min` まで広げる。
 * 出典: https://www.w3.org/TR/WCAG22/#target-size-minimum
 */
export const hit = {
  /** 主要な操作。これを下回らない。 */
  min: 44,
  /** 一覧の行など、間隔が十分に取れている密な場所。 */
  compact: 36,
} as const;

/** 見た目の大きさ `size` の要素を `hit.min` まで広げるための hitSlop。 */
export function hitSlop(size: number): number {
  return Math.max(0, Math.round((hit.min - size) / 2));
}

/**
 * 文字ひとつ（`⋮` `★` `✕` など）を押させるときの hitSlop。
 *
 * 字面の箱をおおよそ 20px と見て `hit.min` まで広げる。個別に 6 / 8 / 10 と
 * 散らすと、どれも 44 に届かないまま揃いもしない。
 */
export const glyphSlop = hitSlop(20);

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

/** 押せるものを押したときの不透明度。 */
export const pressOpacity = 0.75;

/** 無効状態の不透明度。 */
export const disabledOpacity = 0.4;
