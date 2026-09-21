#!/usr/bin/env python3
"""
sRGB <-> OKLab / OKLCh の変換と WCAG コントラスト比。標準ライブラリだけで動く。

ランプを目分量で作らないためにここに置く。値は `ramps.py` が決め、
`generate.py` が `src/ui/tokens/palette.ts` に書き出す。

出典（【確認済み】）:
- OKLab の行列: https://bottosson.github.io/posts/oklab/
- WCAG 2.2 相対輝度とコントラスト比: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
"""

import math

# ---------------------------------------------------------------- sRGB <-> 線形

def _to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _to_gamma(c: float) -> float:
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def hex_to_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip('#')
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def rgb_to_hex(rgb: tuple[float, float, float]) -> str:
    return '#' + ''.join(f'{round(max(0.0, min(1.0, v)) * 255):02X}' for v in rgb)


# ---------------------------------------------------------------- OKLab

def rgb_to_oklab(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    r, g, b = (_to_linear(v) for v in rgb)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def oklab_to_rgb(lab: tuple[float, float, float]) -> tuple[float, float, float]:
    L, a, b = lab
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = (v**3 for v in (l_, m_, s_))
    return (
        _to_gamma(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        _to_gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        _to_gamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    )


def oklch(hex_color: str) -> tuple[float, float, float]:
    """hex -> (L, C, h)。L は 0..1、h は度。"""
    L, a, b = rgb_to_oklab(hex_to_rgb(hex_color))
    return L, math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360


def in_gamut(L: float, C: float, h: float) -> bool:
    rgb = oklab_to_rgb((L, C * math.cos(math.radians(h)), C * math.sin(math.radians(h))))
    return all(-0.0005 <= v <= 1.0005 for v in rgb)


def to_hex(L: float, C: float, h: float) -> str:
    """OKLCh を sRGB の hex にする。範囲外なら彩度だけ落として収める（色相と明度は保つ）。"""
    lo, hi = 0.0, C
    if not in_gamut(L, C, h):
        for _ in range(40):
            mid = (lo + hi) / 2
            if in_gamut(L, mid, h):
                lo = mid
            else:
                hi = mid
        C = lo
    rad = math.radians(h)
    return rgb_to_hex(oklab_to_rgb((L, C * math.cos(rad), C * math.sin(rad))))


# ---------------------------------------------------------------- WCAG

def luminance(hex_color: str) -> float:
    r, g, b = (_to_linear(v) for v in hex_to_rgb(hex_color))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    if la < lb:
        la, lb = lb, la
    return (la + 0.05) / (lb + 0.05)
