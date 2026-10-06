#!/usr/bin/env python3
"""
ロゴタイプの字形と字送りを Figtree 900 から取り出し、`glyphs.py` に書く（Issue #235）。

    python3 -m pip install fonttools uharfbuzz
    python3 scripts/brand/extract_glyphs.py path/to/Figtree[wght].ttf

可変フォントを渡すと `WEIGHT` のインスタンスを切り出す。字送りは HarfBuzz で組んだ値
（カーニングを含む）。見本 `docs/design-refresh/ds4/mock.html` はブラウザで描いているので、
ブラウザと同じ組み方の値を使って見本と同じ字の並びにする。

字形を変えるときだけ実行する。通常の再生成（`generate.py`）は `glyphs.py` を読むだけで、
fontTools もフォントも要らない。
"""

import io
import os
import sys

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'glyphs.py')
RUNS = ('PodsNow.', 'Pods', 'Now.')
WEIGHT = 900


def main() -> int:
    font = TTFont(sys.argv[1])
    if 'fvar' in font:
        font = instantiateVariableFont(font, {'wght': WEIGHT}, inplace=False)
    buf = io.BytesIO()
    font.save(buf)
    data = buf.getvalue()
    font = TTFont(io.BytesIO(data))
    hb_font = hb.Font(hb.Face(hb.Blob(data)))

    name = 'Figtree'
    upm = font['head'].unitsPerEm
    os2 = font['OS/2']
    glyph_order = font.getGlyphOrder()
    glyphs = font.getGlyphSet()

    runs: dict[str, list[tuple[str, int, int]]] = {}
    used: list[str] = []
    for text in RUNS:
        b = hb.Buffer()
        b.add_str(text)
        b.guess_segment_properties()
        hb.shape(hb_font, b, {'kern': True, 'liga': True})
        run = []
        for info, pos in zip(b.glyph_infos, b.glyph_positions):
            gname = glyph_order[info.codepoint]
            run.append((gname, pos.x_advance, pos.x_offset))
            if gname not in used:
                used.append(gname)
        runs[text] = run

    lines = [
        '# scripts/brand/extract_glyphs.py が生成。直接編集しない。',
        f'# {name} {WEIGHT}（SIL Open Font License 1.1、assets/fonts/ の *-OFL.txt）。',
        '# 座標はフォント単位（UPM）、y は上向き。RUNS の字送りは HarfBuzz で組んだ値（カーニングを含む）。',
        '',
        f'UPM = {upm}',
        f'ASCENT = {os2.sTypoAscender}',
        f'DESCENT = {-os2.sTypoDescender}',
        '',
        'RUNS = {',
    ]
    for text, run in runs.items():
        lines.append(f'    {text!r}: {run!r},')
    lines.append('}')
    lines.append('')
    lines.append('GLYPHS = {')
    for gname in used:
        g = glyphs[gname]
        pen = SVGPathPen(glyphs)
        g.draw(pen)
        bounds = BoundsPen(glyphs)
        g.draw(bounds)
        lines.append(f'    {gname!r}: {{')
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
