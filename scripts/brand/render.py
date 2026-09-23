"""
PNG ラスタライザと SVG 書き出し（Python 標準ライブラリのみ）。

ロゴの輪郭（直線と 2 次ベジェ）を折れ線に分割し、非ゼロ規則で塗る。1 px を縦に
SUB 本の走査線で標本化し、横方向は区間の長さから被覆率を解析的に出してアンチエイリアスする。
"""

import struct
import zlib

SUB = 8
QUAD_STEPS = 12


def hex_rgb(s: str) -> tuple[int, int, int]:
    s = s.lstrip('#')
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


# ---------------------------------------------------------------- 図形 → 辺


def _flatten(contour, k: float) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    x = y = 0.0
    for cmd, v in contour:
        if cmd in ('M', 'L'):
            x, y = v[0] * k, v[1] * k
            pts.append((x, y))
        else:
            cx, cy, ex, ey = (c * k for c in v)
            for i in range(1, QUAD_STEPS + 1):
                t = i / QUAD_STEPS
                a = (1 - t) * (1 - t)
                b = 2 * (1 - t) * t
                c = t * t
                pts.append((a * x + b * cx + c * ex, a * y + b * cy + c * ey))
            x, y = ex, ey
    return pts


def _rounded_rect(x: float, y: float, size: float, r: float, k: float):
    """角丸正方形を折れ線にする（時計回り。字形と同じ向きでなくても非ゼロ規則なら塗れる）。"""
    import math

    x, y, size, r = x * k, y * k, size * k, r * k
    pts = []
    corners = ((x + size - r, y + r, -90), (x + size - r, y + size - r, 0),
               (x + r, y + size - r, 90), (x + r, y + r, 180))
    for cx, cy, start in corners:
        for i in range(QUAD_STEPS + 1):
            a = math.radians(start + 90 * i / QUAD_STEPS)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def _edges(polys):
    edges = []
    for pts in polys:
        n = len(pts)
        for i in range(n):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % n]
            if y0 == y1:
                continue
            w = 1
            if y0 > y1:
                x0, y0, x1, y1 = x1, y1, x0, y0
                w = -1
            edges.append((y0, y1, x0, (x1 - x0) / (y1 - y0), w))
    edges.sort()
    return edges


def polygons(lines, k: float):
    """配置済みの行（geometry.line の戻り値）を、出力 px の多角形の列にする。"""
    out = []
    for ln in lines:
        for contour in ln['contours']:
            out.append(_flatten(contour, k))
        if ln['dot']:
            out.append(_rounded_rect(*ln['dot'], k))
    return out


# ---------------------------------------------------------------- 塗り


def coverage(polys, width: int, height: int) -> list[list[float]]:
    edges = _edges(polys)
    rows = [[0.0] * width for _ in range(height)]
    active: list = []
    ei = 0
    for py in range(height):
        row = rows[py]
        for sub in range(SUB):
            sy = py + (sub + 0.5) / SUB
            while ei < len(edges) and edges[ei][0] <= sy:
                active.append(edges[ei])
                ei += 1
            active = [e for e in active if e[1] > sy]
            xs = sorted(
                (e[2] + (sy - e[0]) * e[3], e[4]) for e in active if e[0] <= sy < e[1]
            )
            wind = 0
            for i in range(len(xs) - 1):
                wind += xs[i][1]
                if wind == 0:
                    continue
                a = max(0.0, xs[i][0])
                b = min(float(width), xs[i + 1][0])
                if b <= a:
                    continue
                ia, ib = int(a), int(b)
                if ia == ib:
                    row[ia] += (b - a) / SUB
                    continue
                row[ia] += (ia + 1 - a) / SUB
                for x in range(ia + 1, min(ib, width)):
                    row[x] += 1.0 / SUB
                if ib < width:
                    row[ib] += (b - ib) / SUB
    return rows


def compose(layers, width: int, height: int, background: str | None):
    """
    layers: [(polys, color)]。上に重ねるほど後ろ。`background` が None なら RGBA（透過）。
    """
    covs = [(coverage(p, width, height), hex_rgb(c)) for p, c in layers]
    bg = hex_rgb(background) if background else None
    out = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            r = g = b = 0.0
            a = 0.0
            for cov, col in covs:
                c = min(1.0, cov[y][x])
                if c <= 0.0:
                    continue
                r = col[0] * c + r * (1 - c)
                g = col[1] * c + g * (1 - c)
                b = col[2] * c + b * (1 - c)
                a = c + a * (1 - c)
            if bg:
                row += bytes(
                    round(max(0.0, min(255.0, ch + bgc * (1 - a))))
                    for ch, bgc in zip((r, g, b), bg)
                )
            elif a <= 0.0:
                row += b'\x00\x00\x00\x00'
            else:
                row += bytes(round(max(0.0, min(255.0, ch / a))) for ch in (r, g, b))
                row.append(round(a * 255))
        out.append(bytes(row))
    return out


def solid(width: int, height: int, color: str, with_alpha: bool = True):
    r, g, b = hex_rgb(color)
    px = bytes([r, g, b, 255]) if with_alpha else bytes([r, g, b])
    return [px * width for _ in range(height)]


def write_png(path: str, rows, width: int, height: int, has_alpha: bool) -> None:
    """最小限の PNG ライタ（8bit / RGB または RGBA / 非インタレース）。"""
    color_type = 6 if has_alpha else 2
    raw = b''.join(b'\x00' + r for r in rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, color_type, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


# ---------------------------------------------------------------- SVG


def _num(v: float) -> str:
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    return '0' if s == '-0' else s


def path_d(lines) -> str:
    """字形の輪郭を 1 本の path にする（点は別の rect）。"""
    parts = []
    for ln in lines:
        for contour in ln['contours']:
            for cmd, v in contour:
                parts.append(cmd + ' '.join(_num(c) for c in v))
            parts.append('Z')
    return ''.join(parts)


def svg(width: int, height: int, groups, background: str | None = None, title='PodsNow.') -> str:
    """groups: [(lines, 字の色, 点の色)]。"""
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-label="{title}">',
        f'  <title>{title}</title>',
        '  <!-- scripts/brand/generate.py が生成。直接編集せず geometry.py を直すこと。 -->',
    ]
    if background:
        out.append(f'  <rect width="{width}" height="{height}" fill="{background}"/>')
    for lines, ink, dot_color in groups:
        out.append(f'  <path fill="{ink}" d="{path_d(lines)}"/>')
        for ln in lines:
            if ln['dot']:
                x, y, size, r = ln['dot']
                out.append(
                    f'  <rect x="{_num(x)}" y="{_num(y)}" width="{_num(size)}" '
                    f'height="{_num(size)}" rx="{_num(r)}" fill="{dot_color}"/>'
                )
    out.append('</svg>')
    return '\n'.join(out) + '\n'
