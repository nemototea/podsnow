#!/usr/bin/env python3
"""
デザイントークンの色を決める唯一の場所（DESIGN_SYSTEM.md §5）。

`color.py` の OKLCh で計算する。目分量の hex をここにも他のどこにも置かない。

二種類の段がある。

- **面と塗り**は OKLCh（明度・彩度・色相）を決め打ちする。読みやすさではなく見た目の決めごとだから。
- **文字と境界**は彩度と色相だけを決め、明度は目標コントラスト比から逆算する。面を動かしても
  勝手に追従し、読めない組み合わせが残らない。

Design system 3（Issue #190「リソグラフの深夜ラジオ」）で、面を紙（ダークは黒い紙）、線と影を墨、
主操作をリソの青、録音を蛍光ピンク、破壊的操作を朱にした。値はデザインキャンバスの色を再現する OKLCh。
ただしライトの録音（`recSolid`）は、紙の上で 3:1 を持てる所まで明度を下げてある。ロゴの版ズレに
使う蛍光ピンク（`brandShadow`）は飾りなので原案のまま（DESIGN_SYSTEM.md §3.2）。

出典（【確認済み】）:
- 段ごとの役割: https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- コントラスト要件 1.4.3 / 1.4.11: https://www.w3.org/TR/WCAG22/#contrast-minimum
"""

import color as k

THEMES = ('dark', 'light')

# ひとつの色相にひとつの意味。代表色相（塗りの色相）で 30° 以上離す（generate.py が検査）。
# `voice` は墨（ダークは紙の色）で無彩色なので色相の比較から外す。
HUES = {
    'rec': 355.3,  # 蛍光ピンク。録音中・ON AIR
    'danger': 31.6,  # 朱。破壊的操作
    'mistake': 90.0,  # 黄（ライトの塗りは黄土）。注意・割り込み
    'success': 151.0,  # 緑。完了
    'insert': 206.0,  # ティール。差し込み素材
    'accent': 261.5,  # リソの青。主操作・選択状態
    'music': 294.0,  # 紫。BGM
}
NEAR_NEUTRAL = ('voice',)

# ---------------------------------------------------------------- 決め打ちの段（L, C, h）

FIXED = {
    'dark': {
        'controlEdge': (0.9528, 0.0127, 86.8),
        'bg': (0.1822, 0.0000, 0.0),
        'surface': (0.2225, 0.0041, 84.6),
        'surfaceRaised': (0.2655, 0.0062, 78.2),
        'surfaceHover': (0.3109, 0.0082, 75.3),
        'border': (0.3381, 0.0095, 80.7),
        'textPrimary': (0.9528, 0.0127, 86.8),
        'accentSolid': (0.6648, 0.1771, 264.6),
        'accentSolidPressed': (0.6090, 0.1813, 264.3),
        'accentOnSolid': (0.1638, 0.0000, 0.0),
        'accentSubtle': (0.2882, 0.0525, 265.1),
        'recSolid': (0.7113, 0.2113, 353.1),
        'recOnSolid': (0.1822, 0.0000, 0.0),
        'recSubtle': (0.2790, 0.0500, 345.5),
        'dangerSolid': (0.7057, 0.1877, 32.9),
        'dangerSolidPressed': (0.6528, 0.1927, 32.9),
        'dangerOnSolid': (0.1822, 0.0000, 0.0),
        'dangerSubtle': (0.2741, 0.0434, 31.3),
        'voiceSolid': (0.9528, 0.0127, 86.8),
        'voiceFill': (0.3109, 0.0082, 75.3),
        'voiceFillAlt': (0.3381, 0.0095, 80.7),
        'voiceSubtle': (0.2655, 0.0062, 78.2),
        'musicSolid': (0.7091, 0.1656, 291.5),
        'musicOnSolid': (0.1822, 0.0000, 0.0),
        'musicFill': (0.3039, 0.0554, 293.2),
        'musicFillAlt': (0.3330, 0.0645, 293.8),
        'musicSubtle': (0.2547, 0.0376, 295.1),
        'insertSolid': (0.7510, 0.1190, 202.6),
        'insertOnSolid': (0.1822, 0.0000, 0.0),
        'insertFill': (0.3015, 0.0350, 210.5),
        'insertFillAlt': (0.3378, 0.0399, 210.8),
        'insertSubtle': (0.2687, 0.0289, 210.5),
        'mistakeSolid': (0.9135, 0.1643, 98.4),
        'mistakeFill': (0.3238, 0.0457, 97.9),
        'mistakeFillAlt': (0.3624, 0.0530, 98.2),
        'mistakeSubtle': (0.2996, 0.0418, 98.7),
        'successSolid': (0.7714, 0.1652, 152.4),
        'successSubtle': (0.2826, 0.0451, 153.8),
    },
    'light': {
        'controlEdge': (0.2002, 0.0000, 0.0),
        'bg': (0.9528, 0.0127, 86.8),
        'surface': (0.9823, 0.0069, 88.6),
        'surfaceRaised': (0.9289, 0.0157, 86.4),
        'surfaceHover': (0.9165, 0.0170, 88.0),
        'border': (0.8128, 0.0250, 85.8),
        'textPrimary': (0.2002, 0.0000, 0.0),
        'accentSolid': (0.5196, 0.1943, 261.5),
        'accentSolidPressed': (0.4651, 0.1730, 261.5),
        'accentOnSolid': (1.0000, 0.0000, 0.0),
        'accentSubtle': (0.9208, 0.0276, 265.4),
        'recSolid': (0.6295, 0.2227, 355.3),
        'recOnSolid': (0.2002, 0.0000, 0.0),
        'recSubtle': (0.9321, 0.0334, 349.1),
        'dangerSolid': (0.5421, 0.1860, 31.6),
        'dangerSolidPressed': (0.4829, 0.1665, 31.8),
        'dangerOnSolid': (1.0000, 0.0000, 0.0),
        'dangerSubtle': (0.9339, 0.0274, 31.7),
        'voiceSolid': (0.2002, 0.0000, 0.0),
        'voiceFill': (0.9018, 0.0187, 86.2),
        'voiceFillAlt': (0.8650, 0.0230, 87.2),
        'voiceSubtle': (0.9289, 0.0157, 86.4),
        'musicSolid': (0.5552, 0.1562, 294.0),
        'musicOnSolid': (1.0000, 0.0000, 0.0),
        'musicFill': (0.9157, 0.0305, 300.3),
        'musicFillAlt': (0.8728, 0.0462, 299.3),
        'musicSubtle': (0.9423, 0.0207, 301.1),
        'insertSolid': (0.5510, 0.0943, 206.2),
        'insertOnSolid': (1.0000, 0.0000, 0.0),
        'insertFill': (0.9041, 0.0318, 204.0),
        'insertFillAlt': (0.8932, 0.0351, 205.5),
        'insertSubtle': (0.9526, 0.0170, 201.4),
        'mistakeSolid': (0.5602, 0.1170, 77.5),
        'mistakeFill': (0.9135, 0.1643, 98.4),
        'mistakeFillAlt': (0.8745, 0.1694, 97.2),
        'mistakeSubtle': (0.9135, 0.1643, 98.4),
        'successSolid': (0.5702, 0.1421, 151.0),
        'successSubtle': (0.9398, 0.0273, 157.4),
    },
}

# ロゴと飾りの色（DESIGN_SYSTEM.md §3.2、§2.5）。文字の下に置かないので逆算しない。
# sketch* はトークテーマのカンペ（スケッチブック、§2.7）。紙はテーマに関係なく紙の色で、墨の文字を載せる。
BRAND = {
    'dark': {
        'brandShadow': (0.7113, 0.2113, 353.1),
        'brandAccent': (0.9135, 0.1643, 98.4),
        'halftone': (0.4241, 0.1200, 263.8),
        'sketchCover': (0.4268, 0.0796, 159.4),
        'sketchBand': (0.7949, 0.1434, 86.7),
        'sketchPaper': (0.9435, 0.0303, 90.3),
        'sketchBoard': (0.3958, 0.0127, 81.8),
        'sketchInk': (0.2002, 0.0000, 0.0),
        'sketchInkSoft': (0.3694, 0.0129, 81.7),
    },
    'light': {
        'brandShadow': (0.6950, 0.2229, 355.3),
        'brandAccent': (0.9135, 0.1643, 98.4),
        'halftone': (0.7819, 0.0830, 263.9),
        'sketchCover': (0.4268, 0.0796, 159.4),
        'sketchBand': (0.7949, 0.1434, 86.7),
        'sketchPaper': (0.9735, 0.0180, 89.4),
        'sketchBoard': (0.6686, 0.0261, 85.8),
        'sketchInk': (0.2002, 0.0000, 0.0),
        'sketchInkSoft': (0.3731, 0.0079, 75.3),
    },
}

# ---------------------------------------------------------------- 逆算する段（C, h, 目標比）

# 本文が載りうる面。文字と境界は、このうち（と自分の淡い地のうち）いちばん比を稼げない面から逆算する。
TEXT_SURFACES = ('bg', 'surface', 'surfaceRaised', 'surfaceHover')

SOLVED = {
    'dark': {
        'textSecondary': (0.0120, 85.0, 7.00),
        'textTertiary': (0.0140, 85.0, 5.50),
        'textDisabled': (0.0140, 85.0, 3.40),
        'borderStrong': (0.0140, 85.0, 3.60),
        'accentText': (0.1500, 264.6, 6.00),
        'accentBorder': (0.1700, 264.6, 3.60),
        'focusRing': (0.1700, 264.6, 4.50),
        'dangerText': (0.1500, 32.9, 6.00),
        'dangerBorder': (0.1700, 32.9, 3.60),
        'recText': (0.1700, 353.1, 6.00),
        'musicText': (0.1400, 291.5, 6.00),
        'musicBorder': (0.1500, 291.5, 3.60),
        'insertText': (0.1100, 202.6, 6.00),
        'insertBorder': (0.1100, 202.6, 3.60),
        'mistakeText': (0.1500, 98.4, 7.00),
        'mistakeBorder': (0.1500, 98.4, 3.60),
        'voiceBorder': (0.0140, 85.0, 3.60),
        'successText': (0.1500, 152.4, 6.00),
    },
    'light': {
        'textSecondary': (0.0080, 85.0, 8.00),
        'textTertiary': (0.0100, 85.0, 5.60),
        'textDisabled': (0.0100, 85.0, 3.40),
        'borderStrong': (0.0100, 85.0, 4.50),
        'accentText': (0.1900, 261.5, 5.50),
        'accentBorder': (0.1900, 261.5, 3.60),
        'focusRing': (0.1900, 261.5, 4.50),
        'dangerText': (0.1800, 31.6, 5.50),
        'dangerBorder': (0.1900, 31.6, 3.60),
        'recText': (0.2000, 355.3, 5.50),
        'voiceText': (0.0000, 0.0, 12.00),
        'voiceBorder': (0.0000, 0.0, 4.00),
        'musicText': (0.1500, 294.0, 5.50),
        'musicBorder': (0.1500, 294.0, 3.60),
        'insertText': (0.0990, 206.4, 5.50),
        'insertBorder': (0.0990, 206.4, 3.60),
        'mistakeText': (0.1100, 77.5, 5.50),
        'mistakeBorder': (0.1170, 77.5, 3.60),
        'successText': (0.1400, 150.9, 5.50),
    },
}

# dark では塗りそのものが文字・輪郭として十分に明るいので、同じ値を使う（別の段を作らない）。
SAME_AS = {
    'dark': {
        'voiceText': 'voiceSolid',
    },
    'light': {},
}

OVERLAY_ALPHA = '33'  # 20%。下の波形が透ける濃さ


def _hex(lch: tuple[float, float, float]) -> str:
    return k.to_hex(*lch)


def _solve(C: float, h: float, target: float, against: list[str], lighter: bool) -> str:
    """`against` のどれに対しても `target` 以上になる、もっとも面に近い明度を二分探索する。"""

    def worst(L: float) -> float:
        fg = k.to_hex(L, C, h)
        return min(k.contrast(fg, b) for b in against)

    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        ok = worst(mid) >= target
        if lighter:
            lo, hi = (lo, mid) if ok else (mid, hi)
        else:
            lo, hi = (mid, hi) if ok else (lo, mid)
    return k.to_hex(hi if lighter else lo, C, h)


def _subtle_of(role: str) -> str | None:
    for prefix in ('accent', 'danger', 'rec', 'voice', 'music', 'insert', 'mistake', 'success'):
        if role.startswith(prefix):
            return f'{prefix}Subtle'
    return None


def build(theme: str) -> dict[str, str]:
    lighter = theme == 'dark'
    t = {name: _hex(lch) for name, lch in FIXED[theme].items()}
    for role, (C, h, target) in SOLVED[theme].items():
        against = [t[s] for s in TEXT_SURFACES]
        subtle = _subtle_of(role)
        if subtle:
            against.append(t[subtle])
        t[role] = _solve(C, h, target, against, lighter)
    for role, src in SAME_AS[theme].items():
        t[role] = t[src]

    # ロゴと飾り（§3.2、§2.5）。点（brandAccent）は黄で、ライトの紙の上では 3:1 を持てないので、
    # 必ず墨の輪郭（controlBorder）と組にして描く（generate.py が輪郭との比を検査する）。
    for role, lch in BRAND[theme].items():
        t[role] = _hex(lch)
    t['brandInk'] = t['textPrimary'] if lighter else t['accentSolid']
    # 線と影は本文と同じインク。ライトは墨、ダークは紙の色（DESIGN_SYSTEM.md §6）。
    # Design system 3 では主操作の枠も同じ線で描く（controlEdge = textPrimary）。
    t['controlBorder'] = t['textPrimary']
    t['controlShadow'] = t['textPrimary']

    t['overlayScrim'] = '#00000099' if theme == 'dark' else '#00000066'

    # 波形に重ねる帯（選択範囲・録音中）。ここだけは透過で持つ。下の波形を隠すと
    # 「どこを選んでいるか」より先に「何が録れているか」が読めなくなるため
    # （DESIGN_SYSTEM.md §5.5）。意味そのものは不透明な輪郭 `accentBorder` /
    # `recSolid` が運ぶので、帯が薄くても情報は落ちない。
    t['selectionOverlay'] = t['accentSolid'] + OVERLAY_ALPHA
    t['recordingOverlay'] = t['recSolid'] + OVERLAY_ALPHA
    return t
