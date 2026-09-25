# 依存ライブラリ・プラグイン・フォントの整理（Issue #112）

【事実】2026-09-25、`release/0.1.0` の `fdcaabe` を起点に調査。
リリースへの反映前に `f764afe`（#114 / #117 を含む）へ追従し、利用経路と全検査を再確認した。
対象は PodsNow リポジトリの npm 依存、Expo config plugin、ローカルネイティブモジュールの依存、同梱フォント。
開発者の PC 全体や Codex のプラグインは対象に含めない。

## 判断基準【事実】

- import が無いだけでは削除しない。設定、プラットフォーム別ファイル、peer dependency、ビルド・テスト・プレビュー経路も調べる。
- 未使用かつ現行の責務が別の仕組みで満たされているものは削除する。将来使うかもしれないという理由だけでは残さない。
- 使用中で改善の余地があるものは残し、活用案と検証条件を分ける。容量削減のために設計・表示品質を暗黙に変えない。

## 削除したもの【事実】

**Zustand `^5.0.15` のみ。** `package.json` と lockfile から削除。アプリの処理は変更しない。

- 初期化コミット `818aab0` で追加。`git log --all -G 'zustand' -- src package.json ARCHITECTURE.md` では導入以外の利用履歴が無い。
- `src/`、`modules/`、設定、スクリプトに参照が無い。削除前の `npm ls zustand --all` でもルートの直接依存だけだった。
- `ServicesProvider.tsx` の Context がサービスを配り、`useWorkspace.ts` は React state と `recording.on` / `playback.on` で状態を受け取っている。
- `ARCHITECTURE.md` の Zustand は初期の仮説のままだった。文書を現行方式に更新してから依存を削除した。
- 状態購読の細分化が必要になれば再評価できるが、そのためだけの全面移行は行わない。

【事実】直接の実行時依存は 33 → 32、開発依存は 10 のまま。lockfile の差分はルートの依存宣言と Zustand のエントリだけ。
未 import の JS ライブラリの削除なので、配布アプリの容量削減量は主張しない。

## 残した依存と利用経路【事実】

| 依存 | 利用経路・残す理由 |
|---|---|
| `expo` / `react` / `react-native` | アプリ・ローカル Expo Modules の基盤 |
| `expo-router` | `src/app/` のルーティング、`ScreenHeader`、`HeaderMenu`、エントリポイント、config plugin |
| `expo-constants` / `expo-linking` | アプリから直接 import しないが、インストール済み Router の必須 peer dependencies |
| `react-native-screens` | Router の依存かつ peer dependency。ネイティブスタックを支える |
| `react-native-safe-area-context` | 共通部品・Sheet の安全領域。Router の peer dependency でもある |
| `react-native-gesture-handler` / `react-native-reanimated` | `Waveform.tsx` の範囲ハンドル、`components.tsx` の押下・通知の動き、ルートの GestureHandlerRootView |
| `react-native-worklets` | 直接 import は無いが、Reanimated 4.5.1 の必須 peer dependency（0.10.x） |
| `react-dom` | `scripts/web-preview/build.sh` の画面検証、Router / Expo UI 配下の Web 依存。モバイル画面の import 検索だけでは判断できない |
| `expo-dev-client` | Development Build。JS import の有無では判定しない。設定展開でも dev-client / dev-launcher / dev-menu が適用される |
| `expo-system-ui` | `app.json` の `userInterfaceStyle: automatic`。設定展開で Android の `expo_system_ui_user_interface_style=automatic` を確認 |
| `expo-splash-screen` | `app.json` のテーマ別スプラッシュ設定。JS import がなくてもビルドで使用 |
| `expo-font` | config plugin による8書体の埋め込み、`src/ui/fonts.ts` の読み込み確認・退避 |
| `expo-localization` | `deviceLocale.ts` の端末言語、config plugin の対応言語設定 |
| `expo-status-bar` | `src/app/_layout.tsx` |
| `@expo/ui` | `MoreMenu.ios.tsx` / `ChoiceMenu.ios.tsx` の SwiftUI メニュー・Picker |
| `expo-symbols` | `Icon.ios.tsx` の SF Symbols と `symbols.ts` の型 |
| `@react-native-segmented-control/segmented-control` | `Segmented.ios.tsx` のタブ |
| `@react-native-community/datetimepicker` | `DateField.ios.tsx` の収録日入力 |
| `react-native-svg` | `IconSvg.tsx` の Android 等のアイコン・iOS の代替、`Wordmark.tsx` のロゴ。SF Symbols と役割が異なる |
| `expo-audio` | `monitor.ts` のジングル、`AssetsSection.tsx` の素材試聴。自作エンジンと責務が異なる |
| `expo-clipboard` | `useCopy.ts` の配信情報コピー |
| `expo-crypto` | `services/app/ids.ts` の UUID |
| `expo-document-picker` | 復元ファイルと素材の選択 |
| `expo-file-system` | `infra/files/` とピークの読み込み |
| `expo-haptics` | `hapticsAdapter.ts` → `HapticsService` → UI の操作に対する触覚フィードバック |
| `expo-sharing` | 音声とバックアップの共有 |
| `expo-sqlite` | DB の接続・Executor |
| `fflate` | `infra/files/zip.ts` のバックアップ圧縮・展開 |

【事実】開発依存もすべて残す。`typescript` / `@types/react` / `@types/node` は型検査、`jest` / `jest-expo` / `@types/jest` はテスト、
`eslint` / `eslint-config-expo` / `eslint-config-prettier` / `prettier` は規約検査・整形に使う。
型定義は `tsconfig.json` と型解決、CLI は npm scripts から使うため、import だけでは見えない。

【事実】`app.json` に明示された4つのプラグイン（Router / SplashScreen / Localization / Font）に削除候補は無い。
`expo config --type introspect` の履歴には未導入パッケージ向けの `UNVERSIONED` フォールバックも出る。
履歴名があるだけで、そのライブラリをインストール済みとは数えない。

【確認済み】Font plugin はビルド時に書体を埋め込み、SystemUI plugin は Android の `userInterfaceStyle` を設定する。
出典: [Expo SDK 57 Font](https://docs.expo.dev/versions/v57.0.0/sdk/font/)、[SystemUI](https://docs.expo.dev/versions/v57.0.0/sdk/system-ui/)。

## ネイティブ側の依存【事実】

- 両 `.podspec` の `ExpoModulesCore`、両 Gradle の `expo-module-gradle-plugin` は自作モジュールの基盤。
- Recorder の `androidx.core:core-ktx` は `RecorderService.kt` の `NotificationCompat` / `ContextCompat` で使う。
- AudioEngine の JUnit と `org.json` は JVM テストで使用。Android 本体の JSON 実装を JVM テストで置き換える役割がある。
- DSP と録音は自作実装であり、設計の候補として言及される Drizzle、Zod、LAME 等を実際の導入済み依存とは数えない。

## フォントの判断【事実】

| 対象 | TTF の実サイズ合計（非圧縮） | 判断 |
|---|---:|---|
| Manrope 400 / 500 / 600 / 700 | 389,980 bytes（約0.39 MB） | 英語 UI、日英共通の数字に使用。残す |
| Noto Sans JP 400 / 500 / 600 / 700 | 23,052,480 bytes（約23.05 MB） | 日本語 UI に使用。残すが軽量化の検討対象 |

【事実】`app.json`、`Text.tsx` / `fonts.ts`、`tokens/scale.ts`、`scripts/fonts/generate.py` と実ファイルを照合。
400 は本文、500 は補助情報、600 はラベル・見出し、700 はタイトルに使う。孤立したフォントファイルは無い。
IBM Plex Mono は #110 で削除済み。ロゴの Manrope 800 は輪郭データとして使い、800 の TTF は同梱していない。
OFL ファイルは配布に伴うライセンス文なので残す。上記は APK / IPA の圧縮後サイズではない。

【仮説】Noto Sans JP の軽量化には効果が見込めるが、OS 書体への変更は日英・OS 間の表示差を増やす。
また、固定 UI 文言だけでサブセット化すると、番組名・台本等の自由入力が代替書体になり得る。
現在の実ウェイトと文字範囲を保つ方針に従い、今回は生成元・TTF・登録設定を変更しない。
変更時は DESIGN_SYSTEM.md §4 を先に見直し、日英混植・自由入力・文字拡大・4ウェイトを両 OS で確認する。

## 有効活用の余地（削除理由にはしない）

| 対象 | 現状【事実】 | 次に判断すること【仮説】 |
|---|---|---|
| Gesture Handler / Reanimated | 波形ハンドルでは使用済み。並べ替えは Issue #119 / #121 で既存ライブラリのドラッグ（`src/ui/ReorderList.tsx`）に統一した（トークテーマ・この回の録音・素材）。見た目の上下ボタンは廃止し、読み上げ向けに行の `accessibilityActions`（上へ移動 / 下へ移動）を残した | iOS のスクロール・ページシートの下スワイプとの競合は未検証（`docs/device-checklist.md` UX-8〜UX-11） |
| Reanimated | `LevelMeter.tsx` は React の View を描画し、`useWorkspace.ts` はレベルイベントごとに state を更新している | 実機で録音中の描画負荷を測り、必要ならレベル購読の分離や shared value 化を検討。遅いと確認したわけではない |
| DateTimePicker | iOS では使用、Android は `YYYY-MM-DD` の文字入力（現行デザインどおり） | Android の標準ピッカー活用は入力の改善候補。OS 別の仕様を先に決める |
| Noto Sans JP | 全4ウェイトが使用中だが同梱容量の大半を占める | 未使用削除ではなく、文字範囲・字形・実ウェイトを含む軽量化設計として扱う |

## 検証【事実】

- `npm run lint`：成功。
- `npm run typecheck`：成功。
- `npm test -- --runInBand`：29 suites / 301 tests 成功。
- `npm run format:check`：成功（既存設定により Markdown は対象外）。
- `EXPO_OFFLINE=1 npx expo config --type introspect --json`：設定展開に成功し、SystemUI の適用を確認。
- lockfile はルートの依存宣言と `node_modules/zustand` 以外に差分が無いことを比較確認。

実機での起動・録音・ネイティブビルドは今回の監査では未検証。静的検査と Jest の成功を実機動作の保証とはしない。
