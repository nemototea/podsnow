#!/usr/bin/env python3
"""同梱Manropeの数値契約を検証。fontToolsが必要（Issue #110）。"""
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]


def main():
    for weight in ('Regular', 'Medium', 'SemiBold', 'Bold'):
        with TTFont(ROOT / 'assets' / 'fonts' / f'Manrope-{weight}.ttf') as font:
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
            for zero in {cmap[ord('0')], digits[0]}:
                assert font['glyf'][zero].numberOfContours == 2, f'{weight}: ゼロ字形を要確認'
            print(f'{weight}: 数字幅 {widths.pop()} units、通常/等幅数字の0は外周と内周のみ')


if __name__ == '__main__':
    main()
