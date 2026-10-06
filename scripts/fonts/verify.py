#!/usr/bin/env python3
"""同梱 Figtree の数値の決まりを検証する。fontTools が必要（Issue #110 / #235）。

数字は等幅数字（tnum）で幅がそろうこと、0 が点付きゼロでない（輪郭が外周と内周の 2 つだけ）こと。
"""
from pathlib import Path
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
WEIGHTS = ('Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black')


def main():
    for weight in WEIGHTS:
        with TTFont(ROOT / 'assets' / 'fonts' / f'Figtree-{weight}.ttf') as font:
            cmap = font.getBestCmap()
            gsub = font['GSUB'].table
            lookups = [i for record in gsub.FeatureList.FeatureRecord
                       if record.FeatureTag == 'tnum' for i in record.Feature.LookupListIndex]
            assert lookups, f'{weight}: tabular figures がない'
            mapping = {}
            for i in lookups:
                for subtable in gsub.LookupList.Lookup[i].SubTable:
                    mapping.update(subtable.mapping)
            digits = [mapping.get(cmap[ord(n)], cmap[ord(n)]) for n in '0123456789']
            widths = {font['hmtx'][glyph][0] for glyph in digits}
            assert len(widths) == 1, f'{weight}: 数字幅が揃わない {widths}'
            # 外周と内周だけ。点付きゼロには中心の輪郭が追加される。
            # 等幅数字の 0 は通常の 0 を参照する合成字形のことがあるので、描いて輪郭を数える。
            glyphs = font.getGlyphSet()
            for zero in {cmap[ord('0')], digits[0]}:
                pen = DecomposingRecordingPen(glyphs)
                glyphs[zero].draw(pen)
                contours = sum(1 for op, _ in pen.value if op == 'closePath')
                assert contours == 2, f'{weight}: ゼロ字形を要確認（輪郭 {contours}）'
            print(f'{weight}: 数字幅 {widths.pop()} units、通常/等幅数字の0は外周と内周のみ')


if __name__ == '__main__':
    main()
