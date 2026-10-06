"""
PodsNow. のロゴタイプとアイコンの幾何定義（DESIGN_SYSTEM.md §3、Issue #94 / #190）。

**ここが図形の正**。SVG・PNG・アプリ内のロゴ（`src/ui/brand/wordmark.ts`）はすべて
この定義から生成するので、互いにずれない。

ロゴはサービス名そのもの `PodsNow.`。Dela Gothic One の字形（`glyphs.py`）を
土台に字間を光学調整し、末尾の点を独立した角丸正方形として描く。文字には版ズレ（右下へ
ずらした同じ形の影）を付ける。アイコンは `Pods` / `Now.` の 2 段で全文を残し、縦横とも
中央に置く。地はリソの青に紙の色の網点。マイク・波形・雪・電波・頭文字だけのマークは使わない
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

# 色はトークンの生成元をそのまま読む。ロゴのために別の色を作らない（DESIGN_SYSTEM.md §3.2）。
DARK = ramps.build('dark')
if 'light' not in ramps.THEMES:
    # Issue #235 でテーマがダーク 1 つになった。このスクリプトは Design system 3 のロゴ（ライトの色を使う）を
    # 描くので、作業 4 で書き直すまで動かさない。生成物（assets/brand、assets/images）はコミット済みのものを使う。
    sys.exit('scripts/brand は Issue #235 の作業 4 で書き直すまで実行できない（テーマがダーク 1 つになったため）')
LIGHT = ramps.build('light')
BG = DARK['bg']
INK = DARK['brandInk']
SHADOW = DARK['brandShadow']
DOT = DARK['brandAccent']
LIGHT_BG = LIGHT['bg']
LIGHT_INK = LIGHT['brandInk']
LIGHT_SHADOW = LIGHT['brandShadow']
LIGHT_DOT = LIGHT['brandAccent']
# 黄の点はライトの紙の上で 3:1 を持てないので墨の輪郭と組にする。
EDGE = LIGHT['controlBorder']
# アイコンはテーマに関係なく同じ絵（リソの青の地に紙の色の文字）。
ICON_BG = LIGHT['accentSolid']
ICON_INK = LIGHT['bg']
ICON_SHADOW = LIGHT['brandShadow']
MONO = '#000000'


def _blend(fg: str, bg: str, a: float) -> str:
    """画像の中だけで使う不透明な中間色（網点）。UI のトークンには使わない（§5.5）。"""
    f = [int(fg[i : i + 2], 16) for i in (1, 3, 5)]
    b = [int(bg[i : i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x * a + y * (1 - a)):02X}' for x, y in zip(f, b))


# アイコンの網点。紙の色を 28% だけ青に混ぜた色の円を、20 x 20 の格子に置く。
HALFTONE = _blend(ICON_INK, ICON_BG, 0.28)
HALFTONE_PITCH = CANVAS / 20
HALFTONE_R = 9.0

# 字間（フォント単位、unitsPerEm = 1000）。字送りから一律に TRACK を詰め、特定の組だけ KERN で追加調整する。
TRACK = -12
KERN = {
    ('P', 'o'): -36,
    ('o', 'd'): -6,
    ('d', 's'): -4,
    ('s', 'N'): -2,
    ('N', 'o'): -14,
    ('o', 'w'): -18,
}

# 点（ピリオド）。字形ではなく独立した角丸正方形。最後の字の送りの後ろに置く。
# 輪郭（EDGE）の太さは内側に取る。
DOT_GAP = 22
DOT_SIZE = 210
DOT_RADIUS = 28
DOT_EDGE = 36
DOT_ADVANCE = 232

# 版ズレ（フォント単位）。原案の text-shadow 4px 3px / 64px を字の大きさに比例させる。
MISREG = (62, 47)

# 横組みの基準の箱（wordmark-*.svg）。版ズレの分だけ右下に余白を取る。
WORDMARK_W, WORDMARK_H = 654, 106
WORDMARK_LINE = (4, 4, 640)  # (left, top, width)

# アイコンの 2 段組。(left, top, width)。`Now.` は点まで含めた幅を `Pods` とそろえる。
# left / top は 2 行の相対位置（左端の共有と行間）だけに効く。最終的な位置は `two_lines` が
# 実際の描画範囲の中心をキャンバス中心に合わせて決める（字形のサイドベアリングや
# 行間の見込み違いで上下左右にずれないように）。
ICON_LINES = ((155, 220, 714), (155, 488, 714))  # iOS / ストア（マスク無しの全面）
ADAPTIVE_LINES = ((267, 303, 490), (267, 487, 490))  # Android 前景・単色（中央の安全域）
SMALL_LINES = ((135, 214, 754), (135, 500, 754))  # 32px 以下の小サイズ・favicon

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
    戻り値: {'contours': [[('M'|'L'|'Q', 座標...)...]], 'dot': (x, y, size, radius) | None,
            'misreg': (dx, dy), 'edge': 点の輪郭の太さ}
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
    return {'contours': out, 'dot': dot, 'misreg': (MISREG[0] * s, MISREG[1] * s), 'edge': DOT_EDGE * s}


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
        out.append({**ln, 'contours': contours, 'dot': dot})
    return out


def layers(lines, misreg: bool = True, edge: bool = True):
    """
    描く順の層に分ける。各層は `line` と同じ形の行の列（render.polygons がそのまま塗れる）。
    戻り値: {'shadow': 版ズレ, 'ink': 字, 'edge': 点の輪郭, 'dot': 点}。使わない層は空。
    """
    ink = [{'contours': ln['contours'], 'dot': None} for ln in lines]
    shadow = []
    if misreg:
        for ln in lines:
            dx, dy = ln['misreg']
            shadow += shift([{'contours': ln['contours'], 'dot': None}], dx, dy)
    edges, dots = [], []
    for ln in lines:
        if not ln['dot']:
            continue
        x, y, size, r = ln['dot']
        if edge:
            e = ln['edge']
            edges.append({'contours': [], 'dot': (x, y, size, r)})
            dots.append({'contours': [], 'dot': (x + e, y + e, size - 2 * e, max(0.0, r - e / 2))})
        else:
            dots.append({'contours': [], 'dot': (x, y, size, r)})
    return {'shadow': shadow, 'ink': ink, 'edge': edges, 'dot': dots}


def halftone(size: float = CANVAS):
    """網点の円（cx, cy, r）の列。"""
    n = round(size / HALFTONE_PITCH)
    return [
        ((i + 0.5) * HALFTONE_PITCH, (j + 0.5) * HALFTONE_PITCH, HALFTONE_R)
        for j in range(n)
        for i in range(n)
    ]


def two_lines(spec, cx: float = CANVAS / 2, cy: float = CANVAS / 2):
    """アイコンの 2 段組。描画範囲（`ink_extent`）の中心を (cx, cy) に合わせる。"""
    (l1, t1, w1), (l2, t2, w2) = spec
    lines = [line('Pods', l1, t1, w1), line('Now.', l2, t2, w2)]
    x0, y0, x1, y1 = ink_extent(lines)
    return shift(lines, cx - (x0 + x1) / 2, cy - (y0 + y1) / 2)


def extent(lines) -> tuple[float, float, float, float]:
    """描画される範囲（x0, y0, x1, y1）。制御点と版ズレを含むので実際よりわずかに広い（安全側）。"""
    xs: list[float] = []
    ys: list[float] = []
    for ln in lines:
        dx, dy = ln.get('misreg', (0.0, 0.0))
        for contour in ln['contours']:
            for _cmd, v in contour:
                xs += v[0::2]
                ys += v[1::2]
                xs += [c + dx for c in v[0::2]]
                ys += [c + dy for c in v[1::2]]
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
    """中心からいちばん遠い点までの距離（版ズレを含む）。Android の安全域の検査に使う。"""
    worst = 0.0
    for ln in lines:
        dx, dy = ln.get('misreg', (0.0, 0.0))
        for contour in ln['contours']:
            for _cmd, v in contour:
                for i in range(0, len(v), 2):
                    for ox, oy in ((0.0, 0.0), (dx, dy)):
                        px, py = v[i] + ox, v[i + 1] + oy
                        worst = max(worst, ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5)
        if ln['dot']:
            x, y, size, _r = ln['dot']
            for px, py in ((x, y), (x + size, y), (x, y + size), (x + size, y + size)):
                worst = max(worst, ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5)
    return worst
