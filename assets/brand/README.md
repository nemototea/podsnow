# PodsNow. のロゴとアイコン

## 表記

**PodsNow（ポッズナウ）**。表示ロゴは末尾に点を付けた **PodsNow.**。`Pods` = エピソード、`Now` = いま録って、いま出す。

「PodSnow」「ポッドスノウ」は誤り。識別子（リポジトリ名 / `slug` / `scheme` / bundle id / package /
モジュール名 / バックアップ拡張子 `.podsnow`）は小文字の `podsnow` のままで、これは綴りであって
「Snow」の意味は持たせない。

## ロゴ（Issue #94）

**サービス名そのものをロゴにする。** Manrope ExtraBold（800、SIL OFL 1.1）の字形を土台に、
`Po / od / ds / sN / No / ow` の字間を調整し、末尾の点を独立した角丸正方形として描く。
字形は輪郭（パス）として焼き込むので、通常のテキストで打ち直して近似しない。

- 横組み `PodsNow.`: Home の上部、スプラッシュ、ストア素材。改行しない。`Pods` と `Now` の間に空白を入れない。
- 2 段 `Pods` / `Now.`: アプリアイコン。2 段でも全文を残し、両行の見かけの幅をそろえて左端を共有する。
- 点は録音ランプ・通知・エラーに転用しない。常時点灯やアニメーションをしない。

### 使わないモチーフ

| 案 | 避ける理由 |
|---|---|
| マイク + レベルメーター（0.1.0 の途中まで） | 汎用の収録アプリに見え、サービス名が残らない。Issue #94 で廃止 |
| 雪・氷・冬のモチーフ | 名前の誤読（PodSnow）をそのまま再生産する（Issue #82 で廃止済み） |
| 電波 / Wi-Fi 的に扇状へ開く弧 | このアプリはネットワークを使わない（REQUIREMENTS.md NFR-2） |
| 単体の赤い丸（REC ドット） | 通知バッジやエラー表示に見える |
| P / N だけの頭文字マーク | 小さくしても全文を残す方針に反する |

## 色

ロゴのために別の色を作らない。`scripts/brand/geometry.py` がトークンの生成元（`scripts/design/ramps.py`）を
直接読むので、トークンを変えればロゴも追従する。

| 用途 | 文字 | 点 | 背景 |
|---|---|---|---|
| 横組み（ダーク） | `textPrimary` | `accentText`（シトロン） | 透過（スプラッシュは `bg`） |
| 横組み（ライト） | light `textPrimary` | light `accentText` | 透過 |
| アプリアイコン | `accentOnSolid` | `accentOnSolid` | `accentSolid` |
| 単色 | 黒 | 黒 | 透過 |

背景を変えたら `app.json`（スプラッシュ `#111416`、アダプティブ背景 `#D8F36A`）も合わせる。
ずれていると `generate.py` が失敗する。

## ファイル

| ファイル | 用途 |
|---|---|
| `wordmark-dark.svg` / `wordmark-light.svg` / `wordmark-mono.svg` | 横組み。資料・ストア掲載 |
| `app-icon.svg` | iOS / ストアのアイコン（全面） |
| `icon-small.svg` | 32px 以下（余白を詰めて文字を大きく） |
| `android-foreground.svg` / `android-monochrome.svg` | Android アダプティブ前景・テーマアイコン |

アプリが実際に読むのは `assets/images/` の PNG と、アプリ内ロゴのデータ `src/ui/brand/wordmark.ts`。

## 再生成

```sh
python3 scripts/brand/generate.py
```

標準ライブラリだけで動く。PNG・SVG・`src/ui/brand/wordmark.ts` をまとめて上書きする。**直接編集しない。**
字形そのものを変えるときだけ `python3 scripts/brand/extract_glyphs.py <Manrope[wght].ttf>`（fontTools が必要）で
`scripts/brand/glyphs.py` を作り直す。

## 安全域

Android のアダプティブアイコンは前景の**中央 66%（半径 338px / 1024px 中）**しか見える保証がない。
`generate.py` は生成前にこれを検査し、はみ出していれば失敗する（現在の前景は最大 300px）。

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
- `android-icon-background.png` は単色（`accentSolid`）。
- アイコンを変えたら `npx expo prebuild --clean` → 再ビルドが必要。
