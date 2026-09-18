# AGENTS.md — podsnow で作業する開発 Agent へ

Claude Code と Codex の両方がこのファイルを読む（`CLAUDE.md` はここを参照している）。

## 最初に読むもの（この順で）

1. `PRODUCT.md` — 何を作るか、MVP スコープ
2. `REQUIREMENTS.md` — 要件 ID（FR-xx / NFR-x）
3. `ARCHITECTURE.md` — レイヤー、JS / ネイティブの境界
4. `DATA_MODEL.md` — SQLite スキーマ、タイムラインの不変条件
5. `AUDIO_DESIGN.md` — 録音・割り込み・レンダリング
6. `DEVELOPMENT.md` — ブランチ戦略、規約、テスト、フェーズ計画

文書と実装が矛盾したら、**コードではなく文書を先に直す提案**をする。

## Expo は変わっている

- Expo SDK **57** / React Native **0.86**。API は記憶で断定せず、必ず https://docs.expo.dev/versions/v57.0.0/ を確認してから書く。
- `expo-av` は使わない（非推奨・SDK 55 で削除済み）。再生は `expo-audio`。
- 録音・音声処理は `expo-audio` ではなく `modules/` の自作ネイティブモジュール（理由: ARCHITECTURE.md §4）。
- Expo Go は使わない。Development Build（`npm run ios` / `npm run android`）。

## 守ること

- `src/domain/` に副作用を入れない（ESLint で import 制限。Jest で網羅テスト）。
- 画面（`src/app/`, `src/features/`）からネイティブモジュールや DB を直接呼ばない。`src/services/` を経由する。
- 録音データに触るコード（WAV writer、復旧、削除、`voice_segments` の編集）は必ずテストと一緒に変更する。ラベル `data-safety` の Issue は特に。
- `DATA_MODEL.md` §4.8 の不変条件（同一 Take の同一ソース範囲は声トラック上に高々 1 回）を壊さない。
- 時間はサンプル数（`Smp`、48 kHz）で持ち、UI 表示時だけ ms に変換する。
- 記述には【事実】/【確認済み】/【仮説】を付ける。【確認済み】には出典 URL。

## 作業の進め方

- 必ず GitHub Issue から始める。ブランチは `issue/<番号>-<slug>`、`release/<version>` から切り、同ブランチ宛てに PR（DEVELOPMENT.md §2）。
- `git commit` / `git push` / PR 作成はユーザーの指示があるときのみ。`main` へは直接触らない。
- PR 前に `npm run lint && npm run typecheck && npm test && npm run format:check` を通す。
- 実機でしか検証できない項目（バックグラウンド録音、着信、強制終了）は「未検証」と明記し、Issue に手順をコメントする。検証していないものを完了と言わない。

## よく使うコマンド

```sh
npm run lint / npm run typecheck / npm test / npm run format
npm run ios / npm run android          # Development Build
npx expo prebuild --clean              # ネイティブ再生成（ios/ android/ は Git 管理外）
npx create-expo-module@latest --local  # 新しいローカルモジュール → modules/<name>/
```
