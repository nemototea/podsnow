#!/usr/bin/env python3
"""
デザイントークンの色を決める唯一の場所（DESIGN_SYSTEM.md §5）。

Design system 4（Issue #235）。テーマはダーク 1 つ。**見た目の正は見本
`docs/design-refresh/ds4/mock.html`** で、見本に値がある色はその hex をそのまま使う（`MOCK`）。
OKLCh の往復で 1 段ずれないように、見本の値は変換せずに書き出す。

見本に値が無い色だけを OKLCh で決める（`FIXED`）か、目標コントラスト比から明度を逆算する（`SOLVED`）。
逆算は、面を動かしても文字が追従し、読めない組み合わせが残らないようにするため。

番組の色（アートワークから計算する色。DESIGN_SYSTEM.md §2.6）はトークンに置かない。
`src/ui/showColors.ts` が実行時に計算する。

出典（【確認済み】）:
- コントラスト要件 1.4.3 / 1.4.11: https://www.w3.org/TR/WCAG22/#contrast-minimum
"""

import color as k

THEMES = ('dark',)

# ひとつの色相にひとつの意味。代表色相（塗りの色相）で 30° 以上離す（generate.py が検査）。
# `voice` は無彩色なので色相の比較から外す。
HUES = {
    'rec': 25.0,  # 赤 #FF4D4D（見本 --rec）。録音中
    'mistake': 73.2,  # 琥珀 #FFB340（見本のレベルの帯）。注意・割り込み・音割れ
    'accent': 98.4,  # レモン #FFE34D（見本 --accent）。主操作・選択・完了
    'success': 152.4,  # 緑。完了の通知
    'insert': 202.6,  # ティール。差し込み素材
    'music': 291.5,  # 紫。BGM
    'danger': 355.0,  # ローズ。破壊的操作
}
NEAR_NEUTRAL = ('voice',)

# 見本の色相のまま使うので、30° に届かない組み合わせ。
# レモン（98°）と琥珀（73°）は、黄と橙として見分けがつく（ユーザー判断 2026-10-06、#235。DESIGN_SYSTEM.md §5.2）。
HUE_GAP_EXCEPTIONS = {('mistake', 'accent')}

# ---------------------------------------------------------------- 見本の値（hex のまま）

MOCK = {
    'dark': {
        # 無彩色の面（見本 --bg / --s1 / --s2 / --s3 / --line）
        'bg': '#121212',
        'surface': '#1A1A1A',
        'surfaceRaised': '#242424',
        'surfaceHover': '#2E2E2E',
        'border': '#2F2F2F',
        # 文字（見本 --fg / --sub）
        'textPrimary': '#FFFFFF',
        'textSecondary': '#B3B3B3',
        # 目盛り（見本 --dim）。見本の #7A7A7A は 4.5:1 に届かないので #828282 にした（ユーザー判断 2026-10-06）。
        # bg と surface の上だけで使う（TERTIARY_SURFACES）。
        'textTertiary': '#828282',
        # 副操作ボタンとコピーの輪郭（見本 .btn.sec / .copybtn の #7a7a7a）
        'borderStrong': '#7A7A7A',
        # 焦点（見本 button:focus-visible の --fg）
        'focusRing': '#FFFFFF',
        # アクセント（見本 --accent / --accent-ink、選択中の塊の地 .chunk.sel）
        'accentSolid': '#FFE34D',
        'accentOnSolid': '#000000',
        'accentText': '#FFE34D',
        'accentBorder': '#FFE34D',
        'accentSubtle': '#3D3A22',
        # 録音（見本 --rec）。札「REC」の文字は白（見本 .pill.rec。CONTRAST_EXCEPTIONS）
        'recSolid': '#FF4D4D',
        'recOnSolid': '#FFFFFF',
        # 注意・音割れ（見本 .meter i.on.hot）
        'mistakeSolid': '#FFB340',
        # 波形（見本 .chunk / .chunk:hover / .chunk i）
        'voiceSolid': '#8C8C8C',
        'voiceFill': '#2E2E2E',
        'voiceFillAlt': '#3A3A3A',
        'voiceText': '#FFFFFF',
        # 素材のレーン（見本 .layer.music / .layer.insert。ユーザー判断 2026-10-06）
        'musicFill': '#3E3757',
        'insertFill': '#254146',
        # 見本だけにある値（DESIGN_SYSTEM.md §5.1）
        'waveBar': '#8C8C8C',
        'grabber': '#555555',
        'avatar': '#535353',
        'pillStrong': '#2A2A2A',
        # 白い通知（見本 .toast）
        'inverseSurface': '#FFFFFF',
        'inverseText': '#000000',
    },
}

# ---------------------------------------------------------------- 見本に無い色（L, C, h）

FIXED = {
    'dark': {
        'accentSolidPressed': (0.8600, 0.1600, 98.4),
        'recSubtle': (0.3000, 0.0700, 25.0),
        'dangerSolid': (0.7000, 0.1900, 355.0),
        'dangerSolidPressed': (0.6500, 0.1900, 355.0),
        'dangerOnSolid': (0.0000, 0.0000, 0.0),
        'dangerSubtle': (0.3000, 0.0600, 355.0),
        'voiceSubtle': (0.2768, 0.0000, 0.0),
        'musicSolid': (0.7091, 0.1656, 291.5),
        'musicOnSolid': (0.0000, 0.0000, 0.0),
        'musicFillAlt': (0.3880, 0.0645, 293.8),
        'musicSubtle': (0.3097, 0.0376, 295.1),
        'insertSolid': (0.7510, 0.1190, 202.6),
        'insertOnSolid': (0.0000, 0.0000, 0.0),
        'insertFillAlt': (0.3928, 0.0399, 210.8),
        'insertSubtle': (0.3237, 0.0289, 210.5),
        'mistakeFill': (0.3700, 0.0500, 73.2),
        'mistakeFillAlt': (0.4100, 0.0560, 73.2),
        'mistakeSubtle': (0.3400, 0.0450, 73.2),
        'successSolid': (0.7714, 0.1652, 152.4),
        'successSubtle': (0.3376, 0.0451, 153.8),
    },
}

# ---------------------------------------------------------------- 逆算する段（C, h, 目標比）

# 本文が載りうる面。文字と境界は、このうち（と自分の淡い地のうち）いちばん比を稼げない面から逆算する。
TEXT_SURFACES = ('bg', 'surface', 'surfaceRaised', 'surfaceHover')

# 目盛りの文字（textTertiary）が載る面。見本は波形パネル（surface）の上だけで使う。
TERTIARY_SURFACES = ('bg', 'surface')

SOLVED = {
    'dark': {
        'textDisabled': (0.0000, 0.0, 3.00),
        'dangerText': (0.1500, 355.0, 4.50),
        'dangerBorder': (0.1700, 355.0, 3.00),
        # 見本の赤 #FF4D4D は surfaceHover の上で 4.15:1。文字に使うときだけ逆算した色にする（§5.1）。
        'recText': (0.1900, 25.0, 4.50),
        'musicText': (0.1400, 291.5, 4.50),
        'musicBorder': (0.1500, 291.5, 3.00),
        'insertText': (0.1100, 202.6, 4.50),
        'insertBorder': (0.1100, 202.6, 3.00),
        'mistakeText': (0.1400, 73.2, 4.50),
        'mistakeBorder': (0.1400, 73.2, 3.00),
        'voiceBorder': (0.0000, 0.0, 3.00),
        'successText': (0.1500, 152.4, 4.50),
    },
}

# どの面に対して逆算するか。書いていない役割は TEXT_SURFACES（と自分の淡い地）。
SOLVE_AGAINST: dict[str, tuple[str, ...]] = {}

# 基準に届かないことを承知で採った組み合わせ（前景, 背景）: 理由。generate.py は検査せず、一覧を出す。
CONTRAST_EXCEPTIONS = {
    ('recOnSolid', 'recSolid'): (
        '録音中の札「REC」は見本どおり赤の地に白の文字（3.27:1）。ユーザー判断 2026-10-06（#235）'
    ),
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
    t = dict(MOCK[theme])
    for name, lch in FIXED[theme].items():
        t[name] = _hex(lch)
    for role, (C, h, target) in SOLVED[theme].items():
        against = [t[s] for s in SOLVE_AGAINST.get(role, TEXT_SURFACES)]
        subtle = _subtle_of(role)
        if subtle and role not in SOLVE_AGAINST:
            against.append(t[subtle])
        t[role] = _solve(C, h, target, against, lighter=True)

    t['overlayScrim'] = '#00000099'
    # 波形に重ねる帯（選択範囲・録音中）。ここだけは透過で持つ。下の波形を隠すと
    # 「どこを選んでいるか」より先に「何が録れているか」が読めなくなるため
    # （DESIGN_SYSTEM.md §5.4）。意味そのものは不透明な輪郭 `accentBorder` /
    # `recSolid` が運ぶので、帯が薄くても情報は落ちない。
    t['selectionOverlay'] = t['accentSolid'] + OVERLAY_ALPHA
    t['recordingOverlay'] = t['recSolid'] + OVERLAY_ALPHA

    return t
