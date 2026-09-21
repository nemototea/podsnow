"""
PodsNow のブランドマークの幾何定義（Issue #82）。

**ここが図形の正**。SVG も PNG もこの定義から生成するので、両者がずれることはない。

## マークの意味

マイク（収録）＋ レベルメーター（声が録れている「いま」）。

旧マークはマイク＋**雪の結晶**だった。サービス名は PodSnow ではなく **PodsNow**
（Pods = エピソード、Now = いま録って、いま出す）なので、雪は名前の読み違いに
由来するノイズでしかない。置き換えにあたっては次を避けた:

- 雪・氷・冬を想起させるもの（名前の誤読の再生産）
- 電波・Wi-Fi 的に扇状に開く弧（このアプリはネットワークを使わない。NFR-2 と矛盾する）
- 単体の赤い丸（通知バッジ／エラーに見える）

残ったのがレベルメーター。アプリ内の収録画面とWaveformが実際に出している形と同じで、
音であることが一目で分かり、小さくても潰れない。

## 座標系

1024 x 1024、左上原点・y 下向き。色はデザイントークンの dark をそのまま読む。
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'design'))

import ramps  # noqa: E402

CANVAS = 1024

# マークのために別の色を作らない（assets/brand/README.md）。
# トークンの生成元をそのまま読むので、色を変えたらマークも必ず追従する。
_DARK = ramps.build('dark')
INK = _DARK['textPrimary']  # モノクロアイコン用
BG = _DARK['bg']  # 背景
GOLD = _DARK['accentSolid']  # マイク本体
MINT = _DARK['voiceSolid']  # レベルメーター（声トラックの色）

# --- マイク本体 -------------------------------------------------------------
# カプセル（振動板）
MIC_CX = 430.0
MIC_R = 105.0
MIC_TOP = 300.0
MIC_BOTTOM = 600.0

# クレードル（下半分の円弧）
CRADLE_CY = 500.0
CRADLE_R = 165.0  # 帯の中心半径
CRADLE_W = 34.0  # 帯の太さ

# 支柱と台座。
# 隣接する図形はカバレッジを max で合成するので、境界をぴったり合わせると
# 両方 0.5 のままになって継ぎ目の線が出る。必ず少し重ねる。
STEM_HW = 16.0
STEM_TOP = 675.0  # クレードル下端(682)に食い込ませる
STEM_BOTTOM = 726.0  # 台座(712..745)に食い込ませる
BASE_HW = 80.0
BASE_TOP = 712.0
BASE_BOTTOM = 745.0
BASE_R = 16.0

# --- レベルメーター ---------------------------------------------------------
# (中心 x, バーの高さ)。中心 y は BARS_CY。
BAR_HW = 16.0
BARS_CY = 420.0
BARS = [(610.0, 96.0), (672.0, 180.0), (734.0, 120.0)]

# --- 構図の中央寄せ ---------------------------------------------------------
# 上の数値は描きやすさ優先で置いたので、最後に全体をキャンバス中央へ寄せる。
_CONTENT_LEFT = MIC_CX - CRADLE_R - CRADLE_W / 2
_CONTENT_RIGHT = BARS[-1][0] + BAR_HW
_CONTENT_TOP = MIC_TOP
_CONTENT_BOTTOM = BASE_BOTTOM
SHIFT_X = CANVAS / 2 - (_CONTENT_LEFT + _CONTENT_RIGHT) / 2
SHIFT_Y = CANVAS / 2 - (_CONTENT_TOP + _CONTENT_BOTTOM) / 2


def shapes(scale: float = 1.0):
    """
    マークを構成する図形。`kind` ごとに描画側が解釈する。

    `scale` はキャンバス中心を基準にした拡大率。アダプティブアイコンの前景は
    マスクで欠けるので 1.0（安全域いっぱい）、マスクの無い iOS アイコンや
    スプラッシュはもう少し大きくして余白を詰める。
    """
    dx, dy = SHIFT_X, SHIFT_Y
    out = [
        # カプセルは「線分 + 半径」で表す（上下が丸い角丸長方形と同じ）
        {
            'kind': 'capsule',
            'x0': MIC_CX + dx,
            'y0': MIC_TOP + MIC_R + dy,
            'x1': MIC_CX + dx,
            'y1': MIC_BOTTOM - MIC_R + dy,
            'r': MIC_R,
        },
        # クレードルは下半分だけのリング
        {
            'kind': 'arc_bottom',
            'cx': MIC_CX + dx,
            'cy': CRADLE_CY + dy,
            'r': CRADLE_R,
            'w': CRADLE_W,
        },
        {
            'kind': 'rect',
            'x0': MIC_CX - STEM_HW + dx,
            'y0': STEM_TOP + dy,
            'x1': MIC_CX + STEM_HW + dx,
            'y1': STEM_BOTTOM + dy,
            'r': 0.0,
        },
        {
            'kind': 'rect',
            'x0': MIC_CX - BASE_HW + dx,
            'y0': BASE_TOP + dy,
            'x1': MIC_CX + BASE_HW + dx,
            'y1': BASE_BOTTOM + dy,
            'r': BASE_R,
        },
    ]
    for cx, h in BARS:
        out.append(
            {
                'kind': 'rect',
                'x0': cx - BAR_HW + dx,
                'y0': BARS_CY - h / 2 + dy,
                'x1': cx + BAR_HW + dx,
                'y1': BARS_CY + h / 2 + dy,
                'r': BAR_HW,
                'accent': True,  # レベルメーターだけ別色
            }
        )
    return [_scaled(s, scale) for s in out] if scale != 1.0 else out


def _scaled(s: dict, k: float) -> dict:
    """キャンバス中心を基準に拡大する。"""
    c = CANVAS / 2

    def sx(v: float) -> float:
        return c + (v - c) * k

    out = dict(s)
    for key in ('x0', 'x1', 'y0', 'y1', 'cx', 'cy'):
        if key in out:
            out[key] = sx(out[key])
    for key in ('r', 'w'):
        if key in out:
            out[key] = out[key] * k
    return out


def safe_radius(scale: float = 1.0) -> float:
    """
    中心からいちばん遠い描画点までの距離。

    Android のアダプティブアイコンは前景の中央 66%（= 半径 338）しか見える保証がない。
    旧アイコンは雪の結晶が半径 498 まではみ出していて、丸マスクで欠けていた。
    """
    cx = cy = CANVAS / 2
    worst = 0.0
    for s in shapes(scale):
        if s['kind'] == 'capsule':
            pts = [
                (s['x0'], s['y0'] - s['r']),
                (s['x1'], s['y1'] + s['r']),
                (s['x0'] - s['r'], s['y0']),
                (s['x0'] + s['r'], s['y0']),
                (s['x1'] - s['r'], s['y1']),
                (s['x1'] + s['r'], s['y1']),
            ]
        elif s['kind'] == 'arc_bottom':
            outer = s['r'] + s['w'] / 2
            pts = [
                (s['cx'] - outer, s['cy']),
                (s['cx'] + outer, s['cy']),
                (s['cx'], s['cy'] + outer),
            ]
        else:
            pts = [
                (s['x0'], s['y0']),
                (s['x1'], s['y0']),
                (s['x0'], s['y1']),
                (s['x1'], s['y1']),
            ]
        for x, y in pts:
            worst = max(worst, ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5)
    return worst
