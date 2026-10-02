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

/** 番組アートワーク（Issue #133）。 */
export const artwork = {
  settingsPreview: 128,
  player: 184,
  miniPlayer: 44,
  /** Home のレコードジャケットの一辺の上限（#190）。狭い画面では盤まで収まる大きさに縮む。 */
  homeJacket: 240,
} as const;

/** 音声プレーヤー（Issue #135）。 */
export const player = {
  seekTrack: 10,
  seekThumb: 22,
  miniBottom: space.sm,
} as const;

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
  /** 番組名・看板の語（DESIGN_SYSTEM.md §4、#190）。和文も持つので日英で同じ書体。 */
  display: 'Dela Gothic One',
} as const;

export type FamilyRole = 'ui' | 'numeric' | 'display';

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
  /** 収録中の時間。幅 320 では `timerCompact`。版ズレに負けないよう太くする（#190）。 */
  timer: {
    fontSize: 48,
    lineHeight: 58,
    fontWeight: '700',
    fontFamily: family.numeric,
    ...tabularNums,
  },
  timerCompact: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '700',
    fontFamily: family.numeric,
    ...tabularNums,
  },
  clock: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
    fontFamily: family.numeric,
    ...tabularNums,
  },
  clockCompact: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    fontFamily: family.numeric,
    ...tabularNums,
  },
  /** 番組名、短い主要見出し。Dela Gothic One は 1 ウェイトだけなので 400。 */
  display: { fontSize: 32, lineHeight: 40, fontWeight: '400', fontFamily: family.display },
  /** 看板の語（ON AIR、CUE）とステッカーの文字（DESIGN_SYSTEM.md §2.4）。 */
  sign: { fontSize: 20, lineHeight: 24, fontWeight: '400', fontFamily: family.display },
  /** 画面タイトル。 */
  title: { fontSize: 24, lineHeight: 34, fontWeight: '700' },
  /** セクション見出し。 */
  heading: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  /** 本文。説明、トークテーマ。 */
  body: { fontSize: 16, lineHeight: 26, fontWeight: '400' },
  /** 本文の強調。大きさは変えず太さだけ一段上げる。 */
  bodyStrong: { fontSize: 16, lineHeight: 26, fontWeight: '600' },
  /** ボタン・設定項目。 */
  label: { fontSize: 14, lineHeight: 21, fontWeight: '700' },
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
  /** 収録の丸ボタン。再生系と録音系で同じ大きさ（#128）。 */
  record: 72,
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
 * 入力欄（`Field`）の寸法（DESIGN_SYSTEM.md §6、#131）。
 *
 * OS の標準に寄せる。Material 3 の Outlined TextField は通常 1dp・入力中 2dp の枠、
 * iOS は操作部品の既定が 44pt。常に 2 の枠と角丸 12・高さ 52 は、並べると一段大きく見えた。
 * 高さは `hit.min` を下回らない。枠が太くなった分は余白から引き、字の位置を動かさない（`fieldPadding()`）。
 */
export const field = {
  minHeight: hit.min,
  multilineMinHeight: 128,
  radius: radius.sm,
  paddingX: space.lg,
  paddingY: space.sm,
  /** 通常時の枠。 */
  border: stroke.hairline,
  /** 入力中・エラー時の枠。 */
  borderActive: stroke.selected,
} as const;

/** 枠の太さ `borderWidth` のときの内側の余白。枠と余白の和を一定に保つ。 */
export function fieldPadding(borderWidth: number) {
  const shift = borderWidth - field.border;
  return {
    paddingHorizontal: field.paddingX - shift,
    paddingVertical: field.paddingY - shift,
  };
}

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

/**
 * 押せる物の硬い影と押し込み（DESIGN_SYSTEM.md §6、#190）。右下へずらしたぼかさない影で、
 * 押すと影の分だけ沈む。小は副操作・ステッカー、大は主操作と録音の丸。配置は動かさず描画だけを移動する。
 */
export const buttonDepth = {
  offset: 3,
  offsetLarge: 5,
  travel: 2,
  travelLarge: 4,
  pressedOffset: 1,
} as const;

/**
 * ステッカーの傾き（度、DESIGN_SYSTEM.md §2.5）。項目ごとに固定し、押しても変えない。
 * 一覧では添字で順に使う（`stickerTilt(i)`）。
 */
export const sticker = { tilts: [-4, 3, -2, 4, -3, 6], lamp: -4 } as const;

/** 版ズレ（DESIGN_SYSTEM.md §2.5）。大きな数字の右下にずらす影。 */
export const misreg = { x: 3, y: 2 } as const;

/** 網点（DESIGN_SYSTEM.md §2.5）。面の飾りだけに使い、文字の下に置かない。 */
export const halftone = { pitch: 7, dot: 1.3 } as const;

/** 再生の見立て（§2.6）。リールとレコード盤が 1 回転する時間（ms）。 */
export const spin = { reel: 2400, disc: 3200 } as const;

export function stickerTilt(i: number): number {
  return sticker.tilts[((i % sticker.tilts.length) + sticker.tilts.length) % sticker.tilts.length]!;
}
