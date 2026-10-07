import { unzlibSync } from 'fflate';

/**
 * 小さな PNG を RGBA の画素に展開する（アートワークの代表色のため。DESIGN_SYSTEM.md §2.6、Issue #235）。
 *
 * `expo-image-manipulator` は画素を直接返さないので、16×16 に縮めた PNG を受け取ってここで展開する。
 * 扱うのは 8 bit・インターレース無しの グレー / RGB / グレー + α / RGBA（縮小した画像の書き出しで出る形）。
 * パレット（色の型 3）と 16 bit、インターレースは扱わず例外にする（呼び出し側は代表色を諦める）。
 * 出典（【確認済み】）: https://www.w3.org/TR/png-3/ の 11.2.2 IHDR、7.3 Filter types、9 Filtering。
 */
export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA を 4 バイトずつ、左上から行ごとに並べたもの。 */
  rgba: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** 色の型ごとの 1 画素のチャンネル数（8 bit のとき）。 */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

function u32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('png: signature');
  }
  let o = SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Uint8Array[] = [];
  while (o + 8 <= bytes.length) {
    const len = u32(bytes, o);
    const type = String.fromCharCode(bytes[o + 4]!, bytes[o + 5]!, bytes[o + 6]!, bytes[o + 7]!);
    const data = bytes.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = u32(data, 0);
      height = u32(data, 4);
      const depth = data[8];
      colorType = data[9]!;
      const interlace = data[12];
      if (depth !== 8 || interlace !== 0 || !(colorType in CHANNELS)) {
        throw new Error(
          `png: unsupported (depth ${depth}, color ${colorType}, interlace ${interlace})`,
        );
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    o += 12 + len;
  }
  if (!width || !height || !idat.length) throw new Error('png: missing chunks');
  const joined = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  let at = 0;
  for (const d of idat) {
    joined.set(d, at);
    at += d.length;
  }
  const raw = unzlibSync(joined);
  const ch = CHANNELS[colorType]!;
  const stride = width * ch;
  if (raw.length < height * (stride + 1)) throw new Error('png: short data');
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x]!;
      const a = x >= ch ? px[dst + x - ch]! : 0;
      const b = y > 0 ? px[dst - stride + x]! : 0;
      const c = x >= ch && y > 0 ? px[dst - stride + x - ch]! : 0;
      const pred =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? (a + b) >> 1
                : filter === 4
                  ? paeth(a, b, c)
                  : -1;
      if (pred < 0) throw new Error(`png: filter ${filter}`);
      px[dst + x] = (v + pred) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * ch;
    const d = i * 4;
    if (colorType === 0 || colorType === 4) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]!;
      rgba[d + 3] = colorType === 4 ? px[s + 1]! : 255;
    } else {
      rgba[d] = px[s]!;
      rgba[d + 1] = px[s + 1]!;
      rgba[d + 2] = px[s + 2]!;
      rgba[d + 3] = colorType === 6 ? px[s + 3]! : 255;
    }
  }
  return { width, height, rgba };
}
