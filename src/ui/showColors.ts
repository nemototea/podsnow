// 番組の色（DESIGN_SYSTEM.md §2.6、Issue #235）。
//
// アートワークの代表色から、番組画面・収録画面・トークテーマのカード・ミニプレーヤーの色を計算する。
// **見本 docs/design-refresh/ds4/mock.html の `derive()` と同じ計算**（HSL、彩度の頭打ち 0.72、
// 白い文字のコントラストが下限を下回る間 明度を 0.01 ずつ下げる）。浮動小数の手順も見本と同じにして、
// 同じ代表色から見本と 1 段も違わない色を出す（テストで見本の値と照合する）。
//
// 副作用を持たない純粋関数だけを置く。画像から代表色を取るのは `dominantColor.ts`。

/** 番組の色の役割（DESIGN_SYSTEM.md §2.6 の表）。値は `#RRGGBB`。 */
export interface ShowColors {
  /** 番組画面の上部のグラデーションの上端（見本 `--show-a`）。 */
  header: string;
  /** 番組画面の上部のグラデーションの 48% の位置（見本 `--show-b`）。 */
  headerEnd: string;
  /** 収録画面のグラデーションの上端（見本 `--np-a`）。 */
  nowPlaying: string;
  /** 収録画面のグラデーションの 55% の位置（見本 `--np-b`）。 */
  nowPlayingMid: string;
  /** 収録画面のグラデーションの下端（見本 `--np-c`）。 */
  nowPlayingEnd: string;
  /** トークテーマのカード（見本 `--topic`）。 */
  topicCard: string;
  /** ミニプレーヤー（見本 `--mini`）。 */
  miniPlayer: string;
}

type Rgb = readonly [number, number, number];

const WHITE: Rgb = [1, 1, 1];

/** 彩度の頭打ち（見本 `Math.min(hsl[1], .72)`）。 */
export const SHOW_SATURATION_CAP = 0.72;

/**
 * 役割ごとの（彩度の掛け率, 明度の出発点, 白い文字の下限）。見本 `derive()` の値。
 * DESIGN_SYSTEM.md §2.6 の表と同じ。
 */
export const SHOW_TONES: Readonly<Record<keyof ShowColors, readonly [number, number, number]>> = {
  header: [0.9, 0.36, 4.5],
  headerEnd: [0.7, 0.2, 7],
  nowPlaying: [0.85, 0.32, 4.5],
  nowPlayingMid: [0.6, 0.16, 7],
  nowPlayingEnd: [0.35, 0.08, 10],
  topicCard: [1, 0.44, 4.5],
  miniPlayer: [0.75, 0.27, 4.5],
};

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255) as unknown as Rgb;
}

export function rgbToHex(rgb: Rgb): string {
  return (
    '#' +
    rgb
      .map((v) => `0${Math.round(v * 255).toString(16)}`.slice(-2))
      .join('')
      .toUpperCase()
  );
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0;
  let s = 0;
  const d = mx - mn;
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** WCAG 2.2 の相対輝度。 */
export function luminance(rgb: Rgb): number {
  const c = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** WCAG 2.2 のコントラスト比。 */
export function contrastRgb(a: Rgb, b: Rgb): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function contrastHex(a: string, b: string): number {
  return contrastRgb(hexToRgb(a), hexToRgb(b));
}

/**
 * 不透明な `fg` を不透明度 `alpha` で `bg` の上に重ねた色。見本は番組の色の上に半透明の白と黒を重ねるので
 * （DESIGN_SYSTEM.md §5.4 の例外）、重ねた結果のコントラストを測るのに使う。
 */
export function compositeHex(fg: string, alpha: number, bg: string): string {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  return rgbToHex([0, 1, 2].map((i) => f[i]! * alpha + b[i]! * (1 - alpha)) as unknown as Rgb);
}

/** 8 bit に丸めた色（書き出す `#RRGGBB` と同じ値）。 */
function rounded(rgb: Rgb): Rgb {
  return rgb.map((v) => Math.round(v * 255) / 255) as unknown as Rgb;
}

/**
 * 指定の明るさで作り、白い文字が `min` を下回るなら暗くする（見本 `tone()`）。
 * 見本は丸める前の色で測るので、境目の色では書き出した `#RRGGBB` が 4.49:1 のように下限をわずかに割る。
 * ここでは丸めた色で測る。見本の 4 番組の色は変わらない（テストで照合）。
 */
function tone(h: number, s: number, l: number, min: number): Rgb {
  let rgb = hslToRgb(h, s, l);
  while (contrastRgb(rounded(rgb), WHITE) < min && l > 0.05) {
    l -= 0.01;
    rgb = hslToRgb(h, s, l);
  }
  return rgb;
}

/** アートワークの代表色（`#RRGGBB`）から番組の色を計算する（見本 `derive()`）。 */
export function deriveShowColors(dominant: string): ShowColors {
  const [h, s0] = rgbToHsl(...hexToRgb(dominant));
  const s = Math.min(s0, SHOW_SATURATION_CAP);
  const out = {} as Record<keyof ShowColors, string>;
  for (const [role, [sat, light, min]] of Object.entries(SHOW_TONES) as [
    keyof ShowColors,
    readonly [number, number, number],
  ][]) {
    out[role] = rgbToHex(tone(h, s * sat, light, min));
  }
  return out;
}
