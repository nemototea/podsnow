import { pickDominantColor } from '../dominantColor';
import {
  contrastHex,
  deriveShowColors,
  hexToRgb,
  rgbToHsl,
  SHOW_TONES,
  type ShowColors,
} from '../showColors';
import { colors } from '../tokens';

import mockPixels from './mockArtworkPixels.json';

// 見本 docs/design-refresh/ds4/mock.html の derive() をそのまま実行して得た値（2026-10-06）。
// 見本の名前: header = --show-a, headerB = --show-b, npA/npB/npC = --np-a/b/c, topic, mini。
const MOCK: Record<string, [string, ShowColors]> = {
  yoru: [
    '#C4492F',
    {
      header: '#8E3B29',
      headerEnd: '#49251D',
      nowPlaying: '#7C3627',
      nowPlayingMid: '#381F1A',
      nowPlayingEnd: '#191210',
      topicCard: '#B5432B',
      miniPlayer: '#653025',
    },
  ],
  coffee: [
    '#1D8C84',
    {
      header: '#21827B',
      headerEnd: '#1C4A47',
      nowPlaying: '#247F79',
      nowPlayingMid: '#193937',
      nowPlayingEnd: '#101918',
      topicCard: '#1B837B',
      miniPlayer: '#236762',
    },
  ],
  cinema: [
    '#B8123C',
    {
      header: '#97203E',
      headerEnd: '#4D1926',
      nowPlaying: '#842039',
      nowPlayingMid: '#3A1720',
      nowPlayingEnd: '#1A0F12',
      topicCard: '#C11F48',
      miniPlayer: '#6A2032',
    },
  ],
  ima: [
    '#1F5FD6',
    {
      header: '#204A97',
      headerEnd: '#192B4D',
      nowPlaying: '#204384',
      nowPlayingMid: '#17243A',
      nowPlayingEnd: '#0F131A',
      topicCard: '#1F58C1',
      miniPlayer: '#203A6A',
    },
  ],
  white: [
    '#FFFFFF',
    {
      header: '#5C5C5C',
      headerEnd: '#333333',
      nowPlaying: '#525252',
      nowPlayingMid: '#292929',
      nowPlayingEnd: '#141414',
      topicCard: '#707070',
      miniPlayer: '#454545',
    },
  ],
  yellow: [
    '#FFFF00',
    {
      header: '#7A7A1A',
      headerEnd: '#4D4D19',
      nowPlaying: '#77771D',
      nowPlayingMid: '#3A3A17',
      nowPlayingEnd: '#1A1A0F',
      topicCard: '#767613',
      miniPlayer: '#6A6A20',
    },
  ],
};

const ROLES = Object.keys(SHOW_TONES) as (keyof ShowColors)[];
const WHITE = '#FFFFFF';

/** 色相・彩度・明るさを一通り振った代表色（極端なアートワークの代わり）。 */
function sweep(): string[] {
  const out: string[] = ['#000000', '#FFFFFF', '#808080'];
  for (let h = 0; h < 360; h += 15) {
    for (const s of [0.3, 0.7, 1]) {
      for (const l of [0.15, 0.5, 0.85]) {
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l - c / 2;
        const [r, g, b] =
          h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
        out.push(
          '#' + [r + m, g + m, b + m].map((v) => `0${Math.round(v * 255).toString(16)}`.slice(-2)).join(''),
        );
      }
    }
  }
  return out;
}

describe('番組の色（見本の derive() と同じ計算。DESIGN_SYSTEM.md §2.6）', () => {
  it.each(Object.entries(MOCK))('%s: 見本と同じ色になる', (_name, [dominant, want]) => {
    expect(deriveShowColors(dominant)).toEqual(want);
  });

  it('無彩色のアートワーク（白・黒・灰）は同じ灰色の段になる', () => {
    const gray = deriveShowColors('#808080');
    expect(deriveShowColors('#000000')).toEqual(gray);
    expect(deriveShowColors('#FFFFFF')).toEqual(gray);
  });

  it.each(sweep())('%s: どの役割の上でも白い文字が下限以上ある', (dominant) => {
    const c = deriveShowColors(dominant);
    for (const role of ROLES) {
      expect({ role, ratio: contrastHex(WHITE, c[role]) >= SHOW_TONES[role][2] }).toEqual({
        role,
        ratio: true,
      });
    }
  });

  it.each(sweep())('%s: 主操作のレモンは番組画面・ミニプレーヤーの上で 3:1 以上ある', (dominant) => {
    const c = deriveShowColors(dominant);
    for (const role of ['header', 'nowPlaying', 'miniPlayer'] as const) {
      expect({ role, ok: contrastHex(colors.dark.accentSolid, c[role]) >= 3 }).toEqual({
        role,
        ok: true,
      });
    }
  });

  // 見本は番組の色の上の補助文字を半透明の白（72〜85%）で描く。白い文字の下限（4.5:1）ちょうどの色の上では
  // 重ねた結果が 4.5:1 を割る（見本の「朝のコーヒー会議」でも 3.29:1）。DESIGN_SYSTEM.md §13 で確認中。
  it.todo('見本の半透明の白を重ねた補助文字のコントラスト（§13 で決まったら書く）');
});

describe('代表色（DESIGN_SYSTEM.md §2.6 の手順 1）', () => {
  const hue = (hex: string) => rgbToHsl(...hexToRgb(hex))[0] * 360;
  const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

  it.each(['yoru', 'coffee', 'cinema', 'ima'] as const)(
    '見本の %s のアートワーク（16×16 に縮めた画素）から、見本の代表色に近い色相を選ぶ',
    (name) => {
      const picked = pickDominantColor((mockPixels as Record<string, number[]>)[name]!);
      expect(picked).not.toBeNull();
      expect(gap(hue(picked!), hue(MOCK[name]![0]))).toBeLessThanOrEqual(15);
    },
  );

  it('不透明な画素が無ければ null', () => {
    expect(pickDominantColor([])).toBeNull();
    expect(pickDominantColor([255, 0, 0, 0, 0, 255, 0, 10])).toBeNull();
  });

  it('無彩色の絵は全画素の平均（番組の色は灰色の段になる）', () => {
    const px = [0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 64, 64, 64, 255];
    expect(pickDominantColor(px)).toBe('#707070');
  });

  it('いちばん面積の大きい有彩色を選ぶ（少しだけある別の色に引っぱられない）', () => {
    const blue = [31, 95, 214, 255];
    const red = [220, 40, 40, 255];
    const px = [...Array(30).fill(blue).flat(), ...Array(10).fill(red).flat()];
    expect(pickDominantColor(px)).toBe('#1F5FD6');
  });
});
