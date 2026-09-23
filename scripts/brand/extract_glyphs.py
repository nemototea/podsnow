#!/usr/bin/env python3
"""
ロゴタイプの字形を Manrope ExtraBold（800）から取り出し、`glyphs.py` に書く（Issue #94）。

    python3 -m pip install fonttools
    python3 scripts/brand/extract_glyphs.py path/to/Manrope[wght].ttf

字形を変えるときだけ実行する。通常の再生成（`generate.py`）は `glyphs.py` を読むだけで、
fontTools もフォントも要らない。
"""

import os
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'glyphs.py')
CHARS = 'PodsNw'
WEIGHT = 800


def main() -> int:
    font = instantiateVariableFont(TTFont(sys.argv[1]), {'wght': WEIGHT}, inplace=False)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    lines = [
        '# scripts/brand/extract_glyphs.py が生成。直接編集しない。',
        f'# Manrope wght={WEIGHT}（SIL Open Font License 1.1、assets/fonts/Manrope-OFL.txt）。',
        '# 座標はフォント単位（unitsPerEm = %d）、y は上向き。' % font['head'].unitsPerEm,
        '',
        'GLYPHS = {',
    ]
    for ch in CHARS:
        g = glyphs[cmap[ord(ch)]]
        pen = SVGPathPen(glyphs)
        g.draw(pen)
        bounds = BoundsPen(glyphs)
        g.draw(bounds)
        lines.append(f'    {ch!r}: {{')
        lines.append(f"        'advance': {g.width},")
        lines.append(f"        'bounds': {tuple(round(v, 3) for v in bounds.bounds)},")
        lines.append(f"        'd': {pen.getCommands()!r},")
        lines.append('    },')
    lines.append('}')
    with open(OUT, 'w') as f:
        f.write('\n'.join(lines) + '\n')
    print('書き出し', OUT)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
