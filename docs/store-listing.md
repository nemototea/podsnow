# ストア掲載素材（0.1.0 MVP、Issue #53 / #80 / #82）

アプリは日本語・英語に対応している（FR-I18N-1）。ストアの掲載情報も両言語で登録する。

## アプリ名（両言語共通）

PodsNow

読み: ポッズナウ。「PodSnow」「ポッドスノウ」ではない。
識別子（`slug` / bundle id / package / `.podsnow`）は小文字の `podsnow` のまま。

---

# 日本語（ja）

## サブタイトル（30 文字）

スマホだけでポッドキャストを収録・編集・書き出し

## 説明文

PodsNow は、スマートフォンだけでポッドキャストの「収録 → 編集 → 書き出し → 配信準備」を完結させる収録アプリです。

- **収録**: 画面ロック中も、他のアプリを使っていても録音は止まりません。電話が来ても、それまでの録音は残ります。
- **マーカー**: 話しながら「噛んだ」ボタンを押すだけ。あとでその場所へジャンプして、サッと削除。
- **定型作業はテンプレートに**: Opening / Ending / BGM を番組に登録しておけば、新しい回を作るだけで配置済み。ジングルは収録中にワンタップで挿入。
- **編集**: 範囲を選んで削除、無音の一括カット、部分録り直し。すべて非破壊で、取り消しはいつでも。
- **音の仕上げ**: ラウドネスをポッドキャスト標準（-16 LUFS）に自動調整。しゃべっている間は BGM が自動で下がります。
- **書き出しと配信準備**: M4A / WAV で書き出し、タイトル・概要をコピーして配信サービスへ貼るだけ。
- **ローカルファースト**: アカウント登録なし。録音も編集データもすべて端末の中。ネットワーク不要。
- **日本語・英語対応**: 端末の言語設定に従います。設定から手動で切り替えることもできます。

## キーワード

ポッドキャスト, 録音, ボイスレコーダー, 編集, 収録, podcast, recorder

## プライバシー

- 収集するデータ: なし（アプリはネットワーク通信を行いません）
- 使用する権限: マイク（収録）、通知（Android: 収録中の通知）

---

# English (en)

## Subtitle (30 characters)

Record, edit and export podcasts

## Description

PodsNow takes a podcast episode from recording to editing, exporting and publishing prep — entirely on your phone.

- **Recording**: keeps going with the screen locked or while you use other apps. If a call comes in, everything recorded so far is kept.
- **Markers**: tap "Flub" while you keep talking. Jump back to the spot later and cut it in a couple of taps.
- **Templates for the repetitive parts**: register your Opening / Ending / BGM once and every new episode comes with them already placed. Drop in a jingle with one tap while recording.
- **Editing**: select a range and delete it, cut all the silence at once, re-record just one section. Everything is non-destructive and always undoable.
- **Sound polish**: loudness is normalized to the podcast standard (-16 LUFS), and the BGM ducks automatically while you talk.
- **Export and publishing prep**: export to M4A or WAV, then copy the title and description straight into your hosting service.
- **Local-first**: no account. Your recordings and edits stay on the device. No network needed.
- **Japanese and English**: follows your device language, and you can switch it by hand in Settings.

## Keywords

podcast, recorder, voice recorder, audio editor, recording, podcasting

## Privacy

- Data collected: none (the app makes no network requests)
- Permissions used: microphone (recording), notifications (Android: the recording notification)

---

# 両言語共通

## カテゴリ

ミュージック / ユーティリティ（iOS）、音楽＆オーディオ（Android）

## Android: フォアグラウンドサービスの申告（Play Console）

- 種別: `microphone`
- 用途: ユーザーが開始したポッドキャスト収録を、画面ロック中・他アプリ使用中も継続するため
- 動画デモ: docs/device-checklist.md B-1 / B-2 を録画

## アイコン

`assets/images/icon.png`（1024x1024、アルファ無し）。シトロン地に `Pods` / `Now.` の 2 段ロゴタイプ（Issue #94）。
意味と再生成の手順は `assets/brand/README.md`。

## スクリーンショット（撮影予定）

日本語・英語の 2 セットを撮る（端末の言語設定を切り替えて同じ画面を撮影）。

1. Home（制作中の回と一覧）
2. 録音タブ（収録中、レベルメーターと話すこと）
3. 編集タブ（波形と範囲選択）
4. 書き出しタブ（音の仕上げと形式）
5. 配信の準備

ストア画像には架空の番組名・音声を使う。実際のユーザーの録音やパスを載せない（DESIGN_SYSTEM.md §11）。

## リリース手順（DEVELOPMENT.md §2 に従う）

1. `release/0.1.0` の Issue がすべて閉じていることを確認（#1〜#53、#80、#82）
2. 実機チェックリスト（docs/device-checklist.md）の B / C / D / E / J / K を両 OS で合格
3. `app.json` の `version` / `ios.buildNumber` / `android.versionCode` を確認
4. `release/0.1.0` → `main` の PR を作成しマージ
5. iOS: Xcode 26 で Archive → TestFlight。Android: `./gradlew :app:bundleRelease`（署名鍵は別途）→ 内部テスト
