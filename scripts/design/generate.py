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
        for fg in ('textPrimary', 'textSecondary', 'textTertiary'):
            out.append((fg, s, 4.5, 'WCAG 1.4.3 本文'))
        out.append(('textDisabled', s, 3.0, '無効状態。1.4.3 の対象外だが見えなくはしない'))
        out.append(('borderStrong', s, 3.0, 'WCAG 1.4.11 操作部品の輪郭'))
        out.append(('focusRing', s, 3.0, 'WCAG 1.4.11 / 2.4.13 焦点の輪'))
        out.append(('recSolid', s, 3.0, 'WCAG 1.4.11 録音中の表示'))
        for role in HUE_ROLES:
            out.append((f'{role}Text', s, 4.5, 'WCAG 1.4.3 本文'))
    for role in HUE_ROLES:
        out.append((f'{role}Text', f'{role}Subtle', 4.5, 'チップの地の上のラベル'))
    for role in ('accent', 'danger', 'voice', 'music', 'insert', 'mistake'):
        for s in TEXT_SURFACES + (f'{role}Subtle',):
            out.append((f'{role}Border', s, 3.0, 'WCAG 1.4.11 輪郭'))
    for s in ('bg', 'surface'):
        out.append(('brandAccent', s, 3.0, 'ブランドの点の製品基準'))
    # ボタンの輪郭と硬い影（DESIGN_SYSTEM.md §6）。影は bg に置いた下部バーの上にも出る。
    for s in TEXT_SURFACES:
        out.append(('controlBorder', s, 3.0, 'WCAG 1.4.11 副操作の輪郭'))
        out.append(('controlShadow', s, 3.0, '硬い影が面から見える'))
    for s in ('accentSolid', 'accentSolidPressed'):
        out.append(('controlEdge', s, 3.0, '主操作の枠がシトロンの塗りから見分けられる'))
    if theme == 'light':
        for s in TEXT_SURFACES:
            out.append(('controlEdge', s, 3.0, 'WCAG 1.4.11 ライトの主操作の輪郭'))
    # 編集タブのキーと表示窓（PN-01、#115。DESIGN_SYSTEM.md §6.3）
    for s in TEXT_SURFACES + ('well',):
        out.append(('keyEdge', s, 3.0, 'WCAG 1.4.11 キーの輪郭'))
    out.append(('textPrimary', 'key', 4.5, 'キーの記号・ラベル'))
    for fg in ('dispInk', 'dispDim'):
        for bg in ('dispBg', 'dispLine'):
            out.append((fg, bg, 4.5, 'WCAG 1.4.3 表示窓の文字'))
    for fg in ('dispVoice', 'dispMusic', 'dispInsert', 'dispMistake', 'dispSuccess', 'dispRec'):
        out.append((fg, 'dispBg', 3.0, 'WCAG 1.4.11 表示窓の波形・状態'))
    out += [
        ('accentOnSolid', 'accentSolid', 4.5, '主操作のラベル'),
        ('accentOnSolid', 'accentSolidPressed', 4.5, '押下中も読める'),
        ('dangerOnSolid', 'dangerSolid', 4.5, '破壊的操作のラベル'),
        ('dangerOnSolid', 'dangerSolidPressed', 4.5, '押下中も読める'),
        ('recOnSolid', 'recSolid', 4.5, '録音ボタンの記号'),
        ('textPrimary', 'accentSubtle', 4.5, 'チップの地の上のラベル'),
        ('successSolid', 'bg', 3.0, 'WCAG 1.4.11 完了の印'),
        ('dangerSolid', 'bg', 3.0, 'WCAG 1.4.11 塗りだけで形が分かる'),
    ]
    if theme == 'dark':
        out.append(('controlShadow', 'controlEdge', 3.0, '明るい影の手前で主操作の枠が線として見える'))
        out.append(('accentSolid', 'bg', 3.0, 'WCAG 1.4.11 塗りだけで形が分かる'))
    else:
        # ライトではシトロンの塗りが白地に 3:1 を持てない。形は輪郭 accentBorder が運ぶ。
        out.append(('accentBorder', 'accentSolid', 3.0, 'ライトの主操作は輪郭で形を示す'))
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
        got = k.contrast(t[fg], t[bg])
        if got < need:
            bad.append(f'{theme}: {fg} on {bg} = {got:.2f}:1 < {need}:1（{why}）')
    hues = sorted(r.HUES.items(), key=lambda kv: kv[1])
    for (n1, h1), (n2, h2) in zip(hues, hues[1:] + [(hues[0][0], hues[0][1] + 360)]):
        if h2 - h1 < MIN_HUE_GAP:
            bad.append(f'色相 {n1} と {n2} が {h2 - h1:.0f}° しか離れていない（{MIN_HUE_GAP}° 以上）')
    if t['voiceSolid'] == t['successSolid'] or t['voiceText'] == t['successText']:
        bad.append(f'{theme}: 声トラックと完了が同じ色（DESIGN_SYSTEM.md §5.2）')
    return bad


HEADER = '''// scripts/design/generate.py が生成。直接編集せず scripts/design/ramps.py を直すこと。
//
// 役割の名前だけを置く。`#D8F36A` のような値を画面から直接使わない（DESIGN_SYSTEM.md §5）。
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
    n_checks = sum(len(checks(themes[theme], theme)) for theme in r.THEMES)
    print(f'検証 {n_checks} 組のコントラストが基準を満たしている')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
