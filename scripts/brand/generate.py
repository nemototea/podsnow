#!/usr/bin/env python3
"""
アプリアイコン・スプラッシュ・favicon・ロゴの SVG と、アプリ内ロゴのデータを生成する
（DESIGN_SYSTEM.md §3、Issue #94）。

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


def split(lines):
    """字と点を別の層にする（色が違うため）。"""
    ink = [{'contours': ln['contours'], 'dot': None} for ln in lines]
    dots = [{'contours': [], 'dot': ln['dot']} for ln in lines if ln['dot']]
    return ink, dots


def png(name, lines, size, ink, dot, background, scale_from=g.CANVAS, height=None):
    w = size
    h = height or size
    k = w / scale_from
    a, b = split(lines)
    rows = r.compose([(r.polygons(a, k), ink), (r.polygons(b, k), dot)], w, h, background)
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
    data = {
        'width': g.WORDMARK_W,
        'height': g.WORDMARK_H,
        'd': r.path_d(lines),
        'dot': {'x': round(x, 2), 'y': round(y, 2), 'size': round(size, 2), 'r': round(rad, 2)},
    }
    return (
        '// scripts/brand/generate.py が生成。直接編集せず scripts/brand/geometry.py を直すこと。\n'
        f'export const wordmark = {json.dumps(data, ensure_ascii=False)} as const;\n'
    )


def check_app_json() -> list[str]:
    with open(APP_JSON, encoding='utf-8') as f:
        cfg = json.load(f)['expo']
    want = {
        'android.adaptiveIcon.backgroundColor': (cfg['android']['adaptiveIcon']['backgroundColor'], g.ICON_BG),
        'splash.backgroundColor': (cfg['splash']['backgroundColor'], g.BG),
    }
    for p in cfg.get('plugins', []):
        if isinstance(p, list) and p[0] == 'expo-splash-screen':
            want['expo-splash-screen.backgroundColor'] = (p[1]['backgroundColor'], g.BG)
    return [f'app.json {k} = {got}（期待 {exp}）' for k, (got, exp) in want.items() if got.upper() != exp.upper()]


def main() -> int:
    adaptive = g.two_lines(g.ADAPTIVE_LINES)
    rad = g.max_radius(adaptive)
    print(f'前景の最大描画半径: {rad:.0f}px（アダプティブ安全域 {ADAPTIVE_SAFE_RADIUS:.0f}px）')
    if rad > ADAPTIVE_SAFE_RADIUS:
        print('  ! 前景がアダプティブアイコンのマスクで欠ける。ADAPTIVE_LINES を縮めること。')
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

    W, H = g.WORDMARK_W, g.WORDMARK_H
    write(os.path.join(BRAND, 'wordmark-dark.svg'), r.svg(W, H, [(mark, g.INK, g.DOT)]))
    write(
        os.path.join(BRAND, 'wordmark-light.svg'),
        r.svg(W, H, [(mark, g.LIGHT_INK, g.LIGHT_DOT)]),
    )
    write(os.path.join(BRAND, 'wordmark-mono.svg'), r.svg(W, H, [(mark, g.MONO, g.MONO)]))
    C = g.CANVAS
    write(os.path.join(BRAND, 'app-icon.svg'), r.svg(C, C, [(icon, g.ICON_INK, g.ICON_INK)], g.ICON_BG))
    write(os.path.join(BRAND, 'icon-small.svg'), r.svg(C, C, [(small, g.ICON_INK, g.ICON_INK)], g.ICON_BG))
    write(
        os.path.join(BRAND, 'android-foreground.svg'),
        r.svg(C, C, [(adaptive, g.ICON_INK, g.ICON_INK)]),
    )
    write(
        os.path.join(BRAND, 'android-monochrome.svg'),
        r.svg(C, C, [(adaptive, g.MONO, g.MONO)]),
    )
    write(APP_WORDMARK, app_wordmark())

    png('icon.png', icon, 1024, g.ICON_INK, g.ICON_INK, g.ICON_BG)
    png('android-icon-foreground.png', adaptive, 1024, g.ICON_INK, g.ICON_INK, None)
    png('android-icon-monochrome.png', adaptive, 1024, g.MONO, g.MONO, None)
    png('favicon.png', small, 48, g.ICON_INK, g.ICON_INK, g.ICON_BG)
    png('splash-icon.png', splash, g.SPLASH_W, g.INK, g.DOT, None, g.SPLASH_W, g.SPLASH_H)

    path = os.path.join(IMAGES, 'android-icon-background.png')
    r.write_png(path, r.solid(1024, 1024, g.ICON_BG), 1024, 1024, True)
    print('書き出し', os.path.relpath(path, ROOT), '(1024x1024, 単色)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
