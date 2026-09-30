#!/usr/bin/env python3
"""
アプリアイコン・スプラッシュ・favicon・ロゴの SVG と、アプリ内ロゴのデータを生成する
（DESIGN_SYSTEM.md §3、Issue #94 / #190）。

    python3 scripts/brand/generate.py

図形の定義は `geometry.py`（字形は `glyphs.py`）だけ。Python 標準ライブラリしか使わない。
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import geometry as g  # noqa: E402
import render as r  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
IMAGES = os.path.join(ROOT, 'assets', 'images')
BRAND = os.path.join(ROOT, 'assets', 'brand')
APP_WORDMARK = os.path.join(ROOT, 'src', 'ui', 'brand', 'wordmark.ts')
APP_JSON = os.path.join(ROOT, 'app.json')

# Android のアダプティブアイコンで見えることが保証される半径（前景 108dp の中央 66dp 相当）。
ADAPTIVE_SAFE_RADIUS = g.CANVAS * 0.66 / 2

# Android 12+ のスプラッシュ（SplashScreen API）。expo-splash-screen は画像を imageWidth（dp）の
# 正方形に contain で収め、288dp の枠の中央に置く。背景なしのアイコンは直径 192dp の円で切り抜かれる。
# 横長のロゴは幅だけでなく四隅がこの円に収まる必要がある。余白を 6dp 見込む。
ANDROID_SPLASH_SAFE_RADIUS_DP = 192 / 2 - 6


def stack(lines, ink, shadow=None, dot=None, edge=None):
    """層（下から 版ズレ → 字 → 点の輪郭 → 点）と色の組。色が None の層は描かない。"""
    ls = g.layers(lines, misreg=shadow is not None, edge=edge is not None)
    out = []
    if shadow:
        out.append((ls['shadow'], shadow))
    out.append((ls['ink'], ink))
    if edge:
        out.append((ls['edge'], edge))
    out.append((ls['dot'], dot or ink))
    return out


def png(name, stacked, size, background, scale_from=g.CANVAS, height=None, dots=None):
    w = size
    h = height or size
    k = w / scale_from
    layers = []
    if dots:
        layers.append((r.circles(dots[0], k), dots[1]))
    layers += [(r.polygons(lines, k), color) for lines, color in stacked]
    rows = r.compose(layers, w, h, background)
    path = os.path.join(IMAGES, name)
    r.write_png(path, rows, w, h, background is None)
    print('書き出し', os.path.relpath(path, ROOT), f'({w}x{h})')


def write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    print('書き出し', os.path.relpath(path, ROOT))


def app_wordmark() -> str:
    lines = [g.wordmark(*g.WORDMARK_LINE)]
    x, y, size, rad = lines[0]['dot']
    dx, dy = lines[0]['misreg']
    data = {
        'width': g.WORDMARK_W,
        'height': g.WORDMARK_H,
        'd': r.path_d(lines),
        'misreg': {'dx': round(dx, 2), 'dy': round(dy, 2)},
        'dot': {
            'x': round(x, 2),
            'y': round(y, 2),
            'size': round(size, 2),
            'r': round(rad, 2),
            'edge': round(lines[0]['edge'], 2),
        },
    }
    return (
        '// scripts/brand/generate.py が生成。直接編集せず scripts/brand/geometry.py を直すこと。\n'
        f'export const wordmark = {json.dumps(data, ensure_ascii=False)} as const;\n'
    )


def splash_plugin() -> dict:
    with open(APP_JSON, encoding='utf-8') as f:
        cfg = json.load(f)['expo']
    for p in cfg.get('plugins', []):
        if isinstance(p, list) and p[0] == 'expo-splash-screen':
            return p[1]
    return {}


def android_splash_radius_dp() -> tuple[float, float]:
    """Android のスプラッシュで、ロゴの中心からいちばん遠い点までの距離（dp）と imageWidth。"""
    opts = splash_plugin()
    width = opts.get('android', {}).get('imageWidth', opts.get('imageWidth', 100))
    splash = [g.wordmark(*g.SPLASH_LINE)]
    rad = g.max_radius(splash, g.SPLASH_W / 2, g.SPLASH_H / 2)
    # contain なので長辺（幅）が imageWidth になる。
    return rad * width / max(g.SPLASH_W, g.SPLASH_H), width


def check_app_json() -> list[str]:
    with open(APP_JSON, encoding='utf-8') as f:
        cfg = json.load(f)['expo']
    want = {
        'android.adaptiveIcon.backgroundColor': (cfg['android']['adaptiveIcon']['backgroundColor'], g.ICON_BG),
        'splash.backgroundColor': (cfg['splash']['backgroundColor'], g.LIGHT_BG),
        'splash.dark.backgroundColor': (cfg['splash']['dark']['backgroundColor'], g.BG),
    }
    for p in cfg.get('plugins', []):
        if isinstance(p, list) and p[0] == 'expo-splash-screen':
            want['expo-splash-screen.backgroundColor'] = (p[1]['backgroundColor'], g.LIGHT_BG)
            want['expo-splash-screen.dark.backgroundColor'] = (p[1]['dark']['backgroundColor'], g.BG)
    return [f'app.json {k} = {got}（期待 {exp}）' for k, (got, exp) in want.items() if got.upper() != exp.upper()]


def main() -> int:
    adaptive = g.two_lines(g.ADAPTIVE_LINES)
    rad = g.max_radius(adaptive)
    print(f'前景の最大描画半径: {rad:.0f}px（アダプティブ安全域 {ADAPTIVE_SAFE_RADIUS:.0f}px）')
    if rad > ADAPTIVE_SAFE_RADIUS:
        print('  ! 前景がアダプティブアイコンのマスクで欠ける。ADAPTIVE_LINES を縮めること。')
        return 1
    srad, swidth = android_splash_radius_dp()
    print(
        f'Android スプラッシュのロゴ最大半径: {srad:.0f}dp（imageWidth {swidth}dp、'
        f'安全域 {ANDROID_SPLASH_SAFE_RADIUS_DP:.0f}dp）'
    )
    if srad > ANDROID_SPLASH_SAFE_RADIUS_DP:
        print('  ! Android 12+ のスプラッシュでロゴが円形マスクに欠ける。')
        print('    app.json の expo-splash-screen の android.imageWidth を小さくすること。')
        return 1
    for name, spec in (('iOS', g.ICON_LINES), ('小サイズ', g.SMALL_LINES)):
        x0, y0, x1, y1 = g.extent(g.two_lines(spec))
        if x0 < 0 or y0 < 0 or x1 > g.CANVAS or y1 > g.CANVAS:
            print(f'  ! {name}のアイコンがキャンバスからはみ出す')
            return 1
    bad = check_app_json()
    if bad:
        for m in bad:
            print('  !', m)
        print('app.json の色をトークンに合わせること。')
        return 1

    icon = g.two_lines(g.ICON_LINES)
    small = g.two_lines(g.SMALL_LINES)
    mark = [g.wordmark(*g.WORDMARK_LINE)]
    splash = [g.wordmark(*g.SPLASH_LINE)]
    dots = (g.halftone(), g.HALFTONE)

    # 横組み（§3.2）。ライトの黄の点だけ墨の輪郭を付ける。
    mark_dark = stack(mark, g.INK, g.SHADOW, g.DOT)
    mark_light = stack(mark, g.LIGHT_INK, g.LIGHT_SHADOW, g.LIGHT_DOT, g.EDGE)
    mark_mono = stack(mark, g.MONO)
    # アイコン。網点は 60px 以下では描かない。版ズレは 32px 以下（icon-small）では描かない。
    icon_full = stack(icon, g.ICON_INK, g.ICON_SHADOW, g.LIGHT_DOT, g.EDGE)
    icon_small = stack(small, g.ICON_INK, None, g.LIGHT_DOT, g.EDGE)
    icon_favicon = stack(small, g.ICON_INK, g.ICON_SHADOW, g.LIGHT_DOT, g.EDGE)
    fg = stack(adaptive, g.ICON_INK, g.ICON_SHADOW, g.LIGHT_DOT, g.EDGE)
    mono = stack(adaptive, g.MONO)

    W, H = g.WORDMARK_W, g.WORDMARK_H
    C = g.CANVAS
    write(os.path.join(BRAND, 'wordmark-dark.svg'), r.svg_layers(W, H, mark_dark))
    write(os.path.join(BRAND, 'wordmark-light.svg'), r.svg_layers(W, H, mark_light))
    write(os.path.join(BRAND, 'wordmark-mono.svg'), r.svg_layers(W, H, mark_mono))
    write(os.path.join(BRAND, 'app-icon.svg'), r.svg_layers(C, C, icon_full, g.ICON_BG, dots))
    write(os.path.join(BRAND, 'icon-small.svg'), r.svg_layers(C, C, icon_small, g.ICON_BG))
    write(os.path.join(BRAND, 'android-foreground.svg'), r.svg_layers(C, C, fg))
    write(os.path.join(BRAND, 'android-monochrome.svg'), r.svg_layers(C, C, mono))
    write(APP_WORDMARK, app_wordmark())

    png('icon.png', icon_full, 1024, g.ICON_BG, dots=dots)
    png('android-icon-foreground.png', fg, 1024, None)
    png('android-icon-monochrome.png', mono, 1024, None)
    png('favicon.png', icon_favicon, 48, g.ICON_BG)
    png('splash-icon-light.png', stack(splash, g.LIGHT_INK, g.LIGHT_SHADOW, g.LIGHT_DOT, g.EDGE), g.SPLASH_W, None, g.SPLASH_W, g.SPLASH_H)
    png('splash-icon.png', stack(splash, g.INK, g.SHADOW, g.DOT), g.SPLASH_W, None, g.SPLASH_W, g.SPLASH_H)
    png('android-icon-background.png', [], 1024, g.ICON_BG, dots=dots)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
