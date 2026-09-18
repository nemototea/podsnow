# DEVELOPMENT.md — podsnow 開発ガイド

> 凡例: **【事実】** 対話で決定した仕様 / **【確認済み】** 公式ドキュメント等で確認済み（出典付き） / **【仮説】** 未検証・要スパイク

## 1. 開発環境【事実】

- macOS、Xcode（SDK 57 は Xcode 27 / iOS 27 SDK を想定【確認済み】https://expo.dev/changelog/sdk-57）、Android Studio（Android 14 / 15 の実機またはエミュレータ）
- VS Code をメイン IDE
- Node.js LTS、npm（パッケージマネージャは npm を既定【仮説: 変更可】）、Watchman、CocoaPods、JDK 17【仮説: SDK 57 の要求バージョンは docs で確認】
- 開発 Agent: Claude Code、Codex（§8）

## 2. リポジトリ

- リモート: https://github.com/nemototea/podsnow（初期状態は空リポジトリ）
- ローカル: `git init` → `git remote add origin …` → 最初のコミットは設計文書のみ。
- ブランチ: `main` を保護対象とし、作業は `feat/…` `fix/…` `docs/…` ブランチ → PR → squash merge【仮説: 一人開発なので簡略化可】
- コミットメッセージ: Conventional Commits（`feat:`, `fix:`, `docs:`, `chore:`, `native:`）
- `.gitignore`: `node_modules/`, `ios/`, `android/`（prebuild 生成物。CNG 運用【仮説】）, `.expo/`, `*.log`, `.DS_Store`, `*.wav` 等のテスト用大容量音源（`fixtures/` の小さなものは除く）

## 3. セットアップ手順（予定）

```sh
git clone git@github.com:nemototea/podsnow.git && cd podsnow
npm install
npx expo prebuild            # ios/ android/ を生成（ローカルモジュールに必要）【確認済み】
npx expo run:ios             # Development Build を実機/シミュレータへ
npx expo run:android
```

- Expo Go は使わない（ローカルネイティブモジュールを含むため）。【事実】
- `ios/` `android/` を Git 管理外にする（Continuous Native Generation）か、コミットするかは Phase 0 で決める。ネイティブモジュールは `modules/` にあるので、いずれでも可【仮説】。

## 4. プロジェクト規約

### 4.1 TypeScript
- `strict: true`、`noUncheckedIndexedAccess: true`。
- ドメイン層は副作用禁止（ESLint の import 制限で `infra/` を参照不可にする）。
- 時間の型は `Smp`（サンプル数）と `Ms` をブランド型で区別する【仮説】。

### 4.2 Lint / Format
- ESLint（`eslint-config-expo` 基準）+ Prettier。`npm run lint` / `npm run typecheck` を CI で必須化。

### 4.3 ネイティブ
- Swift: SwiftLint【仮説】。Kotlin: ktlint【仮説】。
- ネイティブ側の公開 API は `modules/<name>/src/index.ts` に型定義し、JS からはそこだけを import する。
- ネイティブで「録音データが宙に浮く」状態を作らない（Segment 確定 → 通知の順を守る）。

### 4.4 ドキュメント
- 仕様変更は必ず該当 `.md` を更新してからコードを書く（設計と実装の乖離を防ぐ）。
- 記述には **【事実】/【確認済み】/【仮説】** のいずれかを付ける。【確認済み】には出典 URL を付ける。
- Expo / React Native / OS の API を **記憶で断定しない**。docs.expo.dev、developer.apple.com、developer.android.com を確認してから書く。【事実】
- 大きめの技術判断は `docs/adr/NNNN-*.md` に ADR として残す。

## 5. テスト戦略

| 層 | 手段 | 対象 |
|---|---|---|
| domain（純粋 TS） | Jest | タイムライン計算、範囲削除、無音カット計画、Undo の逆操作、テンプレート展開、復旧判定。プロパティベーステスト（fast-check）を検討【仮説】 |
| services | Jest + fake infra | 録音セッション状態機械、復旧フロー、書き出しジョブ |
| infra/db | Jest（better-sqlite3 でスキーマと移行を検証【仮説】）| 移行の前進・冪等性 |
| ネイティブ | XCTest / JUnit | WAV writer、ヘッダ修復、ピーク生成、無音検出、BS.1770 測定（ゴールデンファイル） |
| 実機 | 手動チェックリスト（`docs/device-checklist.md`） | 割り込み、画面ロック、強制終了、ストレージ枯渇、入力切替 |
| E2E | Maestro【仮説】 | 主要フロー（新規 → 録音 → 停止 → 書き出し） |

ゴールデンファイル: `fixtures/audio/` に短い WAV（数秒）と期待される LUFS / ピーク値、期待レンダ結果のハッシュを置く。

## 6. フェーズ計画【仮説: 順序は変更可】

| Phase | 内容 | 完了条件 |
|---|---|---|
| 0. 骨組みとスパイク | Expo プロジェクト生成、expo-router、SQLite + 移行、`modules/` 雛形、AUDIO_DESIGN.md §11 の S-1〜S-5, S-9 | 両 OS で 30 分バックグラウンド録音が欠けない。技術判断（Drizzle、C++ コア）を ADR 化 |
| 1. 収録 | Home / 新規 / Editor（録音部分）、Take・Segment 永続化、復旧、レベル計、入力選択、マーカー、トークテーマ、ジングル挿入イベント | 自分の番組を 1 本収録できる。強制終了しても復元できる |
| 2. 編集 | 波形、タイムライン再生、範囲削除、無音カット、並び替え、パンチイン、素材挿入・位置・音量、Undo/Redo 永続化 | 収録した回を編集して聴ける |
| 3. 書き出し | ミックス、ラウドネス、ダッキング、AAC / WAV、共有・保存、Distribution Pack、書き出し履歴 | 配信サービスへ投稿できる |
| 4. Show と仕上げ | Show Assets、既定構成、概要欄テンプレート、設定、テーマ、バックアップ / 復元、ストレージ管理 | 成功基準（PRODUCT.md §8）を満たす |
| 5. 次フェーズ候補 | MP3 / FLAC、ノイズ除去、OS 音声認識、ローカル LLM、編集履歴一覧 | — |

## 7. CI【仮説】

- GitHub Actions: `npm ci` → `lint` → `typecheck` → `jest`。ネイティブビルドは初期は手元のみ（macOS ランナーのコストを避ける）。必要になったら iOS/Android ビルドジョブを追加。
- EAS Build は当面使わない（ローカルビルドで足りる）。配布時に検討。

## 8. Claude Code / Codex での開発ルール【事実】

- 設計文書（PRODUCT / REQUIREMENTS / ARCHITECTURE / DATA_MODEL / AUDIO_DESIGN / DEVELOPMENT）を最初に読む。矛盾を見つけたらコードではなく文書を先に直す提案をする。
- Expo / RN / OS API は公式ドキュメントで現行仕様を確認してから使う。`expo-av` は使わない（非推奨・削除済み【確認済み】）。
- `domain/` に副作用を入れない。ネイティブモジュールを画面から直接呼ばない。
- 録音データに触るコード（writer、復旧、削除）は必ずテストと一緒に変更する。
- `git commit` / `git push` はユーザーの明示的な指示があるときのみ。
- 同じ内容を `CLAUDE.md` と `AGENTS.md` に置く（両 Agent が読む。片方をもう片方への参照にしてもよい）。Phase 0 で作成。

## 9. よく使うコマンド（予定）

```sh
npm run ios / npm run android   # dev build 起動
npm run lint / npm run typecheck / npm test
npx create-expo-module@latest --local   # 新しいローカルモジュール【確認済み】
npx expo prebuild --clean               # ネイティブ再生成
```
