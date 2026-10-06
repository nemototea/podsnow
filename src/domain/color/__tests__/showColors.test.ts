import { pickDominantColor } from '../dominantColor';
import {
  compositeHex,
  contrastHex,
  deriveShowColors,
  hexToRgb,
  rgbToHsl,
  SHOW_TONES,
  type ShowColors,
} from '../showColors';

import mockPixels from './mockArtworkPixels.json';
import { sweep } from './sweep';

// 見本 docs/design-refresh/ds4/mock.html の derive() をそのまま実行して得た値（2026-10-06、確認点 6-D の反映後）。
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
      topicCard: '#A93F28',
      miniPlayer: '#653025',
    },
  ],
  coffee: [
    '#1D8C84',
    {
      header: '#1A6560',
      headerEnd: '#1C4A47',
      nowPlaying: '#1B5F5A',
      nowPlayingMid: '#193937',
      nowPlayingEnd: '#101918',
      topicCard: '#176E68',
      miniPlayer: '#205F5B',
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
      topicCard: '#B81E45',
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
      topicCard: '#636363',
      miniPlayer: '#454545',
    },
  ],
  yellow: [
    '#FFFF00',
    {
      header: '#616115',
      headerEnd: '#4D4D19',
      nowPlaying: '#5A5A16',
      nowPlayingMid: '#3A3A17',
      nowPlayingEnd: '#1A1A0F',
      topicCard: '#656510',
      miniPlayer: '#5A5A1B',
    },
  ],
};

const ROLES = Object.keys(SHOW_TONES) as (keyof ShowColors)[];
const WHITE = '#FFFFFF';

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

  it.each(sweep())(
    '%s: 見本の半透明の白（72〜85%）を重ねた補助文字も 4.5:1 以上ある（確認点 6-D）',
    (dominant) => {
      const c = deriveShowColors(dominant);
      // 見本 .np .title span（72%）、.np .head small（75%）、.topic .next（80%）、.topic small（85%）、
      // .showhead .by（75%）、.mini .t small（72%）
      const cases: [keyof ShowColors, number][] = [
        ['nowPlaying', 0.72],
        ['nowPlaying', 0.75],
        ['topicCard', 0.8],
        ['topicCard', 0.85],
        ['header', 0.75],
        ['miniPlayer', 0.72],
      ];
      for (const [role, alpha] of cases) {
        const text = compositeHex(WHITE, alpha, c[role]);
        expect({ role, alpha, ok: contrastHex(text, c[role]) >= 4.5 }).toEqual({
          role,
          alpha,
          ok: true,
        });
      }
    },
  );
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
