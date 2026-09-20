"""
PNG ラスタライザ（Python 標準ライブラリのみ、Issue #82）。

図形は SDF（符号付き距離関数）で表し、距離からそのままカバレッジを出して
アンチエイリアスする。アイコンに必要な図形（カプセル・角丸長方形・下半分のリング）
だけを扱う最小実装で、外部依存を増やさずに済ませるためのもの。

速度のために、図形ごとにバウンディングボックス内だけを走査する。
1024px でも図形は数百 k ピクセルしか覆わないので、純 Python でも一瞬で終わる。
"""

import math
import struct
import zlib


def hex_rgb(s: str) -> tuple[int, int, int]:
    s = s.lstrip('#')
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


# --- SDF（負なら内側、単位はソース座標の px） -------------------------------


def _sd_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    vv = vx * vx + vy * vy
    t = 0.0 if vv == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / vv))
    dx, dy = wx - t * vx, wy - t * vy
    return math.hypot(dx, dy)


def _sd_capsule(px, py, s) -> float:
    return _sd_segment(px, py, s['x0'], s['y0'], s['x1'], s['y1']) - s['r']


def _sd_rect(px, py, s) -> float:
    r = s['r']
    hw = (s['x1'] - s['x0']) / 2 - r
    hh = (s['y1'] - s['y0']) / 2 - r
    cx = (s['x0'] + s['x1']) / 2
    cy = (s['y0'] + s['y1']) / 2
    qx = abs(px - cx) - hw
    qy = abs(py - cy) - hh
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def _sd_arc_bottom(px, py, s) -> float:
    """下半分だけのリング。リングと半平面 y >= cy の共通部分。"""
    ring = abs(math.hypot(px - s['cx'], py - s['cy']) - s['r']) - s['w'] / 2
    return max(ring, s['cy'] - py)


_SDF = {'capsule': _sd_capsule, 'rect': _sd_rect, 'arc_bottom': _sd_arc_bottom}


def _bbox(s) -> tuple[float, float, float, float]:
    """ソース座標でのバウンディングボックス。"""
    if s['kind'] == 'capsule':
        return (
            min(s['x0'], s['x1']) - s['r'],
            min(s['y0'], s['y1']) - s['r'],
            max(s['x0'], s['x1']) + s['r'],
            max(s['y0'], s['y1']) + s['r'],
        )
    if s['kind'] == 'arc_bottom':
        outer = s['r'] + s['w'] / 2
        return (s['cx'] - outer, s['cy'] - s['w'] / 2, s['cx'] + outer, s['cy'] + outer)
    return (s['x0'], s['y0'], s['x1'], s['y1'])


def _accumulate(cov, shapes, size: int, scale: float, accent: bool) -> None:
    """
    該当する図形のカバレッジを `cov`（size*size の float 配列）へ max 合成する。

    カバレッジは距離から解析的に求める（`0.5 - d/scale`）。出力 1px がソースの
    scale px に当たるので scale で割ると、縮小しても同じ見た目の縁になる。
    """
    for s in shapes:
        if bool(s.get('accent')) != accent:
            continue
        sdf = _SDF[s['kind']]
        x0, y0, x1, y1 = _bbox(s)
        # 縁の 1px 分だけ広げてから出力座標へ
        px0 = max(0, int((x0 - scale) / scale))
        py0 = max(0, int((y0 - scale) / scale))
        px1 = min(size - 1, int((x1 + scale) / scale) + 1)
        py1 = min(size - 1, int((y1 + scale) / scale) + 1)
        for y in range(py0, py1 + 1):
            sy = (y + 0.5) * scale
            row = y * size
            for x in range(px0, px1 + 1):
                d = sdf((x + 0.5) * scale, sy, s)
                c = 0.5 - d / scale
                if c <= 0.0:
                    continue
                if c > 1.0:
                    c = 1.0
                i = row + x
                if c > cov[i]:
                    cov[i] = c


def render(shapes, size: int, source_size: int, base_color, accent_color, background):
    """
    図形を size x size に描く。

    `background` が None なら透過（RGBA 用）、色を渡すと不透明（RGB 用）。
    """
    scale = source_size / size
    base = hex_rgb(base_color)
    acc = hex_rgb(accent_color)
    bg = hex_rgb(background) if background else (0, 0, 0)

    n = size * size
    cov_base = [0.0] * n
    cov_acc = [0.0] * n
    _accumulate(cov_base, shapes, size, scale, accent=False)
    _accumulate(cov_acc, shapes, size, scale, accent=True)

    rows = []
    for y in range(size):
        row = bytearray()
        base_row = y * size
        for x in range(size):
            i = base_row + x
            cb = cov_base[i]
            ca = cov_acc[i] * (1.0 - cb)  # アクセントは本体の上に重ねる
            alpha = cb + ca
            if alpha <= 0.0:
                row += bytes(bg) if background else b'\x00\x00\x00\x00'
                continue
            if background:
                for k in range(3):
                    v = base[k] * cb + acc[k] * ca + bg[k] * (1.0 - alpha)
                    row.append(round(max(0.0, min(255.0, v))))
            else:
                for k in range(3):
                    v = (base[k] * cb + acc[k] * ca) / alpha
                    row.append(round(max(0.0, min(255.0, v))))
                row.append(round(max(0.0, min(255.0, alpha * 255.0))))
        rows.append(bytes(row))
    return rows


def solid(size: int, color: str, with_alpha: bool = True):
    r, g, b = hex_rgb(color)
    px = bytes([r, g, b, 255]) if with_alpha else bytes([r, g, b])
    return [px * size for _ in range(size)]


def write_png(path: str, rows, size: int, has_alpha: bool) -> None:
    """最小限の PNG ライタ（8bit / RGB または RGBA / 非インタレース）。"""
    color_type = 6 if has_alpha else 2
    raw = b''.join(b'\x00' + r for r in rows)  # filter type 0（フィルタなし）

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, color_type, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
