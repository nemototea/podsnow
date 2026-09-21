#!/usr/bin/env python3
"""
セマンティックカラートークンを生成する（DESIGN_SYSTEM.md §2）。

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
TEXT_SURFACES = ('bg', 'surface', 'surfaceRaised', 'surfaceHover')

# (前景, 背景, 最低比, 理由)。UI 側で実際に起きる組み合わせだけを並べる。
def checks(t: dict[str, str]) -> list[tuple[str, str, float, str]]:
    out: list[tuple[str, str, float, str]] = []
    for s in TEXT_SURFACES:
        for fg, need in (('textPrimary', 4.5), ('textSecondary', 4.5), ('textTertiary', 4.5)):
            out.append((fg, s, need, 'WCAG 1.4.3 本文'))
        out.append(('textDisabled', s, 3.0, '無効状態。1.4.3 の対象外だが見えなくはしない'))
        for role in ('accent', 'danger', 'voice', 'music', 'insert', 'mistake'):
            out.append((f'{role}Text', s, 4.5, 'WCAG 1.4.3 本文'))
        out.append(('successText', s, 4.5, 'WCAG 1.4.3 本文'))
    out += [
        ('accentOnSolid', 'accentSolid', 4.5, '主操作のラベル'),
        ('dangerOnSolid', 'dangerSolid', 4.5, '破壊的操作のラベル'),
        ('accentOnSolid', 'accentSolidPressed', 4.5, '押下中も読める'),
        ('dangerOnSolid', 'dangerSolidPressed', 4.5, '押下中も読める'),
        ('borderStrong', 'bg', 3.0, 'WCAG 1.4.11 操作部品の輪郭'),
        ('borderStrong', 'surface', 3.0, 'WCAG 1.4.11 操作部品の輪郭'),
        ('accentBorder', 'bg', 3.0, 'WCAG 1.4.11 選択状態の輪郭'),
        ('accentBorder', 'accentSubtle', 3.0, 'チップの輪郭が地から見分けられる'),
        ('dangerBorder', 'bg', 3.0, 'WCAG 1.4.11 選択状態の輪郭'),
        ('dangerBorder', 'dangerSubtle', 3.0, 'チップの輪郭が地から見分けられる'),
        ('accentSolid', 'bg', 3.0, 'WCAG 1.4.11 塗りだけで形が分かる'),
        ('dangerSolid', 'bg', 3.0, 'WCAG 1.4.11 塗りだけで形が分かる'),
        ('recSolid', 'bg', 3.0, 'WCAG 1.4.11 録音中インジケータ'),
        ('accentText', 'accentSubtle', 4.5, 'チップの地の上のラベル'),
        ('dangerText', 'dangerSubtle', 4.5, 'チップの地の上のラベル'),
        ('textPrimary', 'accentSubtle', 4.5, 'チップの地の上のラベル'),
    ]
    for role in ('voice', 'music', 'insert', 'mistake'):
        out.append((f'{role}Solid', 'bg', 3.0, 'WCAG 1.4.11 波形のマーカー'))
        out.append((f'{role}Fill', 'bg', 1.2, '波形の塗り。面として見分けがつく'))
        out.append((f'{role}Text', f'{role}Subtle', 4.5, 'チップの地の上のラベル'))
        out.append((f'{role}Border', f'{role}Subtle', 3.0, 'チップの輪郭が地から見分けられる'))
        out.append((f'{role}Border', 'bg', 3.0, 'WCAG 1.4.11 チップの輪郭'))
    return out


# 同じ意味に見えてしまう色相が無いこと（better-colors: 15° 以内は同じ色）。
MIN_HUE_GAP = 40.0


def verify(t: dict[str, str], theme: str) -> list[str]:
    bad = []
    for fg, bg, need, why in checks(t):
        got = k.contrast(t[fg], t[bg])
        if got < need:
            bad.append(f'{theme}: {fg} on {bg} = {got:.2f}:1 < {need}:1（{why}）')
    hues = sorted(r.HUES.items(), key=lambda kv: kv[1])
    for (n1, h1), (n2, h2) in zip(hues, hues[1:] + [(hues[0][0], hues[0][1] + 360)]):
        if h2 - h1 < MIN_HUE_GAP:
            bad.append(f'色相 {n1} と {n2} が {h2 - h1:.0f}° しか離れていない（{MIN_HUE_GAP}° 以上）')
    return bad


HEADER = '''// scripts/design/generate.py が生成。直接編集せず scripts/design/ramps.py を直すこと。
//
// 役割の名前だけを置く。`#E2B979` のような値を画面から直接使わない（DESIGN_SYSTEM.md §2）。
// 値は OKLCh で計算し、文字と境界は目標コントラスト比から逆算してある。

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
    print(f'検証 {len(checks(themes["dark"])) * len(r.THEMES)} 組のコントラストが基準を満たしている')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
