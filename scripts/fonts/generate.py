#!/usr/bin/env python3
"""
アプリに同梱する書体を生成する（DESIGN_SYSTEM.md §4、Issue #94）。

    python3 -m pip install fonttools
    python3 scripts/fonts/generate.py [--source-dir DIR]

Google Fonts が配布する可変フォント（OFL）から、UI で使うウェイトだけを静的な TTF に
切り出して `assets/fonts/` に書く。React Native は可変フォントの軸を指定できないので、
静的な face を用意しないと太字が疑似太字（合成）になる。

原本は `--source-dir` に置くか、無ければ google/fonts から取得してハッシュを照合する。
原本はリポジトリに入れない（`scripts/fonts/.cache/`、Git 管理外）。
"""

import argparse
import hashlib
import os
import shutil
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'fonts')
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')

BASE = 'https://raw.githubusercontent.com/google/fonts/main/ofl'

# (原本のファイル名, 取得元, sha256, 出力の接頭辞, 切り出すウェイト)。None は静的フォントをそのまま使う。
SOURCES = [
    (
        'Manrope.ttf',
        f'{BASE}/manrope/Manrope%5Bwght%5D.ttf',
        '3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6',
        'Manrope',
        (400, 500, 600, 700),
    ),
    (
        'NotoSansJP.ttf',
        f'{BASE}/notosansjp/NotoSansJP%5Bwght%5D.ttf',
        'c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f',
        'NotoSansJP',
        (400, 500, 600, 700),
    ),
]

STYLE = {400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold'}


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def source(name: str, url: str, digest: str, source_dir: str | None) -> str:
    for d in (source_dir, CACHE):
        if d and os.path.exists(os.path.join(d, name)):
            path = os.path.join(d, name)
            break
    else:
        os.makedirs(CACHE, exist_ok=True)
        path = os.path.join(CACHE, name)
        print('取得', url)
        urllib.request.urlretrieve(url, path)
    got = sha256(path)
    if got != digest:
        raise SystemExit(f'{name} のハッシュが一致しない: {got}（期待 {digest}）')
    return path


def main() -> int:
    try:
        from fontTools.ttLib import TTFont
        from fontTools.varLib.instancer import instantiateVariableFont
    except ImportError:
        print('fontTools が必要: python3 -m pip install fonttools', file=sys.stderr)
        return 1

    ap = argparse.ArgumentParser()
    ap.add_argument('--source-dir')
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    for name, url, digest, prefix, weights in SOURCES:
        src = source(name, url, digest, args.source_dir)
        if weights is None:
            dst = os.path.join(OUT, f'{prefix}-Regular.ttf')
            shutil.copyfile(src, dst)
            print('書き出し', os.path.relpath(dst, ROOT))
            continue
        for w in weights:
            font = instantiateVariableFont(TTFont(src), {'wght': w}, updateFontNames=True)
            if font['OS/2'].usWeightClass != w:
                raise SystemExit(f'{prefix} {w}: usWeightClass が {font["OS/2"].usWeightClass}')
            dst = os.path.join(OUT, f'{prefix}-{STYLE[w]}.ttf')
            font.recalcTimestamp = False
            font.save(dst)
            family = font['name'].getDebugName(16) or font['name'].getDebugName(1)
            print('書き出し', os.path.relpath(dst, ROOT), f'({family} / {w})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
