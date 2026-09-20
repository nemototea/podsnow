# DEVELOPMENT.md — PodsNow 開発ガイド

> 凡例: **【事実】** 対話で決定した仕様 / **【確認済み】** 公式ドキュメント等で確認済み（出典付き） / **【仮説】** 未検証・要スパイク

## 1. 開発環境【事実】

- macOS、Xcode（SDK 57 は Xcode 27 / iOS 27 SDK を想定【確認済み】https://expo.dev/changelog/sdk-57）、Android Studio（Android 14 / 15 の実機またはエミュレータ）
- VS Code をメイン IDE
- Node.js LTS、npm（パッケージマネージャは npm を既定【仮説: 変更可】）、Watchman、CocoaPods、JDK 17【仮説: SDK 57 の要求バージョンは docs で確認】
- 開発 Agent: Claude Code、Codex（§8）

## 2. リポジトリとブランチ戦略【事実】

- リモート: https://github.com/nemototea/podsnow
- Issue / PR / ラベル / マイルストーンは GitHub で管理し、`gh` CLI から操作する。

### 2.1 ブランチの 3 層

```
main ◀── PR ── release/<version> ◀── PR ── issue/<番号>-<slug>
```

| ブランチ | 役割 | 直接コミット |
|---|---|---|
| `main` | **ストアリリース可能な状態のみ**。`release/<version>` からの PR マージでしか進まない。マージ = そのバージョンの公開準備完了 | 禁止（初回コミットのみ例外） |
| `release/<version>` | そのバージョン（例: `release/0.1.0` = MVP）の統合ブランチ。Issue ブランチの PR 宛先。バージョンに必要な Issue がすべて閉じたら `main` へ PR | 禁止（Issue ブランチ経由） |
| `issue/<番号>-<slug>` | 1 Issue = 1 ブランチ。`release/<version>` から切り、PR は同じ `release/<version>` 宛て | ここで作業 |

- バージョンは SemVer。MVP = `0.1.0`。次バージョンの作業は `release/0.2.0` を `main` から切って始める。
- 公開後の緊急修正は `hotfix/<slug>` を `main` から切り、`main` と進行中の `release/*` の両方へ PR。
- マージ方式は **マージコミット**（GitHub の "Create a merge commit"）。squash はしない。Issue ブランチのコミットをそのまま残し、1 Issue の作業過程を `release/*` の履歴から追えるようにする。
- Issue ブランチはマージ後に削除。

### 2.2 Issue 運用

- 作業は必ず Issue から始める（MVP 外の構想も Issue にして Backlog に置く）。
- マイルストーン: `0.1.0 (MVP)` / `Backlog`。バージョンが増えたらマイルストーンも増やす。
- ラベル:
  - `phase:0-foundation` … `phase:4-show`: DEVELOPMENT.md §6 のフェーズ
  - `mvp` / `post-mvp`: スコープ
  - `native` / `ios` / `android`: ネイティブ実装を含む
  - `spike`: 技術検証。結果は `docs/adr/` に ADR として残す
  - `data-safety`: 録音データの保全に関わる（最優先。テスト必須）
  - `docs` / `infra` / `ui` / `release`
- PR 本文に `Closes #<番号>` を書き、マージで Issue を自動クローズする。

### 2.3 コミット・PR

- コミットメッセージ: Conventional Commits（`feat:`, `fix:`, `docs:`, `chore:`, `native:`, `spike:`）。日本語可。
- PR タイトルは Issue タイトルに合わせる。PR は CI（§7）が緑であることを条件にマージ。
- `.gitignore`: `node_modules/`, ルートの `/ios/` と `/android/`（prebuild 生成物。`modules/*/ios|android` は追跡する）, `.expo/`, `*.log`, `.DS_Store`, 大容量音源（`fixtures/` の小さなものは除く）

### 2.4 典型的な作業手順

```sh
git switch release/0.1.0 && git pull
git switch -c issue/12-dsp-language-adr
# ... 作業・コミット ...
git push -u origin issue/12-dsp-language-adr
gh pr create --base release/0.1.0 --fill --body "Closes #12"
```

## 3. セットアップ手順（予定）

```sh
git clone git@github.com:nemototea/podsnow.git && cd podsnow
npm install
npx expo prebuild            # ios/ android/ を生成（ローカルモジュールに必要）【確認済み】
npx expo run:ios             # Development Build を実機/シミュレータへ
npx expo run:android
```

- Expo Go は使わない（ローカルネイティブモジュールを含むため）。【事実】

### 3.1 Mac から離れて実機で試す（release variant）【確認済み】

Development Build は JS を Metro から受け取るため、Mac が起動していないとアプリが開かない。
外出先で空き時間に触りたいときは **release variant** を入れる。JS バンドルと assets がバイナリに
埋め込まれ、Metro も Mac も不要になる（出典: https://docs.expo.dev/more/expo-cli/ の
`--variant` / "Production builds will export the project and embed the files in the native binary"。
このページは v57 のバージョン付き URL が無い）。

```sh
export ANDROID_HOME=$HOME/Library/Android/sdk        # 未設定なら
npx expo prebuild --clean --platform android --no-install   # 依存追加・アイコン変更のあとだけ
npx expo run:android --variant release --device Pixel_9a --no-bundler
```

- `--device` は `adb devices -l` の `model:` の値（例 `Pixel_9a`）。シリアル番号では見つからない。
- 署名は prebuild が生成する `android/app/build.gradle` の既定どおり **debug keystore**（release も同じ鍵）。
  Development Build と鍵が同じなので、上書きインストールできる。ストア配布用の鍵は EAS 導入時に別途決める。
- R8 / minify は既定で無効（`android.enableMinifyInReleaseBuilds` 未設定）。有効にするなら
  `expo-build-properties` で `app.json` から設定し、`android/` を手で編集しない（`prebuild --clean` で消える）。
- 成果物: `android/app/build/outputs/apk/release/app-release.apk`。別の端末には
  `adb -s <serial> install -r` で入れられる。
- iOS は Xcode 26 が必要（SDK 57）。用意できたら `npx expo run:ios --configuration Release --device` で同じことができる【仮説: 未検証】。
- release では `expo-dev-client` のランチャー画面が出ない。起動直後にアプリの Home が出ること、
  機内モードで開けることを最初に確認する。
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

### 4.4 文言・ローカライゼーション（Issue #80、FR-I18N-4）

- ユーザーに見える文言は `src/i18n/ja.ts`（キーの正）と `src/i18n/en.ts` の両方に書く。画面や `features/` に直接書かない。`accessibilityLabel` も対象。
- `en.ts` は `Messages = typeof ja` に縛られているので、キーや関数の引数を変えると **英語側を直すまで `npm run typecheck` が落ちる**。これが翻訳漏れの防波堤。
- 画面からは `const t = useT();` で引く。`useCallback` / `useEffect` の依存配列には `t` を入れる（言語切替で再生成させる）。
- 文言に値を差し込むときは関数にする（`takes: (n: number) => ...`）。テンプレート文字列を画面側で組み立てない（語順が言語で変わる）。
- `domain/` / `services/` / `infra/` は文言を持たない（**ESLint で `@/i18n` の import を禁止**している）:
  - エラーは `src/domain/errors.ts` の `AppError` / `AppErrorCode` で投げ、表示は UI 層の `errorText()`。DB の `error` 列にもコードを入れる。
  - DB に書き込む既定文言は `ServiceLabels`（`src/services/app/labels.ts`）として UI 層から注入する。
- 新しい言語を足すときは `src/i18n/types.ts` の `LOCALES` にコードを追加し、カタログを 1 つ書き、`app.json` の `expo.locales` と expo-localization プラグインの `supportedLocales` にも足す（ネイティブ側は `npx expo prebuild --clean` が必要）。`locales/*.json` の iOS 専用キー（`CFBundleDisplayName` など）は `ios` の下に入れる。トップレベルに置くと Android の `values-b+xx/strings.xml` にも書き出され、release ビルドの `lintVitalRelease`（ExtraTranslation）が失敗する【確認済み: 2026-09-21 Pixel 9a】。

### 4.5 ブランド・アイコン（Issue #82）

- アプリアイコン・スプラッシュ・favicon とマークの SVG は **`python3 scripts/brand/generate.py` で生成**する。PNG / SVG を直接編集しない（図形の定義は `scripts/brand/geometry.py` の 1 箇所）。
- マークの意味と、差し替え時に避けるべきモチーフは `assets/brand/README.md` に書いてある。雪・氷（名前の誤読）と電波 / Wi-Fi 的な弧（ネットワークを使わないアプリなので矛盾する）は使わない。
- 色はマークのために新しく作らず、`src/ui/theme.ts` のトークンを使う。
- Android のアダプティブアイコンは前景の中央 66%（半径 338px / 1024px 中）しか見える保証がない。`generate.py` が検査して、はみ出していれば失敗する。
- アイコンを変えたら `npx expo prebuild --clean` → 再ビルドが必要。

### 4.6 ドキュメント
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
