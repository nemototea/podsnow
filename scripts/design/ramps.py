#!/usr/bin/env python3
"""
デザイントークンの色を決める唯一の場所（DESIGN_SYSTEM.md §2）。

`color.py` の OKLCh で計算する。目分量の hex をここにも他のどこにも置かない。

二種類の段がある。

- **面と塗り**は明度を決め打ちする。読みやすさではなく見た目の決めごとだから。
- **文字と境界**は目標コントラスト比から明度を逆算する。面を動かしても勝手に追従し、
  読めない組み合わせが残らない。

彩度は色相ごとの上限に対する割合で持つ。同じ数値を使い回すと、sRGB で出せる
彩度の上限が色相ごとに違うせいで鮮やかさが揃わない。

出典（【確認済み】）:
- 段ごとの役割: https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- コントラスト要件 1.4.3 / 1.4.11: https://www.w3.org/TR/WCAG22/#contrast-minimum
"""

import math

import color as k

THEMES = ('dark', 'light')

# ---------------------------------------------------------------- 彩度の曲線

# ランプの中ほどでいちばん鮮やかになり、両端に向かって落ちる（better-colors）。
# 係数はブランドのアクセント #E2B979 の彩度をそのまま再現する値に合わせてある。
VIVIDNESS_PEAK = 0.78


def vividness(L: float) -> float:
    return VIVIDNESS_PEAK * math.sin(math.pi * min(1.0, max(0.0, L))) ** 0.6


NEUTRAL_HUE = 80.0  # アクセント（金 77.9°）側へわずかに寄せた暖色。テーマをまたいで一定
NEUTRAL_PEAK = 0.013


def _max_chroma(L: float, h: float) -> float:
    lo, hi = 0.0, 0.4
    for _ in range(40):
        mid = (lo + hi) / 2
        if k.in_gamut(L, mid, h):
            lo = mid
        else:
            hi = mid
    return lo


def hue_hex(L: float, h: float, scale: float = 1.0) -> str:
    return k.to_hex(L, _max_chroma(L, h) * vividness(L) * scale, h)


def tint_hex(L: float, h: float, scale: float) -> str:
    """淡い面（チップの地など）。彩度の曲線を通すとランプの端で色が消えるので、
    色相ごとの上限から直接取る。"""
    return k.to_hex(L, _max_chroma(L, h) * scale, h)


def neutral_hex(L: float) -> str:
    t = min(1.0, max(0.0, L))
    return k.to_hex(t, NEUTRAL_PEAK * math.sin(math.pi * t) ** 0.38, NEUTRAL_HUE)


# ---------------------------------------------------------------- 色相

# ひとつの色相にひとつの意味を持たせる。隣り合う色相が 15° 以内だと同じ色に見えるので
# （better-colors）、どの二つも 40° 以上離す。`insert` と `mistake` は 0.1.0 まで
# それぞれ 19°（danger の 23° と 4° 差）と 64°（accent の 78° と 14° 差）にいて、
# エディタ上で REC ドットやアクセントと見分けがつかなかった。
HUES = {
    'danger': 23.0,  # 赤。破壊的操作と録音中
    'accent': 77.9,  # 金。ブランド。操作できるもの・選択状態
    'voice': 175.2,  # ミント。声トラック =「録れている / 済んでいる」
    'insert': 240.0,  # 青。差し込みオーバーレイ
    'music': 297.8,  # 藤。音楽オーバーレイ
    'mistake': 340.0,  # 薔薇。言い間違いマーク
}

# ---------------------------------------------------------------- 明度の決め打ち

# 面。dark の bg は app.json のスプラッシュ / アダプティブアイコン背景と同じ値になる。
SURFACE_L = {
    'dark': {'bg': 0.1546, 'surface': 0.2060, 'surfaceRaised': 0.2400, 'surfaceHover': 0.2700},
    'light': {'bg': 0.9800, 'surface': 1.0000, 'surfaceRaised': 0.9500, 'surfaceHover': 0.9250},
}
BORDER_L = {'dark': 0.3200, 'light': 0.8700}
TEXT_PRIMARY_L = {'dark': 0.9616, 'light': 0.2091}  # ブランドの ink をそのまま使う

# 塗りになる段。dark 側はブランドの値をそのまま再現する明度。
SOLID_L = {
    'dark': {'accent': 0.8079, 'voice': 0.8186, 'music': 0.7568,
             'insert': 0.7889, 'mistake': 0.7846},
    'light': {'accent': 0.6450, 'voice': 0.6300, 'music': 0.5900,
              'insert': 0.5900, 'mistake': 0.6500},
}
# 録音中インジケータ。ラベルは載らない（隣に文字が並ぶ）ので、ブランドの赤のまま使える。
REC_L = {'dark': 0.6256, 'light': 0.5800}
# 波形の塗り。透過を重ねると背面しだいで測れなくなるので、最初から不透明で作る。
FILL_L = {'dark': (0.3400, 0.3900), 'light': (0.8600, 0.8100)}
FILL_SCALE = 0.45
SUBTLE_L = {'dark': 0.2500, 'light': 0.9400}
SUBTLE_SCALE = 0.30
OVERLAY_ALPHA = '33'  # 20%。下の波形が透ける濃さ

# 「本文が載りうる面」のうち、いちばんコントラストを稼げないもの。文字の段はここから逆算する。
WORST_TEXT_SURFACE = 'surfaceHover'

# 目標コントラスト比。1.4.3 は 4.5:1、1.4.11 は 3:1。余裕を持たせて少し上を狙う。
TARGET = {
    'textSecondary': 5.5,
    'textTertiary': 4.6,
    'textDisabled': 3.0,
    'borderStrong': 3.1,
    'hueText': 4.6,
    'recSolid': 3.1,
    'hueBorder': 3.1,
}

# ---------------------------------------------------------------- 逆算

def _solve(target: float, against: str, lighter: bool, make) -> str:
    lo, hi = (k.oklch(against)[0], 1.0) if lighter else (0.0, k.oklch(against)[0])
    for _ in range(50):
        mid = (lo + hi) / 2
        if k.contrast(make(mid), against) < target:
            lo, hi = (mid, hi) if lighter else (lo, mid)
        else:
            lo, hi = (lo, mid) if lighter else (mid, hi)
    return make(hi if lighter else lo)


def solve_neutral(target: float, against: str, lighter: bool) -> str:
    return _solve(target, against, lighter, neutral_hex)


TEXT_SCALE = 0.80


def solve_hue(target: float, against: str, lighter: bool, h: float, scale: float = 1.0) -> str:
    return _solve(target, against, lighter, lambda L: hue_hex(L, h, scale))


def solve_on(solid: str) -> str:
    """塗りの上に載せる文字。色は付けず、ランプの両端のうち余裕のあるほうを取る。

    ぎりぎり基準を満たす明度ではなく端を取るのは、主操作のラベルだから。ここで
    4.6:1 に張り付けると、塗りの明度を少し動かしただけで読めなくなる。
    """
    ends = (neutral_hex(TEXT_PRIMARY_L['light']), neutral_hex(TEXT_PRIMARY_L['dark']))
    return max(ends, key=lambda e: k.contrast(e, solid))


# ---------------------------------------------------------------- 組み立て

def build(theme: str) -> dict[str, str]:
    dark = theme == 'dark'
    up = dark  # 文字は dark なら面より明るい側、light なら暗い側へ伸ばす
    t = {name: neutral_hex(L) for name, L in SURFACE_L[theme].items()}
    worst = t[WORST_TEXT_SURFACE]

    t['border'] = neutral_hex(BORDER_L[theme])
    # 操作部品の輪郭は、いちばん近づく面（＝いちばんコントラストを稼げない面）で測る。
    t['borderStrong'] = solve_neutral(TARGET['borderStrong'], worst, up)
    t['textPrimary'] = neutral_hex(TEXT_PRIMARY_L[theme])
    for role in ('textSecondary', 'textTertiary', 'textDisabled'):
        t[role] = solve_neutral(TARGET[role], worst, up)
    t['overlayScrim'] = '#00000099' if dark else '#00000066'

    for role in ('accent', 'danger'):
        h = HUES[role]
        if role == 'danger':
            # 破壊的操作のラベルは淡いニュートラル。塗りはそれが 4.6:1 に届く明度まで落とす。
            on = neutral_hex(TEXT_PRIMARY_L['dark'])
            solid = solve_hue(TARGET['hueText'], on, False, h)
            solid_l = k.oklch(solid)[0]
        else:
            solid_l = SOLID_L[theme][role]
            solid = hue_hex(solid_l, h)
        on = solve_on(solid)
        # 押下中は一段暗くする（押し込まれて見える）。それでラベルが読めなくなる色相だけ、
        # 逆へ振る。どちらに転んでも下の検証で 4.5:1 を確認している。
        pressed = hue_hex(solid_l - 0.07, h)
        if k.contrast(on, pressed) < TARGET['hueText']:
            pressed = hue_hex(solid_l + 0.07, h)
        t[f'{role}Solid'] = solid
        t[f'{role}SolidPressed'] = pressed
        t[f'{role}OnSolid'] = on
        t[f'{role}Subtle'] = tint_hex(SUBTLE_L[theme], h, SUBTLE_SCALE)
        bg_worst = min((worst, t[f'{role}Subtle']), key=lambda b: k.contrast(solid, b))
        t[f'{role}Text'] = solve_hue(TARGET['hueText'], bg_worst, up, h, TEXT_SCALE)
        t[f'{role}Border'] = solve_hue(TARGET['hueBorder'], bg_worst, up, h)

    for role in ('voice', 'music', 'insert', 'mistake'):
        h = HUES[role]
        t[f'{role}Solid'] = hue_hex(SOLID_L[theme][role], h)
        t[f'{role}Subtle'] = tint_hex(SUBTLE_L[theme], h, SUBTLE_SCALE)
        t[f'{role}Fill'] = tint_hex(FILL_L[theme][0], h, FILL_SCALE)
        t[f'{role}FillAlt'] = tint_hex(FILL_L[theme][1], h, FILL_SCALE)
        # 文字は「面」と「自分の淡い地」の条件が悪いほうから逆算する。チップの地の上でも
        # 本文と同じだけ読めなければ、同じトークンを両方に使えない。
        bg_worst = min((worst, t[f'{role}Subtle']), key=lambda b: k.contrast(t[f'{role}Solid'], b))
        t[f'{role}Text'] = solve_hue(TARGET['hueText'], bg_worst, up, h, TEXT_SCALE)
        # チップの輪郭。地の上でも背景の上でも 3:1 を割らない側から取る。
        t[f'{role}Border'] = solve_hue(TARGET['hueBorder'], bg_worst, up, h)

    t['recSolid'] = hue_hex(REC_L[theme], HUES['danger'])

    # 波形に重ねる帯（選択範囲・録音中）。ここだけは透過で持つ。下の波形を隠すと
    # 「どこを選んでいるか」より先に「何が録れているか」が読めなくなるため
    # （DESIGN_SYSTEM.md §2.5）。意味そのものは不透明な輪郭 `accentBorder` /
    # `recSolid` が運ぶので、帯が薄くても情報は落ちない。
    t['selectionOverlay'] = t['accentSolid'] + OVERLAY_ALPHA
    t['recordingOverlay'] = t['recSolid'] + OVERLAY_ALPHA

    # 「録れている / 済んでいる」は声トラックと同じ色でひとつの意味（DESIGN_SYSTEM.md §2.3）。
    t['successText'] = t['voiceText']
    t['successSolid'] = t['voiceSolid']
    return t
