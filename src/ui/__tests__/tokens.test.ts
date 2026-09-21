import { contrast } from '../contrast';
import {
  colors,
  concentric,
  hit,
  hitSlop,
  radius,
  space,
  tone,
  typography,
  type Colors,
  type ToneName,
} from '../tokens';

const TONES = [
  'accent',
  'danger',
  'voice',
  'music',
  'insert',
  'mistake',
] as const satisfies readonly ToneName[];

const THEMES = ['dark', 'light'] as const;

/** 本文が載りうる面。文字はこのどれに載っても読めなければならない。 */
const TEXT_SURFACES = ['bg', 'surface', 'surfaceRaised', 'surfaceHover'] as const;

/** WCAG 1.4.3（本文 4.5:1）を満たさなければならない文字のトークン。 */
const BODY_TEXT = [
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'accentText',
  'dangerText',
  'successText',
  'voiceText',
  'musicText',
  'insertText',
  'mistakeText',
] as const satisfies readonly (keyof Colors)[];

/** WCAG 1.4.11（操作部品 3:1）を満たさなければならない面と輪郭。 */
const NON_TEXT = [
  'borderStrong',
  'accentBorder',
  'accentSolid',
  'dangerSolid',
  'recSolid',
  'voiceSolid',
  'musicSolid',
  'insertSolid',
  'mistakeSolid',
] as const satisfies readonly (keyof Colors)[];

describe.each(THEMES)('%s テーマの色', (theme) => {
  const c = colors[theme];

  it.each(BODY_TEXT)('%s はどの面の上でも 4.5:1 以上ある', (token) => {
    for (const surface of TEXT_SURFACES) {
      expect({ token, surface, ratio: contrast(c[token], c[surface]) }).toMatchObject({
        ratio: expect.any(Number),
      });
      expect(contrast(c[token], c[surface])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('無効状態の文字も 3:1 は保つ', () => {
    for (const surface of TEXT_SURFACES) {
      expect(contrast(c.textDisabled, c[surface])).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(NON_TEXT)('%s は背景に対して 3:1 以上ある', (token) => {
    expect(contrast(c[token], c.bg)).toBeGreaterThanOrEqual(3);
  });

  it('塗りの上のラベルは押下中も 4.5:1 以上ある', () => {
    for (const role of ['accent', 'danger'] as const) {
      expect(contrast(c[`${role}OnSolid`], c[`${role}Solid`])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c[`${role}OnSolid`], c[`${role}SolidPressed`])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(TONES)('%s の淡い地の上でも、文字は 4.5:1 / 輪郭は 3:1 ある', (name) => {
    const t = tone(c, name);
    expect(contrast(t.text, t.subtle)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.border, t.subtle)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.border, c.bg)).toBeGreaterThanOrEqual(3);
  });

  it('いちばん条件の悪い面は surfaceHover（文字の段はここから逆算している）', () => {
    const worst = TEXT_SURFACES.reduce((a, b) =>
      contrast(c[a], c.textPrimary) <= contrast(c[b], c.textPrimary) ? a : b,
    );
    expect(worst).toBe('surfaceHover');
  });

  it('カードの面はページの地と見分けがつく', () => {
    expect(c.surface).not.toBe(c.bg);
    expect(c.surfaceHover).not.toBe(c.surface);
  });
});

describe('両テーマで同じ役割が揃っている', () => {
  it('トークンの名前が一致する', () => {
    expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort());
  });

  it('透過を持つトークンは、下を隠してはいけない重ねだけ', () => {
    const alpha = Object.entries(colors.dark)
      .filter(([, v]) => v.length === 9)
      .map(([n]) => n)
      .sort();
    expect(alpha).toEqual(['overlayScrim', 'recordingOverlay', 'selectionOverlay']);
  });

  it('値はすべて #RRGGBB か #RRGGBBAA', () => {
    for (const theme of THEMES) {
      for (const [name, value] of Object.entries(colors[theme])) {
        expect([name, value]).toEqual([
          name,
          expect.stringMatching(/^#[0-9A-F]{6}([0-9A-F]{2})?$/i),
        ]);
      }
    }
  });

  it('同じ値を持つ役割は、意味を共有しているものだけ', () => {
    // 「声トラック」と「録れている / 済んでいる」はひとつの意味（DESIGN_SYSTEM.md §2.3）。
    for (const theme of THEMES) {
      expect(colors[theme].successText).toBe(colors[theme].voiceText);
      expect(colors[theme].successSolid).toBe(colors[theme].voiceSolid);
    }
  });
});

describe('寸法', () => {
  it('余白は 4 の倍数（hair だけ例外）', () => {
    for (const [name, v] of Object.entries(space)) {
      if (name !== 'hair') expect(v % 4).toBe(0);
    }
  });

  it('余白と角丸は小さい順に並んでいる', () => {
    const asc = (xs: number[]) => xs.every((v, i) => i === 0 || v > xs[i - 1]!);
    expect(asc(Object.values(space))).toBe(true);
    expect(asc(Object.values(radius))).toBe(true);
  });

  it('入れ子の角丸は 外側 = 内側 + 余白 になる', () => {
    expect(concentric(radius.lg, space.md)).toBe(radius.sm);
    expect(concentric(radius.xl, space.sm)).toBe(radius.lg - 4);
    expect(concentric(radius.sm, space.lg)).toBe(0);
  });

  it('hitSlop は見た目の大きさを 44 まで広げる', () => {
    expect(24 + hitSlop(24) * 2).toBeGreaterThanOrEqual(hit.min);
    expect(hitSlop(hit.min)).toBe(0);
    expect(hitSlop(60)).toBe(0);
  });
});

describe('書体', () => {
  it('11px を下回るサイズは無い', () => {
    for (const role of Object.values(typography)) expect(role.fontSize).toBeGreaterThanOrEqual(11);
  });

  it('18px 未満は太さ 400 以上（細い字は本文サイズで消える）', () => {
    for (const role of Object.values(typography)) {
      if (role.fontSize < 18) expect(Number(role.fontWeight)).toBeGreaterThanOrEqual(400);
    }
  });

  it('折り返しうる役割の行間は文字サイズの 1.4 倍以上ある', () => {
    for (const name of ['body', 'bodyStrong', 'caption'] as const) {
      expect(typography[name].lineHeight / typography[name].fontSize).toBeGreaterThanOrEqual(1.4);
    }
  });

  it('見出しは役割が下がるほど小さくなる', () => {
    const steps = [typography.display, typography.title, typography.heading, typography.body].map(
      (r) => r.fontSize,
    );
    expect(steps).toEqual([...steps].sort((a, b) => b - a));
    expect(new Set(steps).size).toBe(steps.length);
  });
});
