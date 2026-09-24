"""
PodsNow. のロゴタイプとアイコンの幾何定義（DESIGN_SYSTEM.md §3、Issue #94）。

**ここが図形の正**。SVG・PNG・アプリ内のロゴ（`src/ui/brand/wordmark.ts`）はすべて
この定義から生成するので、互いにずれない。

ロゴはサービス名そのもの `PodsNow.`。Manrope ExtraBold（800）の字形（`glyphs.py`）を
土台に字間を光学調整し、末尾の点を独立した角丸正方形として描く。アイコンは `Pods` /
`Now.` の 2 段で全文を残す。マイク・波形・雪・電波・頭文字だけのマークは使わない
（assets/brand/README.md）。

座標系: 字形はフォント単位（y 上向き）。配置後はキャンバスの px（左上原点・y 下向き）。
"""

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'design'))

import ramps  # noqa: E402
from glyphs import GLYPHS  # noqa: E402

CANVAS = 1024

# 色はトークンの生成元をそのまま読む。ロゴのために別の色を作らない。
DARK = ramps.build('dark')
LIGHT = ramps.build('light')
BG = DARK['bg']
INK = DARK['textPrimary']
DOT = DARK['accentText']
ICON_BG = DARK['accentSolid']
ICON_INK = DARK['accentOnSolid']
LIGHT_BG = LIGHT['bg']
LIGHT_INK = LIGHT['textPrimary']
LIGHT_DOT = LIGHT['accentText']
MONO = '#000000'

# 字間（フォント単位）。字送りから一律に TRACK を詰め、特定の組だけ KERN で追加調整する。
TRACK = -20
KERN = {
    ('P', 'o'): -40,
    ('o', 'd'): -18,
    ('d', 's'): -8,
    ('s', 'N'): -12,
    ('N', 'o'): -30,
    ('o', 'w'): -28,
}

# 点（ピリオド）。字形ではなく独立した角丸正方形。最後の字の送りの後ろに置く。
DOT_GAP = 28
DOT_SIZE = 240
DOT_RADIUS = 28
DOT_ADVANCE = 280

# 横組みの基準の箱（wordmark-*.svg）。
WORDMARK_W, WORDMARK_H = 670, 130
WORDMARK_LINE = (8, 7, 650)  # (left, top, width)

# アイコンの 2 段組。(left, top, width)。`Now.` は点まで含めた幅を `Pods` とそろえる。
# left / top は 2 行の相対位置（左端の共有と行間）だけに効く。最終的な位置は `two_lines` が
# 実際の描画範囲の中心をキャンバス中心に合わせて決める（字形のサイドベアリングや
# 行間の見込み違いで上下左右にずれないように）。
ICON_LINES = ((155, 220, 714), (155, 521, 714))  # iOS / ストア（マスク無しの全面）
ADAPTIVE_LINES = ((267, 303, 490), (267, 510, 490))  # Android 前景・単色（中央の安全域）
SMALL_LINES = ((135, 214, 754), (135, 535, 754))  # 32px 以下の小サイズ・favicon

# スプラッシュ用の横組み画像（expo-splash-screen の image）。
SPLASH_W, SPLASH_H = 1200, 240
SPLASH_LINE = (20, 20, 1160)

_TOKEN = re.compile(r'[MLHVQZ]|-?\d+(?:\.\d+)?')


def parse(d: str) -> list[list[tuple[str, tuple[float, ...]]]]:
    """SVGPathPen の出力（M/L/H/V/Q/Z の絶対座標）を輪郭ごとのコマンド列にする。"""
    toks = _TOKEN.findall(d)
    contours: list[list[tuple[str, tuple[float, ...]]]] = []
    cur: list[tuple[str, tuple[float, ...]]] = []
    x = y = 0.0
    i = 0
    cmd = ''
    while i < len(toks):
        tk = toks[i]
        if tk.isalpha():
            cmd = tk
            i += 1
            if cmd == 'Z':
                if cur:
                    contours.append(cur)
                cur = []
                continue
        n = {'M': 2, 'L': 2, 'H': 1, 'V': 1, 'Q': 4}[cmd]
        v = [float(t) for t in toks[i : i + n]]
        i += n
        if cmd == 'M':
            x, y = v
            cur = [('M', (x, y))]
            cmd = 'L'
        elif cmd == 'L':
            x, y = v
            cur.append(('L', (x, y)))
        elif cmd == 'H':
            x = v[0]
            cur.append(('L', (x, y)))
        elif cmd == 'V':
            y = v[0]
            cur.append(('L', (x, y)))
        else:
            cur.append(('Q', tuple(v)))
            x, y = v[2], v[3]
    if cur:
        contours.append(cur)
    return contours


def _word(text: str):
    """字を並べる。戻り値は ([(字, x オフセット)], 送りの合計, 上端)。"""
    x = 0
    placed = []
    ymax = 0.0
    for i, ch in enumerate(text):
        if i:
            x += KERN.get((text[i - 1], ch), 0)
        g = GLYPHS[ch]
        placed.append((ch, x))
        ymax = max(ymax, g['bounds'][3])
        x += g['advance'] + TRACK
    return placed, x, ymax


def line(text: str, left: float, top: float, width: float):
    """
    1 行を配置し、キャンバス座標の図形を返す。

    `text` が `.` で終わるときだけ点を付ける。幅 `width` は点まで含めた幅。
    戻り値: {'contours': [[('M'|'L'|'Q', 座標...)...]], 'dot': (x, y, size, radius) | None}
    """
    has_dot = text.endswith('.')
    placed, advance, ymax = _word(text.rstrip('.'))
    s = width / (advance + (DOT_ADVANCE if has_dot else 0))
    base_y = top + ymax * s

    def tx(px: float, py: float) -> tuple[float, float]:
        return left + px * s, base_y - py * s

    out = []
    for ch, ox in placed:
        for contour in parse(GLYPHS[ch]['d']):
            cc = []
            for cmd, v in contour:
                if cmd == 'Q':
                    a = tx(v[0] + ox, v[1])
                    b = tx(v[2] + ox, v[3])
                    cc.append(('Q', (*a, *b)))
                else:
                    cc.append((cmd, tx(v[0] + ox, v[1])))
            out.append(cc)
    dot = None
    if has_dot:
        dx, dy = tx(advance + DOT_GAP, DOT_SIZE)
        dot = (dx, dy, DOT_SIZE * s, DOT_RADIUS * s)
    return {'contours': out, 'dot': dot}


def wordmark(left: float, top: float, width: float):
    return line('PodsNow.', left, top, width)


def shift(lines, dx: float, dy: float):
    """配置済みの行を平行移動する。"""
    out = []
    for ln in lines:
        contours = [
            [(cmd, tuple(c + (dx if i % 2 == 0 else dy) for i, c in enumerate(v))) for cmd, v in contour]
            for contour in ln['contours']
        ]
        dot = None
        if ln['dot']:
            x, y, size, r = ln['dot']
            dot = (x + dx, y + dy, size, r)
        out.append({'contours': contours, 'dot': dot})
    return out


def two_lines(spec, cx: float = CANVAS / 2, cy: float = CANVAS / 2):
    """アイコンの 2 段組。描画範囲（`ink_extent`）の中心を (cx, cy) に合わせる。"""
    (l1, t1, w1), (l2, t2, w2) = spec
    lines = [line('Pods', l1, t1, w1), line('Now.', l2, t2, w2)]
    x0, y0, x1, y1 = ink_extent(lines)
    return shift(lines, cx - (x0 + x1) / 2, cy - (y0 + y1) / 2)


def extent(lines) -> tuple[float, float, float, float]:
    """描画される範囲（x0, y0, x1, y1）。制御点を含むので実際よりわずかに広い（安全側）。"""
    xs: list[float] = []
    ys: list[float] = []
    for ln in lines:
        for contour in ln['contours']:
            for _cmd, v in contour:
                xs += v[0::2]
                ys += v[1::2]
        if ln['dot']:
            x, y, size, _r = ln['dot']
            xs += [x, x + size]
            ys += [y, y + size]
    return min(xs), min(ys), max(xs), max(ys)


def ink_extent(lines) -> tuple[float, float, float, float]:
    """実際に塗られる範囲（x0, y0, x1, y1）。二次曲線は極値を解いて求める（制御点は含めない）。"""
    xs: list[float] = []
    ys: list[float] = []

    def quad_extrema(p0: float, p1: float, p2: float) -> list[float]:
        den = p0 - 2 * p1 + p2
        if den == 0:
            return []
        t = (p0 - p1) / den
        if 0 < t < 1:
            return [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2]
        return []

    for ln in lines:
        for contour in ln['contours']:
            px = py = 0.0
            for cmd, v in contour:
                if cmd == 'Q':
                    xs += [v[2], *quad_extrema(px, v[0], v[2])]
                    ys += [v[3], *quad_extrema(py, v[1], v[3])]
                    px, py = v[2], v[3]
                else:
                    px, py = v
                    xs.append(px)
                    ys.append(py)
        if ln['dot']:
            x, y, size, _r = ln['dot']
            xs += [x, x + size]
            ys += [y, y + size]
    return min(xs), min(ys), max(xs), max(ys)


def max_radius(lines, cx: float = CANVAS / 2, cy: float = CANVAS / 2) -> float:
    """中心からいちばん遠い点までの距離。Android のアダプティブアイコンの安全域の検査に使う。"""
    worst = 0.0
    for ln in lines:
        for contour in ln['contours']:
            for _cmd, v in contour:
                for i in range(0, len(v), 2):
                    worst = max(worst, ((v[i] - cx) ** 2 + (v[i + 1] - cy) ** 2) ** 0.5)
        if ln['dot']:
            x, y, size, _r = ln['dot']
            for px, py in ((x, y), (x + size, y), (x, y + size), (x + size, y + size)):
                worst = max(worst, ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5)
    return worst
