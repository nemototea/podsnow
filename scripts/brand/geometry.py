"""
PodsNow. のロゴタイプとアイコンの幾何定義（DESIGN_SYSTEM.md §3、Issue #235 案 A）。

**ここが図形の正**。SVG・PNG・アプリ内のロゴ（`src/ui/brand/wordmark.ts`）はすべて
この定義から生成するので、互いにずれない。

ロゴはサービス名そのもの `PodsNow.`。Figtree 900 の字形（`glyphs.py`）を並べ、末尾の点だけを
アクセントの色にする。アイコンは `Pods` / `Now.` の 2 段で全文を残す。版ズレ・網点・輪郭線は付けない。

**配置は見本 `docs/design-refresh/ds4/mock.html` の CSS をそのまま計算で再現する。**
見本はブラウザで字を組んでいるので、字送り（カーニング込み）・字間（letter-spacing）・行の高さ
（line-height）・中央寄せの決め方を CSS と同じにする。

- 字間: CSS の letter-spacing は各字の後ろに足す（最後の字の後ろにも足す）。
- 行の箱: 高さは line-height × 字の大きさ。ベースラインは、箱の上端から
  (line-height − (ascent + descent)) / 2 + ascent の位置（half-leading）。
- アイコン: 2 行を左端そろえで積んだ箱（幅は長い方の行、高さは 2 行分）を、キャンバスの中央に置く
  （見本 `.lg-icon` の `place-items: center`）。塗られた範囲の中心ではなく、箱の中心で合わせる。

座標系: 字形はフォント単位（y 上向き）。配置後はキャンバスの px（左上原点・y 下向き）。
"""

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'design'))

import ramps  # noqa: E402
from glyphs import ASCENT, DESCENT, GLYPHS, RUNS, UPM  # noqa: E402

CANVAS = 1024

# 色はトークンの生成元をそのまま読む。ロゴのために別の色を作らない（DESIGN_SYSTEM.md §3.2）。
DARK = ramps.build('dark')
BG = DARK['bg']
INK = DARK['textPrimary']
DOT = DARK['accentSolid']
MONO = '#000000'

# 見本の値（docs/design-refresh/ds4/mock.html）。
# 横組み `.wm`: font-weight 900、letter-spacing -0.045em、line-height 1。
WORDMARK_TRACKING = -0.045
WORDMARK_LINE_HEIGHT = 1.0
# アイコン `.lg-words`: font-size = アイコンの辺 × 0.29、letter-spacing -0.05em、line-height 0.9。
ICON_FONT = 0.29
ICON_TRACKING = -0.05
ICON_LINE_HEIGHT = 0.9

# Android のアダプティブ前景と単色は、中央の安全域に収める（generate.py が検査）。
# 見本に無い形なので、iOS と同じ組み方のまま字の大きさだけを縮める。
ADAPTIVE_FONT = 0.193  # 箱の幅が見える円（直径 683px）に占める割合を iOS（66.6%）とそろえる

# 横組みの SVG と、アプリ内のロゴの字の大きさ（px）。箱は字の大きさ × line-height の高さ。
WORDMARK_FONT = 100
# スプラッシュ用の横組み画像（expo-splash-screen の image）。キャンバスの中央に置く。
SPLASH_W, SPLASH_H = 1200, 240
SPLASH_FONT = 200

DOT_GLYPH = 'period'

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


def run_width(text: str, size: float, tracking: float) -> float:
    """CSS で組んだときの行の幅（px）。字送り（カーニング込み）+ 各字の後ろの letter-spacing。"""
    return sum(adv * size / UPM + tracking * size for _g, adv, _o in RUNS[text])


def baseline_offset(size: float, line_height: float) -> float:
    """行の箱の上端からベースラインまで（px）。CSS の half-leading と同じ計算。"""
    content = (ASCENT + DESCENT) * size / UPM
    return (line_height * size - content) / 2 + ASCENT * size / UPM


def line(text: str, size: float, tracking: float, left: float, baseline: float):
    """
    1 行を配置し、キャンバス座標の図形を返す。点（ピリオド）は字と別の層にする。
    戻り値: {'ink': [輪郭...], 'dot': [輪郭...]}。輪郭は [('M'|'L'|'Q', 座標...)...]。
    """
    s = size / UPM
    ink: list = []
    dot: list = []
    x = left
    for gname, adv, xoff in RUNS[text]:
        ox = x + xoff * s

        def tx(px: float, py: float, ox: float = ox) -> tuple[float, float]:
            return ox + px * s, baseline - py * s

        for contour in parse(GLYPHS[gname]['d']):
            cc = []
            for cmd, v in contour:
                if cmd == 'Q':
                    cc.append(('Q', (*tx(v[0], v[1]), *tx(v[2], v[3]))))
                else:
                    cc.append((cmd, tx(v[0], v[1])))
            (dot if gname == DOT_GLYPH else ink).append(cc)
        x += adv * s + tracking * size
    return {'ink': ink, 'dot': dot}


def wordmark_box(size: float) -> tuple[float, float]:
    """横組みの箱（幅, 高さ）。見本 `.wm` の span の大きさ。"""
    return run_width('PodsNow.', size, WORDMARK_TRACKING), WORDMARK_LINE_HEIGHT * size


def wordmark(size: float, left: float = 0.0, top: float = 0.0):
    """横組み `PodsNow.` を、箱の左上を (left, top) に置いて配置する。"""
    return [line('PodsNow.', size, WORDMARK_TRACKING, left, top + baseline_offset(size, WORDMARK_LINE_HEIGHT))]


def wordmark_centered(width: float, height: float, size: float):
    """横組みを、箱の中心がキャンバスの中心に来るように置く（スプラッシュ）。"""
    w, h = wordmark_box(size)
    return wordmark(size, (width - w) / 2, (height - h) / 2)


def two_lines(font_ratio: float = ICON_FONT, canvas: float = CANVAS):
    """
    アイコンの 2 段組（見本 `.lg-icon` / `.lg-words`）。
    2 行を左端そろえで積んだ箱を、キャンバスの中央に置く。
    """
    size = canvas * font_ratio
    w = max(run_width('Pods', size, ICON_TRACKING), run_width('Now.', size, ICON_TRACKING))
    h = 2 * ICON_LINE_HEIGHT * size
    left = (canvas - w) / 2
    top = (canvas - h) / 2
    first = top + baseline_offset(size, ICON_LINE_HEIGHT)
    second = first + ICON_LINE_HEIGHT * size
    return [
        line('Pods', size, ICON_TRACKING, left, first),
        line('Now.', size, ICON_TRACKING, left, second),
    ]


def layers(lines):
    """描く順の層（字 → 点）。各層は render.polygons / render.svg_layers がそのまま塗れる行の列。"""
    return {
        'ink': [{'contours': ln['ink'], 'dot': None} for ln in lines],
        'dot': [{'contours': ln['dot'], 'dot': None} for ln in lines],
    }


def _points(lines):
    for ln in lines:
        for contour in ln['ink'] + ln['dot']:
            for _cmd, v in contour:
                for i in range(0, len(v), 2):
                    yield v[i], v[i + 1]


def extent(lines) -> tuple[float, float, float, float]:
    """描画される範囲（x0, y0, x1, y1）。制御点を含むので実際よりわずかに広い（安全側）。"""
    pts = list(_points(lines))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def max_radius(lines, cx: float = CANVAS / 2, cy: float = CANVAS / 2) -> float:
    """中心からいちばん遠い点までの距離。Android の安全域の検査に使う（制御点を含むので安全側）。"""
    return max(((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 for x, y in _points(lines))
