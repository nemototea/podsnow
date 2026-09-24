import { contrast } from '../contrast';
import {
  colors,
  concentric,
  family,
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
  'rec',
  'success',
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
  'recText',
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
  'focusRing',
  'dangerSolid',
  'successSolid',
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

  it.each(NON_TEXT)('%s はどの面に対しても 3:1 以上ある', (token) => {
    for (const surface of TEXT_SURFACES) {
      expect(contrast(c[token], c[surface])).toBeGreaterThanOrEqual(3);
    }
  });

  it('塗りの上のラベルは押下中も 4.5:1 以上ある', () => {
    for (const role of ['accent', 'danger'] as const) {
      expect(contrast(c[`${role}OnSolid`], c[`${role}Solid`])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c[`${role}OnSolid`], c[`${role}SolidPressed`])).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(c.recOnSolid, c.recSolid)).toBeGreaterThanOrEqual(4.5);
  });

  it('ブランドの点は表示先の背景と白い面から 3:1 以上で見分けられる', () => {
    for (const surface of ['bg', 'surface'] as const) {
      expect(contrast(c.brandAccent, c[surface])).toBeGreaterThanOrEqual(3);
    }
  });

  it('主操作の塗りは、背景か輪郭のどちらかで形が 3:1 以上に分かる', () => {
    const byFill = contrast(c.accentSolid, c.bg) >= 3;
    const byOutline =
      contrast(c.accentBorder, c.bg) >= 3 && contrast(c.accentBorder, c.accentSolid) >= 3;
    expect(byFill || byOutline).toBe(true);
  });

  it('録音中の表示は、どの面の上でも 3:1 以上ある', () => {
    for (const surface of TEXT_SURFACES) {
      expect(contrast(c.recSolid, c[surface])).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(['voice', 'music', 'insert', 'mistake'] as const)(
    '%s の波形の棒はトラックの地から 3:1 以上ある',
    (role) => {
      expect(contrast(c[`${role}Solid`], c[`${role}Fill`])).toBeGreaterThanOrEqual(3);
      expect(contrast(c[`${role}Solid`], c[`${role}FillAlt`])).toBeGreaterThanOrEqual(3);
    },
  );

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

  it('声トラックと完了は別の色（声があっても完了とは限らない）', () => {
    for (const theme of THEMES) {
      expect(colors[theme].successText).not.toBe(colors[theme].voiceText);
      expect(colors[theme].successSolid).not.toBe(colors[theme].voiceSolid);
    }
  });

  it('録音中と破壊的操作は別の色', () => {
    for (const theme of THEMES) {
      expect(colors[theme].recSolid).not.toBe(colors[theme].dangerSolid);
      expect(colors[theme].recText).not.toBe(colors[theme].dangerText);
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
    expect(concentric(radius.lg, space.md)).toBe(radius.xs);
    expect(concentric(radius.xl, space.sm)).toBe(radius.lg);
    expect(concentric(radius.sm, space.lg)).toBe(0);
  });

  it('hitSlop は見た目の大きさを 48 まで広げる', () => {
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

  it('等幅の役割は同梱した太さ（400）だけを使う。ほかの太さは疑似太字になる', () => {
    for (const role of Object.values(typography)) {
      if ('fontFamily' in role && role.fontFamily === family.mono) {
        expect(role.fontWeight).toBe('400');
      }
    }
  });

  it('UI の役割は同梱した 400 / 500 / 600 / 700 のどれか', () => {
    for (const role of Object.values(typography)) {
      expect(['400', '500', '600', '700']).toContain(role.fontWeight);
    }
  });

  it('主要な操作の高さは 48 以上、通常のボタンは 52 以上', () => {
    expect(hit.min).toBeGreaterThanOrEqual(48);
    expect(hit.button).toBeGreaterThanOrEqual(52);
    expect(hit.record).toBeGreaterThan(hit.secondary);
  });

  it('見出しは役割が下がるほど小さくなる', () => {
    const steps = [typography.display, typography.title, typography.heading, typography.body].map(
      (r) => r.fontSize,
    );
    expect(steps).toEqual([...steps].sort((a, b) => b - a));
    expect(new Set(steps).size).toBe(steps.length);
  });
});

describe('ライトのボタン', () => {
  it('濃い輪郭は背景・塗り・押下中の塗りから見分けられる', () => {
    const c = colors.light;
    for (const surface of [...TEXT_SURFACES, 'accentSolid', 'accentSolidPressed'] as const) {
      expect(contrast(c.controlBorder, c[surface])).toBeGreaterThanOrEqual(3);
    }
  });
});
