# AUDIO_DESIGN.md — PodsNow 音声設計

> 凡例: **【事実】** 対話で決定した仕様 / **【確認済み】** 公式ドキュメント等で確認済み（出典付き） / **【仮説】** 未検証・要スパイク

## 1. 要件の要約【事実】

- 収録は非圧縮 PCM（WAV、48 kHz / 16 bit、ステレオ既定・モノラル可）
- 画面ロック・他アプリ表示中も録音継続（必須）
- 一時停止／再開、レベルメーター、入力ソース選択（内蔵 / 有線 / Bluetooth / オーディオインターフェース）
- 収録中のジングル挿入は「イベント記録 + モニター再生」。マイクに回り込ませず書き出し時にミックス
- 電話・他アプリ割り込み、クラッシュ、OS によるプロセス終了、ストレージ不足で録音を失わない
- 編集は非破壊。書き出し時に声 + 素材をミックス → ラウドネス正規化（-16 LUFS）+ BGM ダッキング → M4A(AAC) / WAV
- MVP 外: ノイズ除去、コンプレッサー、EQ、MP3 / FLAC

## 2. JS / ネイティブの境界【確認済み】

根拠: expo-audio SDK 57 ドキュメント (https://docs.expo.dev/versions/latest/sdk/audio/) と型定義 (https://raw.githubusercontent.com/expo/expo/main/packages/expo-audio/src/Audio.types.ts)。

| 処理 | 実装場所 | 理由 |
|---|---|---|
| 録音（PCM 取得 → WAV 書き込み） | **ネイティブ**（`podsnow-recorder`） | Android の expo-audio は `AndroidAudioEncoder = aac / he_aac / aac_eld / amr_*` のみで PCM 不可。iOS は `LINEARPCM` 可だが、統一のためネイティブ |
| Audio Session / Audio Focus 管理（録音中） | ネイティブ | 割り込み・ルート変更の通知が expo-audio に無い |
| レベルメーター（peak / RMS） | ネイティブ → イベント | 生 PCM が JS に来ないため |
| Android フォアグラウンドサービス | ネイティブ | `foregroundServiceType="microphone"`（Android 14+ 必須）【確認済み】 |
| WAV ヘッダ定期更新・fsync・復旧 | ネイティブ | ファイル I/O をリアルタイムスレッドで行う |
| 素材の試聴（単一ファイル再生） | **JS**（expo-audio `AudioPlayer`） | 十分 |
| 収録中のジングルのモニター再生 | JS（expo-audio）【仮説】 | 録音セッションと同居できるか要スパイク（§4.5） |
| 波形ピーク生成、無音検出 | ネイティブ（`podsnow-audio-engine`） | 数百 MB のファイル走査 |
| タイムラインのリアルタイムミックス再生 | ネイティブ | expo-audio に複数トラック同期再生・ゲイン自動化はない |
| ミックスダウン、ラウドネス測定 / 正規化、ダッキング、リミッター | ネイティブ | DSP |
| エンコード（AAC / WAV） | ネイティブ（OS 標準コーデック） | |
| 素材の取り込み変換（任意形式 → WAV 48k） | ネイティブ（OS 標準デコーダ） | |
| タイムライン計算（EDL）、無音カット計画、Undo | **JS**（`domain/`） | 純粋ロジック。テスト容易性 |
| 録音セッションの状態機械、復旧の指揮 | JS（`services/`） | UI と DB の整合を取る中枢 |

## 3. 録音パイプライン（`podsnow-recorder`）

### 3.1 iOS【仮説: 具体 API は実装時に Apple docs で確認】
```
AVAudioSession (category: .playAndRecord, mode: .default,
                options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker])
   │
AVAudioEngine.inputNode.installTap(bufferSize: 4096, format: input format)
   │  AVAudioPCMBuffer (Float32, device rate)
   ▼
AVAudioConverter → Int16, 48 kHz, mono/stereo
   │
   ├─▶ Level meter (peak/RMS per buffer) → JS event (10–20 Hz に間引き)
   └─▶ Ring buffer → Writer thread → seg-NNNN.wav (append)
                                   └─ 1 秒ごと: data chunk size をヘッダに書き戻し + fsync
```
- `.playAndRecord` は再生（ジングルモニター）と録音の同居のため。`.measurement` モードは OS の音声処理（AGC 等）を切る選択肢として設定で提供【仮説】。
- Bluetooth: `.allowBluetooth`（HFP。マイク入力可・低音質）と `.allowBluetoothA2DP`（出力のみ・高音質）の両立方針は要スパイク。ユーザーが BT マイクを選んだときのみ HFP を許可する【仮説】。
- サンプルレート: 入力デバイスのネイティブレート（44.1k の BT / 48k 内蔵など）を `AVAudioConverter` で 48k に統一【仮説】。

### 3.2 Android【仮説: 具体 API は実装時に Android docs で確認】
```
Foreground Service (type=microphone, 通知「録音中」)
   │
AudioManager.requestAudioFocus(GAIN) + OnAudioFocusChangeListener
   │
AudioRecord(source = VOICE_RECOGNITION or UNPROCESSED or MIC,
            48 kHz, ENCODING_PCM_16BIT, mono/stereo, buffer = 数十ms×4)
   │ read() ループ（専用スレッド、THREAD_PRIORITY_URGENT_AUDIO）
   ├─▶ Level meter → JS event
   └─▶ Writer → seg-NNNN.wav (+ 1 秒ごとヘッダ更新 + fsync)
```
- `AudioSource` の選択: `MIC` は端末の AGC/NS が効きやすく、`UNPROCESSED` はサポート端末で素の音。`VOICE_RECOGNITION` は AGC 無し・NS 有りの折衷。既定は要スパイクで決める（音質比較）【仮説】。
- 入力デバイス選択: `AudioRecord.setPreferredDevice(AudioDeviceInfo)`（API 23+）【仮説】。
- Bluetooth SCO（HFP）マイクは `AudioManager.startBluetoothSco()` 系の扱いが必要で複雑【仮説】。MVP では「BT マイクは選べるが音質警告」に留める。
- **制約【確認済み】**: マイク FGS はアプリがフォアグラウンドのときにしか開始できない (https://developer.android.com/develop/background-work/services/fgs/service-types)。録音開始は必ず画面操作から。

### 3.3 WAV 書き込みとクラッシュ耐性【設計】
1. 開始時に 44 byte ヘッダを「data size = 0xFFFFFFFF（未確定）」で書く。
2. PCM を追記。1 秒ごとに `RIFF size` と `data size` を現在値で上書きし `fsync`（iOS: `fcntl(F_FULLFSYNC)` は重いので通常 `fsync`【仮説】）。
3. 停止時に最終ヘッダを書いて close。
4. クラッシュ時: ヘッダは最大 1 秒古いだけ。復旧処理はファイル実長から再計算して上書き（DATA_MODEL.md §6）。
5. 4 GB 超の WAV は非対応（60 分モノラル ≈ 345 MB なので実用上問題なし。3 GB を超えたら Segment を自動ローテーション）【仮説】。

### 3.4 レベルメーター
- バッファごとに peak（dBFS）と RMS を計算。JS には 50 ms 間隔で送る（`level` イベント）。
- -1 dBFS 超が連続したら「クリップ」表示。UI は Reanimated で描画し JS スレッドを塞がない【仮説】。

### 3.5 一時停止
- ファイルは閉じず、書き込みだけ止める（Segment は分けない）。iOS はエンジンを止めない（セッション維持）。Android は `AudioRecord` と read ループを動かしたままにし、読み出したバッファをファイルに書かず捨てる（デバイスの再初期化コストとギャップを避けるため）。長時間ポーズはバッテリーを消費するため、10 分以上で通知【仮説】。

## 4. 割り込み・異常系マトリクス

| 事象 | iOS 検知 | Android 検知 | 動作 |
|---|---|---|---|
| 電話着信・Siri・他アプリの排他再生 | `AVAudioSession.interruptionNotification` `.began`【確認済み】(https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions) | `OnAudioFocusChangeListener` `AUDIOFOCUS_LOSS*`【仮説】 | 現在の Segment を確定（`reason_closed='interruption'`）。Take は `recording` のまま。JS へ `interruption.began`。UI は「割り込みで停止しました」 |
| 割り込み終了 | `.ended` + `AVAudioSessionInterruptionOptionKey` の `.shouldResume`【確認済み】 | `AUDIOFOCUS_GAIN` | `shouldResume` かつ設定「自動再開」なら新 Segment で再開。それ以外は「再開しますか？」ボタン。いずれも Take 上に `interruption` マーカー |
| Android: 割り込み終了時にアプリがバックグラウンド | — | FGS は継続中なので `AudioRecord` の再開は可能と想定 | 【仮説】要スパイク。FGS が生きている限り再開可能か確認 |
| 入力デバイス抜去（有線マイク抜け、BT 切断） | `routeChangeNotification` `oldDeviceUnavailable`【仮説】 | `AudioDeviceCallback.onAudioDevicesRemoved`【仮説】 | 既定は継続（内蔵マイクへフォールバック）+ `route_change` マーカー。設定で「停止する」も選べる |
| 画面ロック / 他アプリへ切替 | Background mode `audio` で継続 | FGS で継続 | 何もしない。通知にレベル/経過時間【仮説】 |
| OS によるプロセス終了（メモリ圧迫等） | 検知不能 | FGS でも殺され得る | 次回起動時の復旧（DATA_MODEL.md §6）。ヘッダは 1 秒以内の鮮度 |
| アプリクラッシュ（JS 例外） | ネイティブは生きている | 同左 | JS の ErrorBoundary で録音セッションを `stop()` してから再起動を促す【仮説】 |
| ストレージ不足 | Writer が `availableDiskSpace` を 5 秒ごと確認【仮説】 | 同左 | しきい値で `diskLow` → 正常停止 → Take 確定 → 通知 |
| 書き込みエラー（I/O） | Writer が例外 | 同左 | Segment を可能な限り確定 → `error` イベント → Take `recovered` 扱い |
| `mediaServicesWereReset`（iOS のオーディオデーモン再起動） | `AVAudioSession.mediaServicesWereResetNotification`【仮説】 | — | Segment 確定 → エンジン再構築 → 手動再開 |

## 5. ジングルのモニター再生と回り込み【事実 + 仮説】

- 挿入ボタン → `overlay_clips` に `anchor_type='source'` で記録（Take 内の現在位置）。これが「正」。
- 同時に手元で再生（モニター）。**スピーカー出力中はマイクに回り込む**ので:
  - 出力ルートがイヤホン / BT 出力のとき: 再生する
  - スピーカーのとき: 設定 `monitor.jinglePlayback` に従う（既定 `headphonesOnly` = 再生せず「挿入しました」表示のみ）
- 再生は expo-audio `AudioPlayer`【仮説】。録音セッション（ネイティブが `.playAndRecord` を保持）と同居できるか、expo-audio の `setAudioModeAsync` がセッション設定を上書きしないかを Phase 0 で確認。衝突するなら `podsnow-recorder` に簡易プレイヤーを持たせる。

## 6. 解析（`podsnow-audio-engine`）

### 6.1 波形ピーク
- 入力 WAV を走査し、100 サンプル/秒【仮説】で区間 min/max（Int8 正規化）を `.peaks` に書く。60 分で ≈ 720 KB。
- 生成は Take 確定直後にバックグラウンドで実行。UI は生成完了までプレースホルダ。
- ズーム時は `.peaks` をさらに間引く（JS）。最大ズームでは `.peaks` の解像度（10 ms）で十分【仮説】。

### 6.2 無音検出
- 20 ms 窓の RMS(dBFS) を計算 → しきい値（既定 -45 dBFS【仮説】）未満が `minDurationMs`（既定 1500 ms）以上続く区間を返す。
- JS 側 `planSilenceRemoval` が前後 250 ms【仮説】の余白を残して削除範囲を作る。ユーザーは件数・合計秒数を見てから適用。

## 7. 再生（タイムラインのリアルタイムミックス）【仮説】

- iOS: `AVAudioEngine` に声用 `AVAudioPlayerNode` ×1 とオーバーレイ用 ×N を接続し、`scheduleSegment` でタイムライン通りに予約。ゲイン・フェード・ダッキングは `AVAudioMixerNode` の volume 自動化か、自前で PCM を加工してからスケジュールする。
- Android: `AudioTrack` 1 本に対し、自前ミキサーがタイムラインから PCM を生成して書き込む（プル型）。
- **推奨**: 両 OS とも「自前ミキサー（§8 と同じコード）が PCM を生成 → 出力 1 本」に統一する。再生と書き出しで同じレンダラを使えば、聴いた通りに書き出せる。Phase 2 で確定。

## 8. レンダリング（書き出し）

```
RenderDocument (JSON)
  │
  ▼
Mixer: 声 EDL を順に読み出し（Segment ファイルをシーク）+ オーバーレイをアンカー位置に合成
  ├─ 各クリップ: gain, fade in/out
  ├─ Ducking: 声のエンベロープ（RMS, attack 50 ms / release 500 ms【仮説】）で BGM ゲインを depthDb まで下げる
  ▼ Float32 PCM 48 kHz (mono / stereo、§8.1)
測定パス: ITU-R BS.1770-4 統合ラウドネス + トゥルーピーク（4 倍補間）
  ▼
Gain = target(-16 LUFS) − measured（-40〜+20 dB）
  ▼（ゲイン後のトゥルーピークが天井を超えるときだけ）
測り直しパス: ゲイン + リミッター後の出力を測り、割線法でゲインを合わせる（最大 3 回、±0.1 LU）
  ▼
本番パス: Gain → トゥルーピークリミッター（ceiling -1 dBTP）→ 出力を測定 → Encoder
Encoder: AAC (iOS AVAssetWriter / Android MediaCodec+MediaMuxer) または WAV writer
  ▼ progress イベント → exports.progress
```
- 中間 PCM は持たず、パスごとにミキサーで作り直す（60 分でも一時ファイルが要らない）。
- `exports.measured_lufs` / `measured_true_peak` は**書き出したファイル（出力）**の実測値。UI（書き出し履歴・配信の準備）に表示し、目標より 1 LU 以上小さければ「目標に届いていません」と出す。
- 書き出しはネイティブスレッド。iOS はバックグラウンドでも数分は継続（`beginBackgroundTask`【仮説】）。Android は短時間 FGS（`dataSync` 種別【仮説】）または前面のみ。
- 決定論: 同じ `RenderDocument` から両 OS で同じ PCM を出すため、DSP は整数／Float32 の固定手順で書き、ゴールデンファイルテストで検証（ARCHITECTURE.md §5.3 の C++ 共通コア案の動機）。

### 8.1 チャンネルの扱い【事実】

ミキサー以降（ラウドネス測定・トゥルーピーク・リミッター・エンコード）は `RenderDocument.channels`（1 / 2）のインターリーブ PCM で処理する。

| 素材 \ 出力 | モノラル (1) | ステレオ (2) |
|---|---|---|
| モノラル素材 | そのまま | 左右に複製 |
| ステレオ素材（ステレオ録音・バイノーラル・ステレオ BGM） | 左右の平均 | 左右をそのまま保つ |

- ラウドネスは BS.1770-4 に従い各チャンネルの二乗和で測る（L / R の重み 1.0）。同じ音を左右に入れたステレオはモノラルより +3.01 LU と測られる。
- リミッターのゲインは全チャンネル共通（リンク）。片側だけ大きくても定位は崩れない。
- ダッキングの声検出は、各フレームで左右の大きいほうを使う（片側マイクの話者も拾う）。
- 試聴（§7）は常にステレオで鳴らす。ステレオ録音の左右を編集中にも確かめられる。
- 素材（BGM / ジングル等）はステレオ 48 kHz で取り込む。モノラルの元ファイルは左右同じになる。この変更より前に取り込んだ素材はモノラルのまま。

### 8.2 ラウドネスとトゥルーピーク【事実】

実装: `modules/podsnow-audio-engine/{ios/Loudness.swift, android/.../Loudness.kt}`（同じ手順・同じ定数）。

- **K 特性フィルタ**: libebur128 と同じ双一次変換の式（f0 = 1681.97 Hz / 38.14 Hz ほか）。48 kHz で BS.1770-4 Table 1 / 2 の係数と一致する。
  - 以前は同じパラメータを RBJ cookbook の式に入れており、2 kHz 付近で最大 0.41 dB 低く測っていた（= 書き出しがその分大きくなっていた）。
- **ゲーティング**: 400 ms ブロック・75% 重なり、-70 LUFS 絶対ゲート、-10 LU 相対ゲート。
- **トゥルーピーク**: 49 タップ Hann 窓 sinc の 4 相補間（libebur128 と同じ設計）。正弦波で真値との差は 15 kHz まで ±0.05 dB 程度。以前の 8 タップは高域で最大 1 dB 低く見積もっていた。
- **リミッター**: ピークはサンプル間（4 倍補間）で検出し、天井より 0.2 dB 低く収める。必要ゲインを「補間の遅れ + 先読み 5 ms」で最小値ホールドし、5 ms の移動平均で滑らかにしてから掛ける（瞬時にゲインを下げると波形に角ができ、それ自体がサンプル間ピークになる）。戻りは 50 ms。
- **目標への合わせ込み**: リミッターで削った分だけ音量が下がる（声の合成信号で約 1.2 LU）。リミッターが働くときだけ、出力を測り直してゲインを割線法で合わせる。持ち上げは +20 dB まで（雑音を持ち上げすぎないため）で、それでも届かない録音は UI で知らせる。
- **参考**: libebur128（https://github.com/jiixyj/libebur128 、MIT License）【確認済み】。BS.1770-4 の係数値は同書の既知の値と数値で照合（ITU の原文はこの作業環境から取得できず未照合）。

検証【確認済み: JVM 上の Kotlin 実装】（`android/src/test`、JUnit 14 件）

| 項目 | 結果 |
|---|---|
| EBU Tech 3341 ケース 1〜5（1 kHz ステレオ正弦、許容 ±0.1 LU） | 最大誤差 0.02 LU |
| 1 kHz 正弦 -6.02 dBFS（モノラル） | -9.02 LUFS（理論値 -9.03） |
| 声の合成信号を -16 LUFS / -1 dBTP で書き出し | -15.96〜-16.01 LUFS（pyloudnorm で -16.00〜-16.05）、トゥルーピーク -1.2 dBTP（16 倍再構成でも ≤ -0.99 dBTP） |
| 小さすぎる録音（+20 dB で頭打ち） | 目標未達として検出 |

- 処理時間（参考、サーバー CPU）: 120 秒ステレオで約 2.4 秒（測り直し 2 回を含む）。60 分なら約 1 分強。実機では数倍かかる見込み【仮説】。
- **未検証**: Swift 実装（この環境でビルドできない）、実機での書き出し時間、AAC エンコード後のトゥルーピーク（エンコーダで少し増える。-1 dBTP の天井はその余裕）。

## 9. コーデック対応表

| 形式 | iOS | Android | MVP |
|---|---|---|---|
| WAV (PCM) | ○ 自前 writer | ○ 自前 writer | ✅ |
| M4A (AAC-LC) | ○ OS 標準【仮説: AVAssetWriter】 | ○ OS 標準エンコーダ【確認済み】(https://developer.android.com/media/platform/supported-formats) | ✅ |
| MP3 | ✕ OS 標準エンコーダ無し【仮説: Apple は MP3 デコードのみ。要確認】 | ✕ 「Encoder: Not supported」【確認済み】 | 次フェーズ（LAME を同梱。LGPL の扱いを検討） |
| FLAC | 【仮説】AudioToolbox に FLAC エンコード有り（iOS 11+）。要確認 | ○ Android 4.1+【確認済み】 | 次フェーズ |
| Opus | 【仮説】未確認 | ○ Android 10+【確認済み】 | 対象外 |

素材取り込み（デコード）: MP3 / AAC / WAV / FLAC / ALAC は両 OS の標準デコーダで対応できる想定【仮説】。

## 10. Audio Session 設定の一元管理
- 録音中は `podsnow-recorder` がセッションの所有者。JS 側で expo-audio の `setAudioModeAsync` を呼ぶのは録音していないときだけ（`RecordingSession` が状態を見てガード）。
- 再生（Editor のタイムライン再生）も `podsnow-audio-engine` が同じセッション設定（`.playback` / `.playAndRecord`）を使う。

## 11. 検証計画（Phase 0 スパイク）

| # | 検証項目 | 合格基準 |
|---|---|---|
| S-1 | iOS: AVAudioEngine tap → WAV 書き込み、画面ロック 30 分、着信 1 回 | 欠落なし。割り込み位置がマーカーに残る |
| S-2 | Android: AudioRecord + microphone FGS、画面ロック 30 分、着信 1 回 | 同上。Android 14 / 15 実機 |
| S-3 | 強制終了（スワイプで kill）後の復旧 | 直前 1 秒以内まで再生可能 |
| S-4 | expo-audio `AudioPlayer` を録音中に再生（ジングルモニター） | 録音が止まらない。イヤホン時に回り込みなし |
| S-5 | 入力切替（有線マイク / BT / オーディオ IF）とルート変更 | 抜去で録音が継続し、マーカーが打たれる |
| S-6 | BS.1770 測定の妥当性 | 既知のリファレンス音源（EBU テストファイル等）で ±0.1 LU |
| S-7 | 60 分素材の書き出し時間 | 実機で 3 分以内【仮説目標】 |
| S-8 | ピーク生成時間（60 分） | 10 秒以内【仮説目標】 |
| S-9 | Swift/Kotlin 二重実装 vs C++ 共通コアのビルド・工数比較 | Phase 2 の方針決定 |
| S-10 | ストレージ枯渇（テスト用に空き容量を埋める） | 正常停止し Take が確定する |
