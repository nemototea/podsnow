import { contrast } from '../contrast';
import { legacyColorNames } from '../tokens/colors';
import {
  colors,
  concentric,
  family,
  field,
  fieldPadding,
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

// テーマはダーク 1 つ（Issue #235、FR-SET-1）。
const THEMES = ['dark'] as const;

/** 本文が載りうる面。文字はこのどれに載っても読めなければならない。 */
const TEXT_SURFACES = ['bg', 'surface', 'surfaceRaised', 'surfaceHover'] as const;

/** WCAG 1.4.3（本文 4.5:1）を満たさなければならない文字のトークン。 */
const BODY_TEXT = [
  'textPrimary',
  'textSecondary',
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
    // 録音中の札「REC」は見本どおり白の文字（ユーザー判断 2026-10-06、#235）。4.5:1 には届かないが 3:1 は保つ
    expect(contrast(c.recOnSolid, c.recSolid)).toBeGreaterThanOrEqual(3);
    expect(contrast(c.insertOnSolid, c.insertSolid)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.musicOnSolid, c.musicSolid)).toBeGreaterThanOrEqual(4.5);
  });

  it('目盛りの文字（textTertiary）は、載る面（bg / surface）の上で 4.5:1 以上ある', () => {
    for (const surface of ['bg', 'surface'] as const) {
      expect(contrast(c.textTertiary, c[surface])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('ロゴの文字と点は黒の地から見える', () => {
    expect(contrast(c.brandInk, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.brandAccent, c.bg)).toBeGreaterThanOrEqual(3);
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

describe('トークンの全体', () => {
  it('テーマはダーク 1 つだけ', () => {
    expect(Object.keys(colors)).toEqual(['dark']);
  });

  it('見本（docs/design-refresh/ds4/mock.html）の色はそのままの値', () => {
    expect(colors.dark).toMatchObject({
      bg: '#121212',
      surface: '#1A1A1A',
      surfaceRaised: '#242424',
      surfaceHover: '#2E2E2E',
      border: '#2F2F2F',
      textPrimary: '#FFFFFF',
      textSecondary: '#B3B3B3',
      textTertiary: '#828282',
      borderStrong: '#7A7A7A',
      accentSolid: '#FFE34D',
      accentOnSolid: '#000000',
      accentSubtle: '#3D3A22',
      recSolid: '#FF4D4D',
      recOnSolid: '#FFFFFF',
      mistakeSolid: '#FFB340',
      waveBar: '#8C8C8C',
      musicFill: '#3E3757',
      insertFill: '#254146',
      inverseSurface: '#FFFFFF',
      inverseText: '#000000',
    });
  });

  it('移行用の名前（Design system 3 の部品が読む）は一覧にあるものだけ', () => {
    for (const name of legacyColorNames) expect(colors.dark).toHaveProperty(name);
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
  it('余白は 4 の倍数か、見本だけの値（hair と、値を名前にした x6 / x10 / x14 / x20 / x22）', () => {
    for (const [name, v] of Object.entries(space)) {
      if (name === 'hair') continue;
      if (/^x\d+$/.test(name)) expect(name).toBe(`x${v}`);
      else expect(v % 4).toBe(0);
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
  it('11px を下回るのは見本の小さな名札と目盛りだけ（overline 10.5、tick 10）', () => {
    for (const [name, role] of Object.entries(typography)) {
      if (name === 'overline' || name === 'tick') expect(role.fontSize).toBeGreaterThanOrEqual(10);
      else expect(role.fontSize).toBeGreaterThanOrEqual(11);
    }
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

  it('数値の役割に等幅数字を組み込み、同梱済みの Figtree を使う', () => {
    for (const role of Object.values(typography)) {
      if ('fontFamily' in role && role.fontFamily === family.numeric) {
        expect(['400', '500', '700', '800']).toContain(role.fontWeight);
        expect(role.fontVariant).toContain('tabular-nums');
      }
    }
  });

  it('役割の太さは同梱した Figtree の 400〜900 のどれか（和文は 700 まで。DESIGN_SYSTEM.md §4.1）', () => {
    for (const role of Object.values(typography)) {
      expect(['400', '500', '600', '700', '800', '900']).toContain(role.fontWeight);
    }
  });

  it('触れる面は 48 以上。見た目が小さい操作（ボタン 44、アイコン 32）は hitSlop で 48 に届く', () => {
    expect(hit.min).toBeGreaterThanOrEqual(48);
    for (const size of [hit.button, hit.icon, hit.iconLarge, hit.rowAction, hit.roundAction]) {
      expect(size + 2 * hitSlop(size)).toBeGreaterThanOrEqual(hit.min);
    }
    expect(hit.record).toBeGreaterThan(hit.roundAction);
  });

  it('入力欄は hit.min 以上で、枠が太くなっても字の位置が動かない', () => {
    expect(field.minHeight).toBeGreaterThanOrEqual(hit.min);
    expect(field.borderActive).toBeGreaterThan(field.border);
    for (const w of [field.border, field.borderActive]) {
      const pad = fieldPadding(w);
      expect(pad.paddingHorizontal + w).toBe(field.paddingX + field.border);
      expect(pad.paddingVertical + w).toBe(field.paddingY + field.border);
      expect(pad.paddingVertical).toBeGreaterThanOrEqual(0);
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
