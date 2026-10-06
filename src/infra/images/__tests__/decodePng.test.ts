import { zlibSync } from 'fflate';

import { decodePng } from '../decodePng';

/** テスト用の PNG を組む（CRC は展開側が見ないので 0 で埋める）。 */
function png(width: number, height: number, colorType: number, rows: number[][]): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const raw = new Uint8Array(rows.flat());
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('PNG の展開（アートワークの代表色のため）', () => {
  it('RGBA・フィルタなし', () => {
    const d = decodePng(png(2, 1, 6, [[0, 255, 0, 0, 255, 0, 0, 255, 128]]));
    expect([d.width, d.height]).toEqual([2, 1]);
    expect(Array.from(d.rgba)).toEqual([255, 0, 0, 255, 0, 0, 255, 128]);
  });

  it('RGB は不透明として展開する', () => {
    const d = decodePng(png(1, 1, 2, [[0, 10, 20, 30]]));
    expect(Array.from(d.rgba)).toEqual([10, 20, 30, 255]);
  });

  it('Sub / Up / Average / Paeth のフィルタを戻す', () => {
    // 2×2 の RGB。行 0 は Sub、行 1 は Up / Average / Paeth で同じ画素になるように組む。
    const want = [
      [10, 20, 30, 40, 50, 60],
      [15, 25, 35, 45, 55, 65],
    ];
    const sub = [1, 10, 20, 30, 30, 30, 30];
    const up = [2, 5, 5, 5, 5, 5, 5];
    const avg = [
      3,
      15 - (10 >> 1),
      25 - (20 >> 1),
      35 - (30 >> 1),
      45 - ((15 + 40) >> 1),
      55 - ((25 + 50) >> 1),
      65 - ((35 + 60) >> 1),
    ];
    const paethRow = [4, 5, 5, 5, 5, 5, 5];
    for (const second of [up, avg, paethRow]) {
      const d = decodePng(png(2, 2, 2, [sub, second]));
      const got = Array.from(d.rgba).filter((_, i) => i % 4 !== 3);
      expect(got).toEqual(want.flat());
    }
  });

  it('グレーとグレー + α', () => {
    expect(Array.from(decodePng(png(1, 1, 0, [[0, 77]])).rgba)).toEqual([77, 77, 77, 255]);
    expect(Array.from(decodePng(png(1, 1, 4, [[0, 77, 9]])).rgba)).toEqual([77, 77, 77, 9]);
  });

  it('扱えない形は例外にする（呼び出し側は代表色を諦める）', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow('png: signature');
    expect(() => decodePng(png(1, 1, 3, [[0, 0]]))).toThrow('png: unsupported');
  });
});
