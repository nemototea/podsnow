/**
 * WCAG のコントラスト比。トークンの検証にだけ使う純粋関数。
 *
 * 色の値を決めるのは `scripts/design/ramps.py`。こちらは「決まった値が基準を
 * 満たしているか」をテストで測るためにある。二重に持っているのは、生成を忘れた
 * まま `colors.ts` を手で書き換えたときに CI で落とすため。
 *
 * 出典【確認済み】: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** `#RRGGBB` の相対輝度。`#RRGGBBAA` は受け付けない（背面が分からないと測れない）。 */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`コントラストを測れない色: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

/** 2 色のコントラスト比（1..21）。 */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
