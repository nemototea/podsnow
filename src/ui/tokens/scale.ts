// 寸法・書体・動きのトークン（DESIGN_SYSTEM.md §4, §6）。
//
// 画面に生の数値（`fontSize: 13`、`padding: 10`、`borderRadius: 14`）を書かない。
// 0.1.0 の途中まではそうなっていて、文字サイズが 14 種類、余白が 14 種類、
// 角丸が 16 種類に増えていた。どれも意図ではなく、その場の目分量だった。

/**
 * 余白。4 の倍数を基本に、見本 docs/design-refresh/ds4/mock.html が使う 6・10・14・20・22 を足す
 * （DESIGN_SYSTEM.md §6、Issue #235）。`x6` のように値を名前にしたものが見本だけの値。
 *
 * **グループの外側は内側の 2 倍以上あける**（better-layout）。内側が `sm` なら
 * 外側は `lg` 以上。ここが崩れると、まとまりが線ではなく騒がしさに見える。
 */
export const space = {
  hair: 2,
  xs: 4,
  x6: 6,
  sm: 8,
  x10: 10,
  md: 12,
  x14: 14,
  lg: 16,
  x20: 20,
  x22: 22,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  section: 48,
} as const;

/** 左右の余白（見本 `.home` / `.ex` / `.eplist` の 16）。 */
export const gutter = space.lg;
export const gutterCompact = space.lg;
/** 収録画面の左右の余白（見本 `.np` の 20）。 */
export const gutterNowPlaying = space.x20;
export const compactWidth = 360;
/** ダイアログの最大幅（DESIGN_SYSTEM.md §6.3）。狭い画面では左右に `gutter` を残して縮む。 */
export const dialogWidth = 400;

/** ロゴ `PodsNow.` の字の大きさ（DESIGN_SYSTEM.md §3、見本 `.wm`）。 */
export const wordmarkSize = { home: 24 } as const;

/** 番組アートワーク（Issue #133 / #235。見本の大きさ）。 */
export const artwork = {
  settingsPreview: 128,
  player: 184,
  /** プレーヤー画面のアートワークの一辺の上限（Issue #188）。狭い画面では幅に合わせて縮む。 */
  playerSheet: 280,
  /** ミニプレーヤー（見本 `.mini .art`）。 */
  miniPlayer: 38,
  /** 一覧の行と続きからのタイル（見本 `.ep .art`、`.quick .art`）。 */
  row: 52,
  /** 書き出しタブの上（見本 `.exhero .art`）。 */
  exportHero: 84,
  /** Home の番組カード（見本 `.showcard .art`）。 */
  showCard: 128,
  /** 番組画面の上部（見本 `.showhead .art`）。 */
  showHeader: 196,
  /** Home のレコードジャケットの一辺の上限（#190）。狭い画面では盤まで収まる大きさに縮む。 */
  homeJacket: 240,
} as const;

/** 音声プレーヤー（Issue #135）。 */
export const player = {
  /** シークバーの太さとつまみ（見本に無い。ミニプレーヤーの進み具合と同じ作法で細く）。 */
  seekTrack: space.xs,
  seekThumb: space.md,
  miniBottom: space.sm,
  /** 再生・一時停止の丸（Issue #171 D5、#188）。前後のボタンより大きくし、主操作と分かるようにする。 */
  playButton: 72,
  /** ミニプレーヤーの進み具合のバーの太さ（見本 `.mini .bar` の 2）。 */
  miniProgress: space.hair,
  /** シークを離したあと、実際の位置が追いつくまでつまみを離した位置に留める上限（ms）。 */
  seekSettleMs: 1500,
} as const;

/** 角丸。部品ごとの値は DESIGN_SYSTEM.md §6（見本の値）で決める。 */
export const radius = {
  /** アートワーク、塊、状態の札、素材のレーン。 */
  xs: 4,
  /** カード、ミニプレーヤー、通知、波形パネル。 */
  sm: 8,
  /** トークテーマのカード（見本 `.topic`）。 */
  x10: 10,
  md: 12,
  /** シートの上辺（見本 `.sheet`）。 */
  x14: 14,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** 余白 `pad` だけ内側に密着して重なる要素（セグメント、トーストの押下面など）の角丸。 */
export function concentric(outer: number, pad: number): number {
  return Math.max(0, outer - pad);
}

/**
 * 書体（DESIGN_SYSTEM.md §4、Issue #235）。欧文 UI・数字・見出しは Figtree、和文は Noto Sans JP。
 * 見出しの極太（800 / 900）は欧文だけにある。和文は同梱した 700 までで、それより太い指定は
 * いちばん近い 700 になる【仮説: 実機で確かめる（DS-1）】。
 */
export const family = {
  latin: 'Figtree',
  ja: 'Noto Sans JP',
  numeric: 'Figtree',
} as const;

export type FamilyRole = 'ui' | 'numeric';

/** 数字だけ幅を揃える。本文全体を等幅書体にはしない。 */
export const tabularNums = { fontVariant: ['tabular-nums' as const] };

/**
 * 役割ごとの書体。大きさ・行間・太さ・字間をひとまとめにして、役割の選択ひとつで決まるようにする。
 * 値は見本 docs/design-refresh/ds4/mock.html の CSS（DESIGN_SYSTEM.md §4.2 の表）。字間は em を px に直した値。
 *
 * - 18px 未満で太さ 300 以下は使わない（細い字は本文サイズだと消える）。
 * - 3 行以上に折り返しうる文字の行間は 1.4 以上。
 * - 10–11px は図の中の短い名札と目盛りだけ（`micro` / `meta` / `tick`）。説明やボタンに使わない。
 */
export const typography = {
  /** 収録中の時間（見本 `.clock b`）。幅 360 未満では `timerCompact`。 */
  timer: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '800',
    letterSpacing: -0.8,
    fontFamily: family.numeric,
    ...tabularNums,
  },
  timerCompact: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -0.64,
    fontFamily: family.numeric,
    ...tabularNums,
  },
  /** 編集の再生位置（見本に無い。timer より一段小さく）。 */
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
  /** 番組名（見本 `.showhead h3`）。 */
  display: { fontSize: 26, lineHeight: 31, fontWeight: '900', letterSpacing: -0.52 },
  /** 移行用: Design system 3 の看板の語とステッカーの文字。#235 の作業 7 で部品と一緒に消す。 */
  sign: { fontSize: 20, lineHeight: 24, fontWeight: '800' },
  /** Home のセクション見出し（見本 `.h2`）。 */
  title: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.22 },
  /** 収録画面のエピソードの題（見本 `.np .title b`）。 */
  nowPlaying: { fontSize: 21, lineHeight: 26, fontWeight: '800' },
  /** トークテーマの今の項目（見本 `.topic b`）。 */
  topic: { fontSize: 19, lineHeight: 26, fontWeight: '800' },
  /** 書き出しタブの題（見本 `.exhero b`）。 */
  heading: { fontSize: 18, lineHeight: 23, fontWeight: '800' },
  /** エピソード画面の上部の題（見本 `.ephead .row b`）。 */
  screenTitle: { fontSize: 16, lineHeight: 20, fontWeight: '800' },
  /** 画面内の小見出し（見本 `.chapters h4`、`.fields h4`）。 */
  subheading: { fontSize: 15, lineHeight: 19, fontWeight: '800' },
  /** 番組画面の一覧の題（見本 `.epi b`）。 */
  rowTitleStrong: { fontSize: 15, lineHeight: 19, fontWeight: '700' },
  /** Home の一覧の題（見本 `.ep .t b`）。 */
  rowTitle: { fontSize: 14.5, lineHeight: 18, fontWeight: '600' },
  /** 行の本文、通知（見本 `.chap`、`.check`、`.toast`）。 */
  body: { fontSize: 13.5, lineHeight: 20, fontWeight: '400' },
  /** 本文の強調。大きさは変えず太さだけ一段上げる（見本 `.toast` の 600）。 */
  bodyStrong: { fontSize: 13.5, lineHeight: 20, fontWeight: '600' },
  /** ボタン（見本 `.btn`）。 */
  label: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  /** チップ、ミニプレーヤーの題、番組カードの名前（見本 `.chip`）。 */
  chip: { fontSize: 13, lineHeight: 16, fontWeight: '600' },
  /** 補助情報、概要（見本 `.ep .t span`、`.epi p`）。 */
  caption: { fontSize: 12.5, lineHeight: 19, fontWeight: '400' },
  /** 日付・時間・状態の補足（見本 `.mini .t small`、`.epi .d`）。 */
  small: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  /** カードの上段、波形パネルの名札（見本 `.topic small`、`.wavebox .chap`）。 */
  meta: { fontSize: 11, lineHeight: 14, fontWeight: '800', letterSpacing: 0.66 },
  /** 状態の札、下部タブ、素材のレーン名（見本 `.pill`、`.tabs button`、`.layer`）。 */
  overline: { fontSize: 10.5, lineHeight: 13, fontWeight: '700', letterSpacing: 0.21 },
  /** 行の中の値・時刻（見本 `.check .val`、`.chap span`）。 */
  numeric: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    fontFamily: family.numeric,
    ...tabularNums,
  },
  /** 波形の目盛り（見本 `.ruler`）。 */
  tick: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '400',
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
  /** すべての操作の触れる面。見た目がこれより小さいときは hitSlop で広げる。 */
  min: 48,
  /** 通常のボタンの見た目の高さ（見本 `.btn`）。触れる面は hitSlop で 48 にする。 */
  button: 44,
  /** 収録の丸ボタン（見本 `.recbtn`）。再生系と録音系で同じ大きさ（#128）。 */
  record: 72,
  /** 番組画面の録音の丸（見本 `.bigplay`）。 */
  roundAction: 56,
  /** アイコンボタンの見た目（見本 `.ib`）。収録画面の操作バーは `iconLarge`（`.transport .ib`）。 */
  icon: 32,
  iconLarge: 44,
  /** 一覧の右端の白い丸（見本 `.minicircle`）。 */
  rowAction: 32,
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
  /** 通常時の枠（地の色と同じにして見せない。DESIGN_SYSTEM.md §6）。 */
  border: stroke.hairline,
  /** 入力中・エラー時の枠。 */
  borderActive: stroke.selected,
} as const;

/**
 * 落ち影（見本の box-shadow）。影は黒の半透明で、文字や形の色ではないので色のトークンに置かない。
 * 押せる物の印には使わない（DESIGN_SYSTEM.md §2、§6）。
 */
export const shadow = {
  /** 白い通知（見本 `.toast`）。 */
  toast: '0 10px 30px rgba(0, 0, 0, 0.5)',
  /** Home の番組カードのアートワーク（見本 `.showcard .art`）。 */
  artworkCard: '0 8px 20px rgba(0, 0, 0, 0.45)',
  /** 番組画面の大きいアートワーク（見本 `.showhead .art`）。 */
  artworkLarge: '0 16px 40px rgba(0, 0, 0, 0.55)',
} as const;

/** チップ（見本 `.chip`）。上下 7・左右 14。 */
export const chip = { paddingY: 7, paddingX: space.x14 } as const;

/** 状態の札（見本 `.pill`）。上下 2・左右 7。 */
export const pill = { paddingY: space.hair, paddingX: 7 } as const;

/** シートのつまみ（見本 `.sheet .grab`）。 */
export const grabber = { width: 36, height: space.xs } as const;

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
  /** 番組の色の切り替え（見本 `.phone *` の 0.45 秒。DESIGN_SYSTEM.md §2.6）。 */
  colorFade: 450,
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
