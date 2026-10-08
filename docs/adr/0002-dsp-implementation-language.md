# ADR 0002: 音声処理（DSP）は Swift / Kotlin で二重実装する（C++ 共通コアは採用しない）

- 状態: 採用（2026-09-19）
- 関連: Issue #12、ARCHITECTURE.md §5.3 A-2、AUDIO_DESIGN.md §8

## 背景

ミックス・BS.1770 ラウドネス測定・ダッキング・リミッターを、(a) Swift と Kotlin で二重実装するか、(b) C++ の共通コアを Expo Module から呼ぶかを比較する必要があった（ARCHITECTURE.md §5.3）。

## 決定

(a) **Swift / Kotlin の二重実装**を採用する。両実装は同じ構造（`WavReader` / `Mixer` / `LoudnessMeter` / `TruePeakMeter` / `Limiter` / `RenderJob` / `TimelinePlayer` / `AssetImporter`）と同じアルゴリズム（係数・ブロック長・ゲート・先読み長）を持ち、Kotlin 版をリファレンスとして Swift 版を写経する。

## 理由

- Expo Modules API の公式案内は「C++ を使うなら Turbo Modules」であり【確認済み】(https://docs.expo.dev/modules/overview/)、ObjC++ ブリッジ + JNI + CMake を自前で組むとビルド構成の複雑さが 2 倍になる。
- DSP の量は 1 プラットフォームあたり 600 行程度で、同期コストは限定的。
- 開発環境の制約（本セッションでは Xcode 26 が無く iOS をコンパイルできない）下では、Android（Kotlin）だけでも独立に検証できる方が進めやすい。
- 出力一致（NFR-6）は「同じアルゴリズム・同じ定数」を守ることと、ゴールデンファイルテストで担保する。

## 影響

- アルゴリズムの変更は必ず両方に入れる（PR チェックリストに追加）。
- ゴールデンファイル（`fixtures/audio/`）による両 OS の出力比較を Phase 3 の実機検証で行う。
- 将来 C++ に寄せる場合も、モジュールの JS 側 API（`podsnow-audio-engine`）は変えない。

## 未検証

- 両実装の浮動小数演算順序の差（Float / Double の使い分け）で ±1 LSB を超える差が出る可能性【仮説】。
