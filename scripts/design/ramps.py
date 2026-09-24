#!/usr/bin/env python3
"""
デザイントークンの色を決める唯一の場所（DESIGN_SYSTEM.md §5）。

`color.py` の OKLCh で計算する。目分量の hex をここにも他のどこにも置かない。

二種類の段がある。

- **面と塗り**は OKLCh（明度・彩度・色相）を決め打ちする。読みやすさではなく見た目の決めごとだから。
- **文字と境界**は彩度と色相だけを決め、明度は目標コントラスト比から逆算する。面を動かしても
  勝手に追従し、読めない組み合わせが残らない。

Design system 2（Issue #94）で、面をグラファイト、主操作をシトロン、録音をコーラル、
破壊的操作をローズにした。値は受け取った設計の色をそのまま再現する OKLCh にしてあり、
文字と境界の目標比はその設計が実際に持っていた比（小数第 2 位で切り捨て）。
生成結果と設計値の差は DESIGN_SYSTEM.md §5.4 に記録している。

出典（【確認済み】）:
- 段ごとの役割: https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- コントラスト要件 1.4.3 / 1.4.11: https://www.w3.org/TR/WCAG22/#contrast-minimum
"""

import color as k

THEMES = ('dark', 'light')

# ひとつの色相にひとつの意味。代表色相（塗りの色相）で 40° 以上離す（generate.py が検査）。
# `voice` は無彩色に近いミネラルなので色相の比較から外す（彩度が低く、色相で区別させない）。
HUES = {
    'danger': 2.4,  # ローズ。破壊的操作
    'rec': 35.7,  # コーラル。録音中
    'mistake': 68.5,  # アンバー。注意・編集の目印
    'accent': 119.1,  # シトロン。主操作・選択状態
    'success': 162.5,  # グリーン。完了
    'insert': 230.9,  # ブルー。差し込み素材
    'music': 288.8,  # ライラック。BGM
}
NEAR_NEUTRAL = ('voice',)

# ---------------------------------------------------------------- 決め打ちの段（L, C, h）

FIXED = {
    'dark': {
        'controlShadow': (0.12, 0.0062, 236.9),
        'bg': (0.1889, 0.0062, 236.9),
        'surface': (0.2397, 0.0094, 234.1),
        'surfaceRaised': (0.2848, 0.0112, 237.0),
        'surfaceHover': (0.3318, 0.0119, 232.8),
        'border': (0.3850, 0.0135, 235.2),
        'textPrimary': (0.9615, 0.0057, 128.5),
        'accentSolid': (0.9177, 0.1645, 119.1),
        'accentSolidPressed': (0.8259, 0.1592, 119.1),
        'accentOnSolid': (0.2277, 0.0448, 126.2),
        'accentSubtle': (0.3314, 0.0463, 125.4),
        'recSolid': (0.7539, 0.1504, 35.7),
        'recOnSolid': (0.2148, 0.0315, 36.3),
        'recSubtle': (0.2930, 0.0385, 34.7),
        'dangerSolid': (0.7887, 0.1096, 2.4),
        'dangerSolidPressed': (0.7201, 0.1148, 2.7),
        'dangerOnSolid': (0.2323, 0.0510, 358.7),
        'dangerSubtle': (0.2818, 0.0435, 353.3),
        'voiceSolid': (0.9010, 0.0112, 226.0),
        'voiceFill': (0.3482, 0.0200, 233.7),
        'voiceFillAlt': (0.3933, 0.0215, 235.1),
        'voiceSubtle': (0.3020, 0.0197, 236.2),
        'musicSolid': (0.7935, 0.1028, 288.8),
        'musicFill': (0.3385, 0.0471, 292.2),
        'musicFillAlt': (0.3924, 0.0539, 293.8),
        'musicSubtle': (0.2928, 0.0344, 291.4),
        'insertSolid': (0.8231, 0.0880, 230.9),
        'insertFill': (0.3536, 0.0393, 234.0),
        'insertFillAlt': (0.4038, 0.0429, 231.8),
        'insertSubtle': (0.3003, 0.0270, 238.0),
        'mistakeSolid': (0.8415, 0.0944, 68.5),
        'mistakeFill': (0.3615, 0.0317, 72.3),
        'mistakeFillAlt': (0.4163, 0.0380, 72.7),
        'mistakeSubtle': (0.3051, 0.0226, 66.8),
        'successSolid': (0.8236, 0.0901, 162.5),
        'successSubtle': (0.3155, 0.0316, 169.4),
    },
    'light': {
        'controlShadow': (0.2500, 0.0040, 150.0),
        'bg': (0.9730, 0.0040, 95.0),
        'surface': (1.0000, 0.0000, 89.9),
        'surfaceRaised': (0.9410, 0.0040, 95.0),
        'surfaceHover': (0.9130, 0.0040, 95.0),
        'border': (0.8100, 0.0040, 95.0),
        'textPrimary': (0.2500, 0.0040, 150.0),
        'accentSolid': (0.9177, 0.1645, 119.1),
        'accentSolidPressed': (0.8259, 0.1592, 119.1),
        'accentOnSolid': (0.2277, 0.0448, 126.2),
        'accentSubtle': (0.9309, 0.0433, 120.0),
        'recSolid': (0.5097, 0.1519, 35.9),
        'recOnSolid': (1.0000, 0.0000, 89.9),
        'recSubtle': (0.9377, 0.0229, 57.0),
        'dangerSolid': (0.4637, 0.1558, 6.9),
        'dangerSolidPressed': (0.3952, 0.1342, 7.6),
        'dangerOnSolid': (1.0000, 0.0000, 89.9),
        'dangerSubtle': (0.9396, 0.0232, 357.4),
        'voiceSolid': (0.4394, 0.0324, 230.0),
        'voiceFill': (0.9193, 0.0111, 226.0),
        'voiceFillAlt': (0.8800, 0.0157, 222.7),
        'voiceSubtle': (0.9451, 0.0070, 219.6),
        'musicSolid': (0.4965, 0.1131, 295.4),
        'musicFill': (0.9195, 0.0237, 301.9),
        'musicFillAlt': (0.8789, 0.0366, 301.4),
        'musicSubtle': (0.9474, 0.0168, 304.8),
        'insertSolid': (0.5086, 0.0969, 237.2),
        'insertFill': (0.9312, 0.0193, 230.7),
        'insertFillAlt': (0.8878, 0.0229, 233.4),
        'insertSubtle': (0.9524, 0.0134, 233.7),
        'mistakeSolid': (0.4865, 0.0943, 68.1),
        'mistakeFill': (0.9225, 0.0313, 75.2),
        'mistakeFillAlt': (0.8853, 0.0390, 80.0),
        'mistakeSubtle': (0.9524, 0.0210, 79.1),
        'successSolid': (0.4865, 0.0898, 162.4),
        'successSubtle': (0.9425, 0.0182, 161.1),
    },
}

# ---------------------------------------------------------------- 逆算する段（C, h, 目標比）

# 本文が載りうる面。文字と境界は、このうち（と自分の淡い地のうち）いちばん比を稼げない面から逆算する。
TEXT_SURFACES = ('bg', 'surface', 'surfaceRaised', 'surfaceHover')

SOLVED = {
    'dark': {
        'textSecondary': (0.0114, 226.0, 7.04),
        'textTertiary': (0.0151, 231.3, 5.52),
        'textDisabled': (0.0164, 229.1, 4.04),
        'borderStrong': (0.0166, 229.1, 3.69),
        'dangerText': (0.1018, 2.4, 6.82),
        'dangerBorder': (0.1087, 1.3, 4.25),
        'recText': (0.1060, 37.9, 6.61),
        'musicText': (0.0775, 289.6, 7.61),
        'musicBorder': (0.0866, 290.9, 4.81),
        'insertText': (0.0670, 234.3, 8.48),
        'insertBorder': (0.0720, 230.3, 5.05),
        'mistakeText': (0.0761, 66.6, 8.14),
        'mistakeBorder': (0.0844, 70.7, 5.12),
        'voiceBorder': (0.0291, 232.8, 5.19),
        'successText': (0.0701, 163.3, 8.45),
    },
    'light': {
        'textSecondary': (0.0040, 150.0, 6.93),
        'textTertiary': (0.0040, 150.0, 5.59),
        'textDisabled': (0.0040, 150.0, 3.77),
        'borderStrong': (0.0040, 150.0, 6.00),
        'accentText': (0.0933, 124.5, 6.96),
        'accentBorder': (0.1111, 123.8, 4.23),
        'focusRing': (0.1073, 125.4, 5.37),
        'dangerText': (0.1529, 7.4, 6.60),
        'dangerBorder': (0.1601, 7.5, 5.31),
        'recText': (0.1388, 35.9, 6.12),
        'voiceText': (0.0354, 228.5, 8.63),
        'voiceBorder': (0.0364, 229.9, 3.74),
        'musicText': (0.1147, 293.8, 6.96),
        'musicBorder': (0.0974, 297.0, 3.73),
        'insertText': (0.0904, 238.4, 5.84),
        'insertBorder': (0.0808, 235.0, 3.77),
        'mistakeText': (0.0871, 67.0, 6.66),
        'mistakeBorder': (0.0917, 71.4, 3.84),
        'successText': (0.0835, 161.1, 6.11),
    },
}

# dark では塗りそのものが文字・輪郭として十分に明るいので、同じ値を使う（別の段を作らない）。
SAME_AS = {
    'dark': {
        'accentText': 'accentSolid',
        'accentBorder': 'accentSolidPressed',
        'focusRing': 'accentSolid',
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

    # ブランドの点は本文色から独立。表示先 bg / surface に対して 3:1 を守る。
    t['brandAccent'] = t['accentSolid'] if lighter else _solve(0.18, HUES['accent'], 3.1, [t['bg'], t['surface']], False)
    t['controlBorder'] = t['borderStrong'] if lighter else t['textPrimary']

    t['overlayScrim'] = '#00000099' if theme == 'dark' else '#00000066'

    # 波形に重ねる帯（選択範囲・録音中）。ここだけは透過で持つ。下の波形を隠すと
    # 「どこを選んでいるか」より先に「何が録れているか」が読めなくなるため
    # （DESIGN_SYSTEM.md §5.5）。意味そのものは不透明な輪郭 `accentBorder` /
    # `recSolid` が運ぶので、帯が薄くても情報は落ちない。
    t['selectionOverlay'] = t['accentSolid'] + OVERLAY_ALPHA
    t['recordingOverlay'] = t['recSolid'] + OVERLAY_ALPHA
    return t
