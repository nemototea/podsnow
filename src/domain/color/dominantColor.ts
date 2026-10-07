// アートワークの代表色（DESIGN_SYSTEM.md §2.6 の手順 1、Issue #235）。
//
// 「面積が大きく、彩度のある色」を 1 つ選ぶ。入力は縮小した画像の画素（RGBA の並び）で、
// 縮小と画素の読み出しは呼び出し側（services / infra）が行う。ここは副作用を持たない純粋関数。
//
// 手順:
// 1. 透けている画素（alpha < 128）は数えない。
// 2. 彩度と明るさが中ほどにある画素（有彩色）を、色相 15° ごとの棚に分けて数える。
// 3. 有彩色が不透明な画素の 10% に満たなければ、無彩色の絵として全画素の平均を返す
//    （番組の色は灰色になる。見本の計算は彩度 0 なら灰色の段を返す）。
// 4. いちばん多い棚と、その両隣の棚の画素の平均を返す（棚の境目で色が割れないように）。
//
// 見本の 4 番組のアートワークを描いた画素で、見本の代表色と色相が近いことをテストで確かめている。

import { rgbToHex, rgbToHsl } from './showColors';

const HUE_BINS = 24;
/** 有彩色とみなす彩度の下限と、明るさの範囲。白・黒・灰に近い画素は数えない。 */
const MIN_SATURATION = 0.15;
const MIN_LIGHTNESS = 0.08;
const MAX_LIGHTNESS = 0.92;
/** 有彩色がこの割合に満たなければ無彩色の絵とみなす。 */
const MIN_CHROMATIC_SHARE = 0.1;

/**
 * 画素（RGBA を 4 バイトずつ並べたもの）から代表色を選ぶ。不透明な画素が無ければ null。
 */
export function pickDominantColor(rgba: ArrayLike<number>): string | null {
  const bins = Array.from({ length: HUE_BINS }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
  let opaque = 0;
  let chromatic = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue;
    const r = rgba[i]! / 255;
    const g = rgba[i + 1]! / 255;
    const b = rgba[i + 2]! / 255;
    opaque += 1;
    sr += r;
    sg += g;
    sb += b;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (s < MIN_SATURATION || l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) continue;
    chromatic += 1;
    const bin = bins[Math.min(HUE_BINS - 1, Math.floor(h * HUE_BINS))]!;
    bin.n += 1;
    bin.r += r;
    bin.g += g;
    bin.b += b;
  }
  if (!opaque) return null;
  if (chromatic < opaque * MIN_CHROMATIC_SHARE) {
    return rgbToHex([sr / opaque, sg / opaque, sb / opaque]);
  }
  let best = 0;
  for (let i = 1; i < HUE_BINS; i++) if (bins[i]!.n > bins[best]!.n) best = i;
  let n = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const d of [-1, 0, 1]) {
    const bin = bins[(best + d + HUE_BINS) % HUE_BINS]!;
    n += bin.n;
    r += bin.r;
    g += bin.g;
    b += bin.b;
  }
  return rgbToHex([r / n, g / n, b / n]);
}
