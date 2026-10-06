#!/usr/bin/env python3
"""
セマンティックカラートークンを生成する（DESIGN_SYSTEM.md §5）。

    python3 scripts/design/generate.py

`ramps.py` の定義から `src/ui/tokens/colors.ts` を書き出す。書き出す前に、
文書化してあるコントラストの組み合わせを全部測り、ひとつでも落ちたら
何も書かずに終了する。Python 標準ライブラリしか使わない。

**`src/ui/tokens/colors.ts` を直接編集しない。** 色を変えるときは `ramps.py` を直す。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import color as k  # noqa: E402
import ramps as r  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'ui', 'tokens', 'colors.ts')

# 本文が載りうる面。文字の検証はこの全部に対して行う。
TEXT_SURFACES = r.TEXT_SURFACES

HUE_ROLES = ('accent', 'danger', 'rec', 'voice', 'music', 'insert', 'mistake', 'success')
TRACKS = ('voice', 'music', 'insert', 'mistake')


# (前景, 背景, 最低比, 理由)。UI 側で実際に起きる組み合わせだけを並べる。
def checks(t: dict[str, str], theme: str) -> list[tuple[str, str, float, str]]:
    out: list[tuple[str, str, float, str]] = []
    for s in TEXT_SURFACES:
        for fg in ('textPrimary', 'textSecondary'):
            out.append((fg, s, 4.5, 'WCAG 1.4.3 本文'))
        out.append(('textDisabled', s, 3.0, '無効状態。1.4.3 の対象外だが見えなくはしない'))
        out.append(('borderStrong', s, 3.0, 'WCAG 1.4.11 副操作ボタンの輪郭'))
        out.append(('focusRing', s, 3.0, 'WCAG 1.4.11 / 2.4.13 焦点の輪'))
        out.append(('recSolid', s, 3.0, 'WCAG 1.4.11 録音中の表示'))
        for role in HUE_ROLES:
            out.append((f'{role}Text', s, 4.5, 'WCAG 1.4.3 本文'))
    for s in r.TERTIARY_SURFACES:
        out.append(('textTertiary', s, 4.5, 'WCAG 1.4.3 目盛り（波形パネルの上だけで使う）'))
    for role in HUE_ROLES:
        out.append((f'{role}Text', f'{role}Subtle', 4.5, '淡い地の上のラベル'))
    for role in ('accent', 'danger', 'voice', 'music', 'insert', 'mistake'):
        for s in TEXT_SURFACES + (f'{role}Subtle',):
            out.append((f'{role}Border', s, 3.0, 'WCAG 1.4.11 輪郭'))
    for s in ('accentSolid', 'accentSolidPressed'):
        out.append((s, 'bg', 3.0, 'WCAG 1.4.11 主操作の塗りだけで形が分かる'))
    out += [
        ('accentOnSolid', 'accentSolid', 4.5, '主操作のラベル'),
        ('accentOnSolid', 'accentSolidPressed', 4.5, '押下中も読める'),
        ('dangerOnSolid', 'dangerSolid', 4.5, '破壊的操作のラベル'),
        ('dangerOnSolid', 'dangerSolidPressed', 4.5, '押下中も読める'),
        ('recOnSolid', 'recSolid', 4.5, '録音中の札の文字'),
        ('insertOnSolid', 'insertSolid', 4.5, '差し込み素材の塗りの上の名前'),
        ('musicOnSolid', 'musicSolid', 4.5, 'BGM の塗りの上の名前'),
        ('textPrimary', 'accentSubtle', 4.5, '選択中の塊の地の上の文字'),
        ('accentSolid', 'accentSubtle', 3.0, '選択中の塊の波形と輪郭（見本 .chunk.sel）'),
        ('textPrimary', 'musicFill', 4.5, 'BGM のレーンの名前（見本 .layer.music）'),
        ('textPrimary', 'insertFill', 4.5, '差し込み素材のレーンの名前（見本 .layer.insert）'),
        ('textSecondary', 'pillStrong', 4.5, '書き出し済みの札（見本 .pill.ok）'),
        ('textPrimary', 'avatar', 4.5, 'アバターの頭文字'),
        ('inverseText', 'inverseSurface', 4.5, '白い通知（見本 .toast）'),
        ('waveBar', 'voiceFill', 3.0, '波形の棒が塊の地から見える（見本 .chunk i）'),
        ('waveBar', 'surface', 3.0, '波形の棒が波形パネルから見える'),
        ('accentSolid', 'surfaceRaised', 3.0, '選択中のチップがシートの上でも分かる'),
        ('successSolid', 'bg', 3.0, 'WCAG 1.4.11 完了の印'),
        ('dangerSolid', 'bg', 3.0, 'WCAG 1.4.11 塗りだけで形が分かる'),
    ]
    for role in TRACKS:
        out.append((f'{role}Solid', 'bg', 3.0, 'WCAG 1.4.11 波形のマーカー'))
        out.append((f'{role}Solid', f'{role}Fill', 3.0, '波形の棒がトラックの地から見分けられる'))
        out.append((f'{role}Solid', f'{role}FillAlt', 3.0, '波形の棒がトラックの地から見分けられる'))
        out.append((f'{role}Fill', 'surface', 1.2, '波形の塗り。波形パネル（surface）の上で面として見分けがつく'))
    return out


# 同じ意味に見えてしまう色相が無いこと（better-colors: 15° 以内は同じ色に見える）。
MIN_HUE_GAP = 30.0


def verify(t: dict[str, str], theme: str) -> list[str]:
    bad = []
    for fg, bg, need, why in checks(t, theme):
        if (fg, bg) in r.CONTRAST_EXCEPTIONS:
            continue
        got = k.contrast(t[fg], t[bg])
        if got < need:
            bad.append(f'{theme}: {fg} on {bg} = {got:.2f}:1 < {need}:1（{why}）')
    hues = sorted(r.HUES.items(), key=lambda kv: kv[1])
    for (n1, h1), (n2, h2) in zip(hues, hues[1:] + [(hues[0][0], hues[0][1] + 360)]):
        if h2 - h1 < MIN_HUE_GAP and (n1, n2) not in r.HUE_GAP_EXCEPTIONS:
            bad.append(f'色相 {n1} と {n2} が {h2 - h1:.0f}° しか離れていない（{MIN_HUE_GAP}° 以上）')
    if t['voiceSolid'] == t['successSolid'] or t['voiceText'] == t['successText']:
        bad.append(f'{theme}: 声トラックと完了が同じ色（DESIGN_SYSTEM.md §5.2）')
    if t['recSolid'] == t['dangerSolid'] or t['recText'] == t['dangerText']:
        bad.append(f'{theme}: 録音と破壊的操作が同じ色（DESIGN_SYSTEM.md §5.2）')
    for name, want in r.MOCK[theme].items():
        if t[name] != want:
            bad.append(f'{theme}: {name} が見本の値 {want} と違う（{t[name]}）')
    return bad


HEADER = '''// scripts/design/generate.py が生成。直接編集せず scripts/design/ramps.py を直すこと。
//
// 役割の名前だけを置く。`#FFE34D` のような値を画面から直接使わない（DESIGN_SYSTEM.md §5）。
// テーマはダーク 1 つ（Issue #235）。見本 docs/design-refresh/ds4/mock.html の色はそのままの値で、
// 見本に無い色は OKLCh で計算し、文字と境界は目標コントラスト比から逆算してある。
// 「移行用」の名前は Design system 3 の部品のためだけに残している。新しいコードから読まない。

'''


def emit(themes: dict[str, dict[str, str]]) -> str:
    keys = list(themes['dark'].keys())
    lines = [HEADER, 'export const colors = {\n']
    for theme in r.THEMES:
        lines.append(f'  {theme}: {{\n')
        for key in keys:
            lines.append(f"    {key}: '{themes[theme][key]}',\n")
        lines.append('  },\n')
    lines.append('} as const;\n\n')
    lines.append('export type ThemeName = keyof typeof colors;\n')
    lines.append('export type Colors = (typeof colors)[ThemeName];\n')
    lines.append('\n/** 移行用（Design system 3 の部品が読む名前）。#235 の作業 6 で消す。 */\n')
    legacy = list(r.LEGACY['dark']) + list(r.LEGACY_FIXED['dark'])
    lines.append('export const legacyColorNames = [\n')
    for name in legacy:
        lines.append(f"  '{name}',\n")
    lines.append('] as const;\n')
    return ''.join(lines)


def main() -> int:
    themes = {theme: r.build(theme) for theme in r.THEMES}
    bad = [m for theme in r.THEMES for m in verify(themes[theme], theme)]
    if bad:
        print('コントラストの検証に失敗した。何も書き出していない。', file=sys.stderr)
        for m in bad:
            print('  -', m, file=sys.stderr)
        return 1
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(emit(themes))
    n = len(themes['dark'])
    print(f'書き出し {os.path.relpath(OUT, ROOT)}（{n} トークン x {len(r.THEMES)} テーマ）')
    n_checks = sum(len(checks(themes[theme], theme)) for theme in r.THEMES) - len(r.CONTRAST_EXCEPTIONS)
    print(f'検証 {n_checks} 組のコントラストが基準を満たしている')
    for (fg, bg), why in r.CONTRAST_EXCEPTIONS.items():
        got = k.contrast(themes['dark'][fg], themes['dark'][bg])
        print(f'例外 {fg} on {bg} = {got:.2f}:1（{why}）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
