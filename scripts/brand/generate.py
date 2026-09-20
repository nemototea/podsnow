#!/usr/bin/env python3
"""
アプリアイコン・スプラッシュ・favicon とブランドマークの SVG を生成する（Issue #82）。

    python3 scripts/brand/generate.py

図形の定義は `geometry.py` ひとつだけ。SVG も PNG もそこから作るのでずれない。
Python 標準ライブラリしか使わないので、追加の依存やデザインツールは要らない。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import geometry as g  # noqa: E402
import render as r  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
IMAGES = os.path.join(ROOT, 'assets', 'images')
BRAND = os.path.join(ROOT, 'assets', 'brand')

# Android のアダプティブアイコンで見えることが保証される半径（前景の中央 66%）
ADAPTIVE_SAFE_RADIUS = g.CANVAS * 0.66 / 2


def svg(base_color: str, accent_color: str, background: str | None, scale: float = 1.0) -> str:
    """同じ幾何定義から SVG を書き出す（デザイン作業の受け渡し用）。"""
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{g.CANVAS}" height="{g.CANVAS}" '
        f'viewBox="0 0 {g.CANVAS} {g.CANVAS}">',
        '  <!-- scripts/brand/generate.py が生成。直接編集せず geometry.py を直すこと。 -->',
    ]
    if background:
        parts.append(f'  <rect width="{g.CANVAS}" height="{g.CANVAS}" fill="{background}"/>')
    for s in g.shapes(scale):
        fill = accent_color if s.get('accent') else base_color
        if s['kind'] == 'capsule':
            x = s['x0'] - s['r']
            y = s['y0'] - s['r']
            w = s['r'] * 2
            h = (s['y1'] - s['y0']) + s['r'] * 2
            parts.append(
                f'  <rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
                f'rx="{s["r"]:.1f}" fill="{fill}"/>'
            )
        elif s['kind'] == 'arc_bottom':
            cx, cy, rad = s['cx'], s['cy'], s['r']
            # y 下向きなので sweep-flag=0 が下半分
            parts.append(
                f'  <path d="M {cx - rad:.1f} {cy:.1f} '
                f'A {rad:.1f} {rad:.1f} 0 0 0 {cx + rad:.1f} {cy:.1f}" '
                f'fill="none" stroke="{fill}" stroke-width="{s["w"]:.1f}" stroke-linecap="butt"/>'
            )
        else:
            w = s['x1'] - s['x0']
            h = s['y1'] - s['y0']
            rx = f' rx="{s["r"]:.1f}"' if s['r'] else ''
            parts.append(
                f'  <rect x="{s["x0"]:.1f}" y="{s["y0"]:.1f}" width="{w:.1f}" '
                f'height="{h:.1f}"{rx} fill="{fill}"/>'
            )
    parts.append('</svg>')
    return '\n'.join(parts) + '\n'


# アダプティブアイコン（Android）はマスクされるので等倍のまま安全域に収める。
# マスクの無い iOS アイコン・スプラッシュ・favicon は拡大して余白を詰める。
ADAPTIVE_SCALE = 1.0
FULL_SCALE = 1.28
SPLASH_SCALE = 1.6


def main() -> int:
    safe = g.safe_radius(ADAPTIVE_SCALE)
    print(f'中心からの最大描画半径: {safe:.0f}px (アダプティブ安全域 {ADAPTIVE_SAFE_RADIUS:.0f}px)')
    if safe > ADAPTIVE_SAFE_RADIUS:
        print('  ! 前景がアダプティブアイコンのマスクで欠ける。geometry.py を縮めること。')
        return 1
    for name, sc in (('フル', FULL_SCALE), ('スプラッシュ', SPLASH_SCALE)):
        rad = g.safe_radius(sc)
        print(f'{name}の最大描画半径: {rad:.0f}px (キャンバス半径 {g.CANVAS / 2:.0f}px)')
        if rad > g.CANVAS / 2:
            print('  ! キャンバスからはみ出す。倍率を下げること。')
            return 1

    os.makedirs(BRAND, exist_ok=True)

    # --- SVG（ブランドマークの原本） ---
    for name, base, accent, bg, sc in [
        ('mark-dark.svg', g.GOLD, g.MINT, g.BG, FULL_SCALE),
        ('mark-transparent.svg', g.GOLD, g.MINT, None, ADAPTIVE_SCALE),
        ('mark-monochrome.svg', g.INK, g.INK, None, ADAPTIVE_SCALE),
    ]:
        with open(os.path.join(BRAND, name), 'w') as f:
            f.write(svg(base, accent, bg, sc))
        print('書き出し', os.path.relpath(os.path.join(BRAND, name), ROOT))

    # --- PNG ---
    # (ファイル名, サイズ, 基本色, アクセント色, 背景, アルファ, 倍率)
    targets = [
        # iOS のアプリアイコンはアルファを持てないので不透明 RGB
        ('icon.png', 1024, g.GOLD, g.MINT, g.BG, False, FULL_SCALE),
        # 前景はマスクされるので等倍（安全域いっぱい）
        ('android-icon-foreground.png', 1024, g.GOLD, g.MINT, None, True, ADAPTIVE_SCALE),
        ('android-icon-monochrome.png', 1024, g.INK, g.INK, None, True, ADAPTIVE_SCALE),
        ('splash-icon.png', 400, g.GOLD, g.MINT, None, True, SPLASH_SCALE),
        ('favicon.png', 48, g.GOLD, g.MINT, g.BG, False, SPLASH_SCALE),
    ]
    for name, size, base, accent, bg, alpha, sc in targets:
        rows = r.render(g.shapes(sc), size, g.CANVAS, base, accent, bg)
        path = os.path.join(IMAGES, name)
        r.write_png(path, rows, size, alpha)
        print('書き出し', os.path.relpath(path, ROOT), f'({size}x{size})')

    # Android の背景レイヤーは単色（app.json の adaptiveIcon.backgroundColor と同じ）
    path = os.path.join(IMAGES, 'android-icon-background.png')
    r.write_png(path, r.solid(1024, g.BG), 1024, True)
    print('書き出し', os.path.relpath(path, ROOT), '(1024x1024, 単色)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
