# PodsNow ブランドマーク

## 表記

**PodsNow（ポッズナウ）**。`Pods` = エピソード、`Now` = いま録って、いま出す。

「PodSnow」「ポッドスノウ」は誤り。識別子（リポジトリ名 / `slug` / `scheme` /
bundle id / package / モジュール名 / バックアップ拡張子 `.podsnow`）は小文字の
`podsnow` のままで、これは綴りであって「Snow」の意味は持たせない。

## マーク

**マイク + レベルメーター**。

収録画面とWaveformがアプリ内で実際に出している形をそのまま持ってきている。
「声が録れている = いま」を表す。

0.1.0 の途中まではマイク + **雪の結晶**だった（Issue #82 で差し替え）。名前の
読み違いが絵として残っていたもので、意味としても product と合っていなかった。

差し替えの検討で**意図的に避けた**もの:

| 案 | 避けた理由 |
|---|---|
| 雪・氷・冬のモチーフ | 名前の誤読をそのまま再生産する |
| 電波 / Wi-Fi 的に扇状へ開く弧 | このアプリはネットワークを使わない（REQUIREMENTS.md NFR-2）。意味が矛盾する |
| 単体の赤い丸（REC ドット） | 通知バッジやエラー表示に見える |

## 色

dark トークンと同じ値を使う。マークのために別の色を作らない。

この決めごとは文章ではなくコードで守っている。`scripts/brand/geometry.py` が
トークンの生成元（`scripts/design/ramps.py`）を直接読むので、トークンを変えれば
マークも必ず追従する。値の一覧は `python3 scripts/design/generate.py` の出力を見る。

| 用途 | トークン |
|---|---|
| マイク本体 | `accentSolid` |
| レベルメーター | `voiceSolid` |
| 背景 | `bg` |
| モノクロ版 | `textPrimary` |

背景を変えたら `app.json` の `backgroundColor`（スプラッシュとアダプティブアイコン）も
合わせる。

## ファイル

`mark-*.svg` がこのディレクトリの成果物（デザイン作業の受け渡し用）。
アプリが実際に読むのは `assets/images/` 配下の PNG。

| ファイル | 用途 |
|---|---|
| `mark-dark.svg` | 背景込み。資料・ストア掲載用 |
| `mark-transparent.svg` | 透過。アダプティブアイコンと同じ倍率 |
| `mark-monochrome.svg` | 単色。Android のテーマアイコン用 |

## 再生成

```sh
python3 scripts/brand/generate.py
```

Python 標準ライブラリだけで動く（追加の依存もデザインツールも不要）。
`assets/images/` の PNG と、このディレクトリの SVG をまとめて上書きする。

**PNG も SVG も直接編集しない。** 図形の定義は `scripts/brand/geometry.py` の
1 箇所だけにあり、両方をそこから生成しているので、直接いじるとずれる。

## 倍率とアダプティブアイコンの安全域

Android のアダプティブアイコンは前景の**中央 66%（半径 338px / 1024px 中）**しか
見える保証がない。旧アイコンは雪の結晶が半径 498px まで伸びていて、丸マスクの
端末では欠けていた。

`generate.py` は生成前にこれを検査し、はみ出していれば失敗する。

| 用途 | 倍率 | 最大描画半径 |
|---|---|---|
| アダプティブ前景 / モノクロ | 1.0 | 299px（安全域 338px 以内） |
| iOS アイコン・`icon.png` | 1.28 | 383px（マスク無しなので余白を詰める） |
| スプラッシュ・favicon | 1.6 | 478px |

## 注意

- `icon.png` は**アルファを持たない RGB**。iOS のアプリアイコンの要件。
- `android-icon-background.png` は単色。`app.json` の
  `android.adaptiveIcon.backgroundColor` と同じ値にしておく。
- アイコンを変えたら `npx expo prebuild --clean` → 再ビルドが必要。
