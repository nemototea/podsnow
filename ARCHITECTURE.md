# ARCHITECTURE.md — PodsNow 技術アーキテクチャ

> 凡例: **【事実】** 対話で決定した仕様 / **【確認済み】** 公式ドキュメント等で確認済み（出典付き） / **【仮説】** 未検証・要スパイク

## 1. 技術スタック

| 領域 | 採用 | 状態 | 備考 / 出典 |
|---|---|---|---|
| フレームワーク | Expo SDK 57 / React Native 0.86 / TypeScript | 【確認済み】 | https://expo.dev/changelog/sdk-57 |
| ビルド | Expo Development Build（`npx expo run:ios` / `run:android`、`expo prebuild`） | 【事実】 | Expo Go は使わない（ローカルネイティブモジュールがあるため） |
| ナビゲーション | expo-router | 【仮説】 | ファイルベース。画面数が少なく Stack + Sheet 中心 |
| 状態管理 | React の state / Context + サービスのイベント購読、SQLite（永続の唯一の真実） | 【事実】 | Issue #112: 初期案の Zustand は実装で使われていないため依存から外す。状態共有の具体的な課題が生じた時点で再評価する |
| DB | expo-sqlite（WAL、`PRAGMA user_version` で移行） | 【確認済み】 | https://docs.expo.dev/versions/latest/sdk/sqlite/ |
| ORM / クエリビルダ | Drizzle ORM + drizzle-kit（expo-sqlite 公式統合あり） | 【仮説】 | 統合の存在は【確認済み】（同上）。採用可否は Phase 0 で判断 |
| ファイル | expo-file-system（`File` / `Directory` / `Paths` / `FileHandle`） | 【確認済み】 | https://docs.expo.dev/versions/latest/sdk/filesystem/ |
| 再生 | expo-audio（`AudioPlayer`、`setAudioModeAsync`） | 【確認済み】 | https://docs.expo.dev/versions/latest/sdk/audio/ 。**録音には使わない**（§4） |
| 録音 | 自作ローカル Expo Module `podsnow-recorder`（Swift / Kotlin） | 【事実】 | §4、AUDIO_DESIGN.md |
| 音声処理 | 自作ローカル Expo Module `podsnow-audio-engine`（波形・無音検出・ミックス・ラウドネス・エンコード） | 【事実】 | AUDIO_DESIGN.md |
| 共有 / 保存 | expo-sharing、expo-document-picker、（Android）Storage Access Framework 相当 | 【仮説】 | 各 API の現行仕様は実装時に docs で確認 |
| ハプティクス | expo-haptics | 【仮説】 | |
| テスト | Jest（ドメインロジック）、XCTest / JUnit（ネイティブ）、実機チェックリスト（割り込み系） | 【仮説】 | DEVELOPMENT.md |
| 非採用 | expo-av | 【確認済み】 | 非推奨・SDK 55 で削除 (https://docs.expo.dev/versions/latest/sdk/av/) |

## 2. レイヤー構成

```
┌─────────────────────────────────────────────────────────┐
│ src/app/ (expo-router screens)  ─ UI / 画面遷移           │
├─────────────────────────────────────────────────────────┤
│ src/features/*  ─ 画面単位のフック・React state             │
│   recording / editor / episode / export / assets / ...   │
├─────────────────────────────────────────────────────────┤
│ src/i18n/  ─ 文言カタログ（ja / en）とロケール解決           │
│   ja.ts（キーの正）/ en.ts / LocaleProvider / useT()      │
├─────────────────────────────────────────────────────────┤
│ src/domain/  ─ 純粋 TypeScript。副作用なし                 │
│   timeline (EDL 計算・時間変換) / edit-ops (操作と逆操作)   │
│   undo / metadata-template / silence-plan / outline      │
├─────────────────────────────────────────────────────────┤
│ src/services/  ─ ユースケース。domain と infra をつなぐ      │
│   RecordingSession / EpisodeService / ExportService      │
│   RecoveryService / BackupService / AiProvider(IF)       │
├─────────────────────────────────────────────────────────┤
│ src/infra/  ─ 副作用の実装                                 │
│   db (expo-sqlite + migrations) / files (expo-file-system)│
│   native: modules/podsnow-recorder, podsnow-audio-engine  │
│   playback (expo-audio)                                  │
└─────────────────────────────────────────────────────────┘
```

原則:
- `domain/` はネイティブにも DB にも依存しない。Jest で網羅的にテストする（タイムライン計算、範囲削除、無音カット計画、Undo の逆操作）。
- `services/` は「1 ユースケース = 1 クラス/関数」。録音セッション、復旧、書き出しはここに状態機械を置く。
- 画面は `features/` のフックだけを呼ぶ。画面からネイティブモジュールを直接呼ばない。
- **ユーザーに見える文言は `src/i18n/` だけに置く**（Issue #80、FR-I18N-4）。`domain/` / `services/` / `infra/` は文言を持たない:
  - エラーは `AppError` + `AppErrorCode`（`src/domain/errors.ts`）で返し、文言は UI 層が `errorText()` で引く。
  - domain が組み立てる表示テキスト（`formatAllMetadata()` の見出しなど）は見出しを引数で受け取る。
  - DB に書き込む既定文言（Show 名・概要欄テンプレート・エピソードタイトル・Take 名・割り込みマーカー）は `ServiceLabels`（`src/services/app/labels.ts`）として UI 層が `bootstrap()` に注入する。書き込み済みの行はユーザーのデータなので、言語を切り替えても書き換えない。
- `src/i18n/` は UI 層（`app/` / `features/` / `ui/`）から使う。`domain/` / `services/` / `infra/` からの import は **ESLint（`no-restricted-imports`）で禁止**している（テストは対象外）。
- ロケールの値型と解決ロジック（`Locale` / `LanguagePreference` / `resolveLocale()`）は文言ではないので `src/domain/locale.ts` に置く。設定として DB にも入るため、infra が i18n を参照せずに済む。

## 3. ディレクトリ構成（予定）

```
podsnow/
├── src/
│   ├── app/                    # expo-router（SDK 57 の既定は src/app）
│   │   ├── _layout.tsx
│   │   ├── index.tsx                 # ホーム
│   │   ├── episode/[id]/index.tsx    # エピソード（録音 / 編集 / 書き出しの 3 タブ）
│   │   ├── episode/[id]/share.tsx    # 書き出し後の共有（内部名 Distribution Pack）
│   │   ├── episode/[id]/backup.tsx
│   │   ├── show/index.tsx            # 番組（情報・素材・ひな形を 1 画面に）
│   │   ├── restore.tsx
│   │   └── settings.tsx
│   ├── domain/
│   ├── services/
│   ├── features/           # episode/{record,edit,export} など、タブ単位のフック
│   ├── infra/
│   ├── i18n/                   # 文言カタログ（ja.ts がキーの正）・ロケール解決
│   └── ui/                     # 共通コンポーネント・テーマ
├── modules/
│   ├── podsnow-recorder/       # Expo Module (Swift / Kotlin)
│   └── podsnow-audio-engine/   # Expo Module (Swift / Kotlin [+ C++ 共通コア: 仮説])
├── assets/
│   ├── brand/                  # ブランドマークの SVG（scripts/brand/generate.py が生成）
│   └── images/                 # アプリアイコン・スプラッシュ・favicon（同上）
├── scripts/brand/              # アイコン生成（図形定義 + 最小 PNG ラスタライザ、標準ライブラリのみ）
├── locales/                    # OS の権限ダイアログ等の文言（app.json の expo.locales）
├── docs/                       # 追加の設計メモ・ADR
├── PRODUCT.md / REQUIREMENTS.md / ARCHITECTURE.md / DATA_MODEL.md / AUDIO_DESIGN.md / DEVELOPMENT.md
└── pre-dev-sample/             # デザインハンドオフ（参考）
```

## 4. JS で足りる範囲 / ネイティブが必要な範囲 【確認済み】

expo-audio（SDK 57）の公式ドキュメントと型定義（`packages/expo-audio/src/Audio.types.ts`）を確認した結果に基づく。

| 機能 | expo-audio で可能か | 判断 |
|---|---|---|
| 再生（単一ファイル、シーク、レート） | ○ `AudioPlayer` | JS（expo-audio） |
| 再生波形サンプル | ○ `useAudioSampleListener`（再生側のみ） | 使わない（波形はファイル解析で作る） |
| Audio Session の基本設定 | ○ `setAudioModeAsync`（`allowsRecording`, `playsInSilentMode`, `interruptionMode`, `shouldPlayInBackground`, `shouldRouteThroughEarpiece`） | 再生用途は JS。録音中のセッションはネイティブモジュールが管理 |
| 録音（iOS） | ○ `IOSOutputFormat.LINEARPCM` あり | ネイティブに統一 |
| 録音（Android、非圧縮） | **× `AndroidAudioEncoder` は `aac / he_aac / aac_eld / amr_nb / amr_wb` のみ** | **ネイティブ必須** |
| 録音中の生 PCM 取得（レベル計、無音検出） | × 該当 API なし（`metering` は状態値のみ） | ネイティブ |
| 割り込み（着信等）イベント | × 専用リスナーなし（iOS `mediaServicesDidReset` のみ） | ネイティブ必須 |
| 入力デバイス列挙・選択 | ○ `getAvailableInputs()` / `setInput()` | 録音モジュールに同等機能を持たせる（セッション管理を一元化） |
| バックグラウンド録音の権限付与 | ○ config plugin `enableBackgroundRecording`（iOS `UIBackgroundModes: audio`、Android `FOREGROUND_SERVICE_MICROPHONE`） | 権限は自作モジュールの config plugin で付与。FGS 自体は自作 |
| 複数トラックのリアルタイムミックス再生 | × | ネイティブ（AUDIO_DESIGN.md §7） |
| ミックスダウン / ラウドネス / ダッキング / エンコード | × | ネイティブ |
| 無音検出・波形ピーク生成 | × | ネイティブ（ファイル解析） |

**結論【事実】**: 録音と音声処理はすべて自作ネイティブモジュール。expo-audio は素材の試聴など単純再生に限定して使う。

## 5. ネイティブモジュール

Expo Modules API のローカルモジュール（`npx create-expo-module@latest --local` → `modules/<name>/`）。【確認済み】https://docs.expo.dev/modules/get-started/

### 5.1 `podsnow-recorder`

責務: PCM 録音、WAV 書き込み、Audio Session / Audio Focus 管理、割り込み・ルート変更の通知、レベル計、Android フォアグラウンドサービス。

```ts
// JS 側インターフェース（案）
interface RecorderModule {
  prepare(opts: { path: string; sampleRate: 48000; channels: 1 | 2; bitDepth: 16; inputUid?: string }): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<{ path: string; durationMs: number; bytes: number }>;
  getInputs(): Promise<AudioInput[]>;
  setInput(uid: string): Promise<void>;
  addListener(event: 'level' | 'interruption' | 'routeChange' | 'segmentRotated' | 'error' | 'diskLow', cb): Subscription;
}
```

イベント:
- `level`: `{ peakDb, rmsDb }` を 10〜20 Hz で通知
- `interruption`: `{ type: 'began' | 'ended', shouldResume: boolean, reason?: string }`
- `routeChange`: `{ reason, currentInput }`
- `segmentRotated`: 割り込み等でファイルを確定し新ファイルに切り替えたとき `{ closedPath, newPath }`
- `diskLow`: 残容量しきい値到達
- `error`: 回復不能エラー（Segment は確定済みであることを保証）

### 5.2 `podsnow-audio-engine`

責務: 波形ピーク生成、無音区間検出、タイムライン（EDL）のリアルタイム再生、オフラインレンダリング（ミックス → ラウドネス正規化 → エンコード）、素材の取り込み変換。

```ts
interface AudioEngineModule {
  generatePeaks(src: string, dst: string, samplesPerSecond: number): Promise<void>;
  detectSilence(src: string, opts: { minDurationMs: number; thresholdDb: number }): Promise<Range[]>;
  importAsset(src: string, dst: string): Promise<AssetInfo>;           // 任意形式 → WAV 48k
  // 再生
  loadTimeline(doc: RenderDocument): Promise<void>;
  play(atMs: number): Promise<void>; pause(): Promise<void>; seek(ms): Promise<void>;
  // 書き出し
  render(doc: RenderDocument, out: { path: string; format: 'm4a' | 'wav'; bitrate?: number; loudness?: LoudnessOptions }): { jobId: string };
  cancel(jobId: string): void;
  addListener(event: 'progress' | 'position' | 'done' | 'error', cb): Subscription;
}
```

`RenderDocument` は JS 側の `domain/timeline` が DB から組み立てる **自己完結した JSON**（ファイルパス、区間、ゲイン、フェード、ダッキング設定）。ネイティブは DB を読まない。

### 5.3 実装言語の方針

- 録音（`podsnow-recorder`）: Swift（AVAudioEngine / AVAudioSession）、Kotlin（AudioRecord / AudioManager / ForegroundService）。プラットフォーム固有 API が主体なので共通化しない。【事実】
- 音声処理（`podsnow-audio-engine`）: 【仮説】ミックス・ラウドネス計測・ダッキングは **C++ の共通コア**（Swift からは ObjC++ ブリッジ、Kotlin からは JNI で呼ぶ）にすると両 OS で同一結果を保証しやすく、ゴールデンファイルでテストできる。Expo Modules API 公式は「C++ を使うなら Turbo Modules」と案内している（【確認済み】https://docs.expo.dev/modules/overview/）が、ここでは C++ を JS に直接露出せず Swift/Kotlin の内側で呼ぶ想定。Phase 0 で (a) Swift/Kotlin 二重実装 と (b) C++ コア の工数・ビルド安定性を比較して決める。
- エンコード: OS 標準（iOS `AVAssetWriter` / AudioToolbox、Android `MediaCodec` + `MediaMuxer`）。【仮説】具体 API は実装時に確認。

## 6. バックグラウンド動作と OS 要件

| OS | 仕組み | 状態 |
|---|---|---|
| iOS | `UIBackgroundModes: audio` + 録音中は AVAudioSession をアクティブに保つ | 【確認済み】expo-audio の plugin が同じ設定を付与することから、必要設定はこれで足りると判断。自作 plugin で `Info.plist` に付与 |
| Android | `foregroundServiceType="microphone"` の Foreground Service + 通知。権限 `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `RECORD_AUDIO`, `POST_NOTIFICATIONS`(13+) | 【確認済み】https://developer.android.com/develop/background-work/services/fgs/service-types |
| Android 制約 | **マイク FGS はアプリがフォアグラウンドにある間にしか開始できない**。バックグラウンド／BOOT_COMPLETED からは不可 | 【確認済み】同上 → 録音開始は必ず画面操作から。割り込み後の「自動再開」がバックグラウンドで発生するケースは要検証【仮説】 |
| Google Play | FGS 種別の申告が必要（配布時） | 【確認済み】同上 |

## 7. 横断的な設計

### 7.1 データ保全（詳細は AUDIO_DESIGN.md §5、DATA_MODEL.md §6）
- 録音は Segment 単位の WAV。ヘッダ定期更新 + fsync。
- 録音開始で `takes.status = 'recording'` を書き、停止で `'ready'`。起動時に `'recording'` のまま残っている Take を復旧。
- 編集は操作ログ（`edit_ops`、操作前後のスナップショット）として永続化。Undo/Redo は操作ログのポインタ移動。履歴はエピソード画面を開いている間だけ持つ。録音の確定も Take の確定と同じトランザクションで履歴に積む（DATA_MODEL.md §4.12）。

### 7.2 時間と ID
- 時間はすべて **ミリ秒整数**（`ms`）ではなく **サンプル数（48 kHz 基準）** を内部表現にする【仮説】。理由: 切り貼りの累積誤差をゼロにし、両 OS の書き出し結果を一致させるため。UI 表示時のみ ms に変換。
- ID は UUID v4（text）。将来の端末間同期で衝突しない。

### 7.3 ローカルファーストで成立する機能 / サーバーが必要な機能 【事実】

| 機能 | ローカルで成立 | サーバー必須 | 現在の扱い |
|---|---|---|---|
| 収録・編集・仕上げ・書き出し・共有・Show Assets・テンプレート・設定 | ○ | — | MVP。ネットワーク不要 |
| 配信中の番組の取り込み（検索 / RSS 取得） | ○（アプリから Apple の公開検索と RSS 配信元へ直接 HTTPS。API キー不要） | — | SHOULD（Issue #101）。秘密情報が要る外部 API は使わない |
| エピソードのバックアップ / 復元（`.podsnow` ファイル） | ○（ユーザーの iCloud Drive / Google Drive 等へ共有シートで保存） | — | MVP。自前サーバーは持たない |
| OS 標準の音声入力・音声認識 | ○（端末依存でオンライン処理される場合あり） | — | 音声入力は MVP、文字起こしは後続 |
| ローカル LLM による要約・概要欄下書き | ○（端末内推論。無料・ローカルが前提） | — | 後続。`AiProvider` インターフェースのみ |
| 複数端末間の同期 | △（ファイル共有による手動同期は可） | ○（自動同期・衝突解決） | 将来。UUID / updated_at / 論理削除で道を残す |
| 自前サーバーからの配信（セルフホスト） | — | ○（音声と RSS の配信） | MVP は開発者自身の番組 1 つ（REQUIREMENTS.md §2.13）。サーバーは別 Issue。アプリは `SelfHostedPublisher` |
| 他社配信サービスへの直接アップロード | — | ○（各サービスの API。有料化リスク） | 持たない。Distribution Pack で人がコピペ |
| ユーザー登録・課金・解析 | — | ○ | MVP は持たない。一般向けの配信サービスにするときに判断（REQUIREMENTS.md FR-PUB-8） |

### 7.4 将来拡張の接続点 【事実】
| 拡張 | 接続点 |
|---|---|
| AI（文字起こし / 要約 / 概要欄下書き） | `services/ai/AiProvider` インターフェース（`transcribe(take)`, `suggestDescription(episode)`）。MVP 実装は `NoopAiProvider`。`transcripts` テーブルと `episodes.description_suggestion` を用意 |
| 複数端末同期 | UUID、`updated_at`、論理削除（`deleted_at`）を全主要テーブルに持たせる。バックアップ形式（`.podsnow`）が同期の単位になり得る |
| 配信 | `services/publish/Publisher` インターフェース。`ManualPublisher`（Distribution Pack）と `SelfHostedPublisher`（自前サーバー。MVP）。一般向けサービスにしても同じインターフェースの後ろで差し替える |
| MP3 / FLAC | `podsnow-audio-engine` の `format` 列挙を拡張。エンコーダは Strategy で追加 |
| 複数 Show | `shows` テーブルと `show_id` 外部キーは最初から存在。UI の Show 切替だけ後付け |

### 7.5 エラー処理の方針
- ネイティブ側の失敗は必ず「Segment を確定してから」JS に通知する（録音データが宙に浮かない）。
- JS 側で握りつぶさない。ユーザーに見える通知（トースト）+ `logs` テーブルへの記録（MVP は端末内のみ）。

### 7.6 テーマ / UI
- Dark / Light / System。トークンは `src/ui/tokens/` に集約（決めごとと理由は DESIGN_SYSTEM.md）。
- 色は `scripts/design/ramps.py` から生成する【事実】。面の明度は決め打ち、文字と境界は目標コントラスト比から逆算する。`python3 scripts/design/generate.py` が書き出し前に全組み合わせを測り、落ちたら何も書かない。
- 画面と `src/ui/` に生の値（hex、`fontSize`、余白、角丸）を書かない。ESLint で落ちる。
- ブランドマークの色は `scripts/brand/geometry.py` がトークンの生成元を直接読む。マークのために別の色を作らない。

## 8. 主要な状態機械

### 8.1 RecordingSession（services）

```
idle ──start──▶ preparing ──ok──▶ recording ◀──resume── paused
                                  │  ▲             ▲
                                  │  └─interruption.ended(shouldResume)──┐
                                  ├─pause────────▶ paused                 │
                                  ├─interruption.began──▶ interrupted ────┘
                                  ├─diskLow/error──▶ stopping
                                  └─stop──▶ stopping ──finalized──▶ idle
```
- `interrupted` では Segment を確定し、`takes.status` は `'recording'` のまま（復旧対象）。
- `stopping` で Take を `'ready'` にし、ピーク生成をキューに入れる。

### 8.2 ExportJob
`queued → rendering(progress) → encoding(progress) → done | failed | cancelled`。ジョブは `exports` テーブルに記録し、アプリ再起動で `rendering` のまま残っていれば `failed` に倒す。

## 9. セキュリティ / プライバシー
- 通信は番組の取り込み（REQUIREMENTS.md FR-SHOW-6〜10）と自前サーバーへの配信（§2.13）だけ。ユーザーが操作したときに限り、Apple の公開検索と RSS 配信元への GET、登録した配信サーバーへの HTTPS 通信を行う（NFR-2 / NFR-5）。それ以外の機能はネットワークを使わない。
- 配信サーバーのトークンは OS の安全な保管領域に置き、SQLite とバックアップには入れない（NFR-11）。
- 正本の分担: 制作（録音・編集）の正本は端末の SQLite。配信済みの回と RSS の正本はサーバー。端末の `feed_episodes` はその写し（DATA_MODEL.md §4.17）。
- 権限はマイク、（Android）通知、（Android）FGS、ファイル選択。Android の `INTERNET` は Expo の生成するマニフェストに最初から入っている【事実】（`@expo/config-plugins` の `withAndroidBaseMods.js` のテンプレート。元は https://github.com/expo/expo/blob/main/templates/expo-template-bare-minimum/android/app/src/main/AndroidManifest.xml ）。iOS は ATS により HTTPS 以外を拒否する既定のままにする。
- 取り込みの層分け: 通信は `infra/`（`fetch`）、検索元と RSS 取得の組み立ては `services/podcast/`、XML から取り出した値の正規化（`itunes:explicit` / `itunes:duration` など）は `domain/podcast/`（純粋関数。Jest で網羅）。検索元はインターフェースの後ろに置き、Apple 以外を足せる形にする。RSS は信用しない入力として扱う（NFR-10）。
- 録音ファイルはアプリの `Paths.document` 配下。iCloud バックアップ除外は【仮説】（expo-file-system に API 記載なし。必要ならネイティブで `isExcludedFromBackup` を設定）。

## 10. 未決事項
| # | 項目 | 決め方 |
|---|---|---|
| A-1 | Drizzle ORM 採用可否 | Phase 0 でスキーマ 3 表を書いて評価 |
| A-2 | DSP を C++ 共通コアにするか | Phase 0 スパイク（ビルド安定性・工数） |
| A-3 | リアルタイムミックス再生の実装（AVAudioEngine の複数 PlayerNode vs 自前ミキサー → 1 出力） | AUDIO_DESIGN.md §7 |
| A-4 | 内部時間表現（サンプル数 vs ms） | サンプル数を第一候補。Phase 1 で確定 |

## 12. 画面構成の再設計（0.1.0）【事実】

`docs/ux-restructure.md` で決めた IA に従う。要点だけ再掲する。

- **1 エピソード = 1 画面**。`episode/[id]/index.tsx` が **録音 / 編集 / 書き出し** の 3 タブを持つ。
  旧 `editor.tsx` / `details.tsx` / `sound.tsx` / `export.tsx` と旧エピソードトップは、この画面のタブとセクションへ移す。
- `features/` はタブ単位に分ける（`features/episode/record` / `edit` / `export`）。
  `useEditor` のような「画面ぜんぶを 1 つのフックが持つ」構造をやめ、録音・編集・書き出しで状態を分ける。
- 画面から `src/services/` 以外を呼ばない原則は変えない（§2）。
- UI に出す言葉は一般語だけにする（REQUIREMENTS.md NFR-9）。内部名（Take / 声トラック / オーバーレイ / Outline）は
  `src/i18n/` に入れない。ESLint で機械的に縛るのは難しいので、レビューの観点として `DEVELOPMENT.md` に置く。
