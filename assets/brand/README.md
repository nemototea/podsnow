# PodsNow. のロゴとアイコン

> 【事実】Issue #235（ユーザー判断 2026-10-06）でロゴとアイコンを作り直した（案 A）。
> 見た目の正は見本 `docs/design-refresh/ds4/mock.html` の `.lg-icon`（アイコン）と `.wm`（横組み）。

## 表記

**PodsNow（ポッズナウ）**。表示ロゴは末尾に点を付けた **PodsNow.**。`Pods` = エピソード、`Now` = いま録って、いま出す。

「PodSnow」「ポッドスノウ」は誤り。識別子（リポジトリ名 / `slug` / `scheme` / bundle id / package /
モジュール名）は小文字の `podsnow` のままで、これは綴りであって
「Snow」の意味は持たせない。

## ロゴ（Issue #94 → #190 → #235）

**サービス名そのものをロゴにする。** #235 から **Figtree**（SIL OFL 1.1）の 900 の字形を土台に、字間を詰めて光学調整し、
末尾の点だけをアクセントのレモンにする。版ズレ・網点・輪郭線は付けない。
字形は輪郭（パス）として焼き込むので、通常のテキストで打ち直して近似しない。

**配置は見本の CSS を計算で再現する**（`scripts/brand/geometry.py` の冒頭）。字送りは HarfBuzz で組んだ値（ブラウザと同じくカーニング込み）、
字間は letter-spacing（アイコン -0.05em、横組み -0.045em）、行の高さは line-height 0.9 で、2 行を左端そろえで積んだ箱をキャンバスの中央に置く。
【事実】2026-10-06、見本と同じ CSS を Chromium で 1024px に描いた画像と `assets/images/icon.png` を比べ、塗られた範囲が 1px 以内で一致し、
差は字の縁のアンチエイリアスだけであることを確かめた。横組みの箱の幅も一致した（字の大きさ 100 で 442.8px）。

- 横組み `PodsNow.`: Home の上部、スプラッシュ、ストア素材。改行しない。`Pods` と `Now` の間に空白を入れない。
- 2 段 `Pods` / `Now.`: アプリアイコン。2 段でも全文を残し、左端を共有する。
  字の大きさはアイコンの辺の 0.29 倍、文字の箱を**縦横とも中央**に置く。地はアプリと同じ黒（`bg`）、文字は白、点はレモン。
  小さいアイコン（`icon-small`、favicon）も同じ組み方（見本の 29px で読めることを確かめた）。
- Android のアダプティブ前景と単色は見本に無いので、同じ組み方のまま字の大きさを 0.193 倍にする。
  文字の箱の幅が見える円（直径 683px）に占める割合を、iOS のアイコン（辺の 66.6%）とそろえた。
- 点は録音の印・通知・エラーに転用しない。常時点灯やアニメーションをしない。
- 見送った案（2026-10-06）: 黄の丸に黒いカプセルの記号（全文を残す方針に反し、他社の丸いマークに近い）、
  アイコン全体を黄の地にする案（A で足りる）。理由の詳細は DESIGN_SYSTEM.md §3.1。

### 使わないモチーフ

| 案 | 避ける理由 |
|---|---|
| マイク + レベルメーター（0.1.0 の途中まで） | 汎用の収録アプリに見え、サービス名が残らない。Issue #94 で廃止 |
| 雪・氷・冬のモチーフ | 名前の誤読（PodSnow）をそのまま再生産する（Issue #82 で廃止済み） |
| 電波 / Wi-Fi 的に扇状へ開く弧 | このアプリはネットワークを使わない（REQUIREMENTS.md NFR-2） |
| 単体の赤い丸（REC ドット） | 通知バッジやエラー表示に見える |
| P / N だけの頭文字マーク、記号だけのマーク | 小さくしても全文を残す方針に反する |
| 網点・版ズレ（#190） | #235 で画面から飾りをなくした。ロゴにだけ残すと画面と合わない |

## 色

ロゴのために別の色を作らない。`scripts/brand/geometry.py` がトークンの生成元（`scripts/design/ramps.py`）を
直接読むので、トークンを変えればロゴも追従する（DESIGN_SYSTEM.md §3.2）。

| 用途 | 文字 | 点 | 背景 |
|---|---|---|---|
| 横組み | `textPrimary`（白） | `accentSolid`（レモン） | 透過（スプラッシュは `bg`） |
| アプリアイコン | 白 | `accentSolid` | `bg`（黒） |
| 単色 | 黒 | 黒 | 透過 |

- 明るい地に置く資料には単色版を使う。#190 の明るい地用の横組み（`wordmark-light.svg`）は作らない。
- 背景を変えたら `app.json`（スプラッシュ、アダプティブ背景）も合わせる。ずれていると `generate.py` が失敗する。

## ファイル

| ファイル | 用途 |
|---|---|
| `wordmark-dark.svg` / `wordmark-mono.svg` | 横組み。資料・ストア掲載 |
| `app-icon.svg` | iOS / ストアのアイコン（全面） |
| `icon-small.svg` | 32px 以下（余白を詰めて文字を大きく） |
| `android-foreground.svg` / `android-monochrome.svg` | Android アダプティブ前景・テーマアイコン |

アプリが実際に読むのは `assets/images/` の PNG と、アプリ内ロゴのデータ `src/ui/brand/wordmark.ts`。

## 再生成

```sh
python3 scripts/brand/generate.py
```

標準ライブラリだけで動く。PNG・SVG・`src/ui/brand/wordmark.ts` をまとめて上書きする。**直接編集しない。**
字形そのものを変えるときだけ `python3 scripts/brand/extract_glyphs.py <Figtree[wght].ttf>`（fontTools と uharfbuzz が必要）で
`scripts/brand/glyphs.py` を作り直す。可変フォントから 900 のインスタンスを切り出し、`PodsNow.` / `Pods` / `Now.` を HarfBuzz で組む。

## 安全域

Android のアダプティブアイコンは前景の**中央 66%（半径 338px / 1024px 中）**しか見える保証がない。
`generate.py` は生成前にこれを検査し、はみ出していれば失敗する。

アイコンの 2 段組は、`geometry.py` の `ICON_LINES` などで行の大きさと行間だけを決め、位置は
`two_lines` が**実際の描画範囲の中心をキャンバス中心に合わせて**決める。`top` / `left` を手で
合わせると、字形のサイドベアリングや行間の見込み違いで上下左右にずれる（Android のランチャーで
上ずって見えた）。

Android 12+ のスプラッシュ（SplashScreen API）は、画像を `imageWidth` dp の正方形に収めて 288dp の枠の
中央に置き、**直径 192dp の円で切り抜く**。横長のロゴは四隅までこの円に入らないと左右が欠けるので、
`app.json` の `expo-splash-screen` で `android.imageWidth` を 176 にしている（iOS は 240 のまま）。
`generate.py` はロゴの最大半径が 90dp（192dp の円から余白 6dp）を超えると失敗する。

## 注意

- `icon.png` は**アルファを持たない RGB**。iOS のアプリアイコンの要件。角丸は焼き込まない。
- `android-icon-background.png` は単色（`bg` の黒）。
- アイコンを変えたら `npx expo prebuild --clean` → 再ビルドが必要。

【事実】#235 からアプリはダーク 1 つなので、スプラッシュも OS の配色によらず黒の地 1 つにした
（`splash-icon.png` だけを使う。`splash-icon-light.png` と `app.json` の `dark` 設定は外した。`generate.py` が `app.json` を検査する）。
変更後はネイティブを再生成・再ビルドする。両 OS のリリースビルドでの表示は未検証。
