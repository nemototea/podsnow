#!/usr/bin/env python3
"""
アプリアイコン・スプラッシュ・favicon・ロゴの SVG と、アプリ内ロゴのデータを生成する
（DESIGN_SYSTEM.md §3、Issue #235 案 A）。

    python3 scripts/brand/generate.py

図形の定義は `geometry.py`（字形は `glyphs.py`）だけ。Python 標準ライブラリしか使わない。
アイコンとロゴの見た目は見本 `docs/design-refresh/ds4/mock.html` の再現（`geometry.py` の冒頭）。
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

# #190 までの生成物で、#235 から作らないもの。
RETIRED = (
    os.path.join(BRAND, 'wordmark-light.svg'),
    os.path.join(IMAGES, 'splash-icon-light.png'),
)


def stack(lines, ink, dot=None):
    """層（下から 字 → 点）と色の組。点の色を省くと字と同じ色（単色版）。"""
    ls = g.layers(lines)
    return [(ls['ink'], ink), (ls['dot'], dot or ink)]


def png(name, stacked, width, background, height=None, scale_from=g.CANVAS):
    h = height or width
    k = width / scale_from
    layers = [(r.polygons(lines, k), color) for lines, color in stacked]
    rows = r.compose(layers, width, h, background)
    path = os.path.join(IMAGES, name)
    r.write_png(path, rows, width, h, background is None)
    print('書き出し', os.path.relpath(path, ROOT), f'({width}x{h})')


def write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    print('書き出し', os.path.relpath(path, ROOT))


def app_wordmark() -> str:
    """アプリ内のロゴ（`src/ui/Wordmark.tsx`）。字と点を別の path にし、箱の大きさを添える。"""
    size = g.WORDMARK_FONT
    w, h = g.wordmark_box(size)
    ls = g.layers(g.wordmark(size))
    data = {
        'width': round(w, 2),
        'height': round(h, 2),
        'ink': r.path_d(ls['ink']),
        'dot': r.path_d(ls['dot']),
    }
    return (
        '// scripts/brand/generate.py が生成。直接編集せず scripts/brand/geometry.py を直すこと。\n'
        '// 箱（width × height）は見本の `.wm` の span の大きさ（字の大きさ 100 のとき）。\n'
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
    splash = g.wordmark_centered(g.SPLASH_W, g.SPLASH_H, g.SPLASH_FONT)
    rad = g.max_radius(splash, g.SPLASH_W / 2, g.SPLASH_H / 2)
    # contain なので長辺（幅）が imageWidth になる。
    return rad * width / max(g.SPLASH_W, g.SPLASH_H), width


def check_app_json() -> list[str]:
    """アプリはダーク 1 つ（#235）。スプラッシュとアダプティブの背景は bg の黒 1 色。"""
    with open(APP_JSON, encoding='utf-8') as f:
        cfg = json.load(f)['expo']
    bad = []
    want = {
        'android.adaptiveIcon.backgroundColor': cfg['android']['adaptiveIcon']['backgroundColor'],
        'splash.backgroundColor': cfg['splash']['backgroundColor'],
        'expo-splash-screen.backgroundColor': splash_plugin().get('backgroundColor', ''),
    }
    for k, got in want.items():
        if got.upper() != g.BG.upper():
            bad.append(f'app.json {k} = {got}（期待 {g.BG}）')
    if 'dark' in cfg['splash'] or 'dark' in splash_plugin():
        bad.append('app.json のスプラッシュに dark の設定が残っている（#235 からダーク 1 つ）')
    if splash_plugin().get('image') != './assets/images/splash-icon.png':
        bad.append('app.json expo-splash-screen.image は ./assets/images/splash-icon.png')
    return bad


def main() -> int:
    adaptive = g.two_lines(g.ADAPTIVE_FONT)
    rad = g.max_radius(adaptive)
    print(f'前景の最大描画半径: {rad:.0f}px（アダプティブ安全域 {ADAPTIVE_SAFE_RADIUS:.0f}px）')
    if rad > ADAPTIVE_SAFE_RADIUS:
        print('  ! 前景がアダプティブアイコンのマスクで欠ける。ADAPTIVE_FONT を小さくすること。')
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
    icon = g.two_lines()
    x0, y0, x1, y1 = g.extent(icon)
    if x0 < 0 or y0 < 0 or x1 > g.CANVAS or y1 > g.CANVAS:
        print('  ! アイコンがキャンバスからはみ出す')
        return 1
    bad = check_app_json()
    if bad:
        for m in bad:
            print('  !', m)
        print('app.json をトークンと #235 の決まりに合わせること。')
        return 1

    C = g.CANVAS
    mw, mh = g.wordmark_box(g.WORDMARK_FONT)
    mark = g.wordmark(g.WORDMARK_FONT)
    splash = g.wordmark_centered(g.SPLASH_W, g.SPLASH_H, g.SPLASH_FONT)

    # 横組み（§3.2）。白の字にレモンの点。明るい地に置く資料は単色版を使う。
    mark_dark = stack(mark, g.INK, g.DOT)
    mark_mono = stack(mark, g.MONO)
    # アイコン（見本 `.lg-icon` 案 A）。黒の地に白の字、点だけレモン。小さいサイズも同じ組み方。
    icon_full = stack(icon, g.INK, g.DOT)
    fg = stack(adaptive, g.INK, g.DOT)
    mono = stack(adaptive, g.MONO)

    W, H = round(mw), round(mh)
    write(os.path.join(BRAND, 'wordmark-dark.svg'), r.svg_layers(W, H, mark_dark))
    write(os.path.join(BRAND, 'wordmark-mono.svg'), r.svg_layers(W, H, mark_mono))
    write(os.path.join(BRAND, 'app-icon.svg'), r.svg_layers(C, C, icon_full, g.BG))
    write(os.path.join(BRAND, 'icon-small.svg'), r.svg_layers(C, C, icon_full, g.BG))
    write(os.path.join(BRAND, 'android-foreground.svg'), r.svg_layers(C, C, fg))
    write(os.path.join(BRAND, 'android-monochrome.svg'), r.svg_layers(C, C, mono))
    write(APP_WORDMARK, app_wordmark())

    png('icon.png', icon_full, 1024, g.BG)
    png('android-icon-foreground.png', fg, 1024, None)
    png('android-icon-monochrome.png', mono, 1024, None)
    png('favicon.png', icon_full, 48, g.BG)
    png('splash-icon.png', stack(splash, g.INK, g.DOT), g.SPLASH_W, None, g.SPLASH_H, g.SPLASH_W)
    png('android-icon-background.png', [], 1024, g.BG)

    for path in RETIRED:
        if os.path.exists(path):
            os.remove(path)
            print('削除', os.path.relpath(path, ROOT))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
