# AUDIO_DESIGN.md — PodsNow 音声設計

> 凡例: **【事実】** 対話で決定した仕様 / **【確認済み】** 公式ドキュメント等で確認済み（出典付き） / **【仮説】** 未検証・要スパイク

## 1. 要件の要約【事実】

- 収録は非圧縮 PCM（WAV、48 kHz / 16 bit / ステレオで固定。設定は持たない。チャンネルとサンプルレートは書き出しで選ぶ。Issue #174）
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
| 再生の音声モード、再生中の割り込み・出力の抜去 | JS（`setAudioModeAsync` を 1 か所で）+ ネイティブ（タイムラインの音声フォーカス、検知） | §10 |
| レベルメーター（peak / RMS） | ネイティブ → イベント | 生 PCM が JS に来ないため |
| Android フォアグラウンドサービス | ネイティブ | `foregroundServiceType="microphone"`（Android 14+ 必須）【確認済み】 |
| WAV ヘッダ定期更新・fsync・復旧 | ネイティブ | ファイル I/O をリアルタイムスレッドで行う |
| 素材の試聴（単一ファイル再生） | **JS**（expo-audio `AudioPlayer`。`PlaybackService` のファイル再生を共用。§10.1） | 十分 |
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
- 再生は expo-audio `AudioPlayer`【仮説】。録音セッション（ネイティブが `.playAndRecord` を保持）と同居できるかを Phase 0 で確認。衝突するなら `podsnow-recorder` に簡易プレイヤーを持たせる。録音中は `setAudioModeAsync` を呼ばず、プレイヤーは `keepAudioSessionActive: true` で作る（§10.1）。

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

Issue #135 の画面間再生【事実】:
- 書き出しタブはこのタイムライン再生を使い、聴いた内容と書き出し結果を一致させる。
- **現状とのずれ【事実】:** 試聴の Mixer にかかる音の仕上げはダッキングだけで、ラウドネス正規化とトゥルーピークリミッターは書き出し時だけ（§8）。正規化を ON にしても試聴の音量は変わらない。
- **方針【事実】ユーザー判断（2026-09-29）:** 試聴には音の仕上げをすべて即座に反映する（REQUIREMENTS.md FR-EP-7、Issue #158）。統合ラウドネスは全体を測らないと決まらないので、測定パスを裏で先に走らせてゲインをキャッシュし、試聴の Mixer に書き出しと同じゲイン → リミッターを入れる案。今後の音の処理（ノイズ除去・EQ 等）も試聴でリアルタイムに鳴らせることを条件にする。
- Home は制作中の回と RSS から取り込んだ配信済みの回を同じ一覧に見せる。再生元は、端末に実体がある最新の書き出し済みファイル、対応する RSS `enclosure_url`、ローカルのタイムラインの順で選ぶ。RSS だけの回も `enclosure_url` があれば再生する。
- ファイル再生（書き出し・RSS）は読み込みを待たずに「読み込み中」を出し、音が出たら再生中に変える。バッファ待ちの間も読み込み中を出す。読み込みに失敗したら（URL が切れている・通信できない・壊れたファイル）再生を止め、`AppErrorCode`（`playback_stream_failed` / `playback_file_failed`）を出す。次に再生を押すと同じ再生元を読み込み直す。読み込み中に一時停止したら、読み込みが終わっても鳴らさない。後から別の回を再生したら、先の読み込みの結果は捨てる。【事実: Issue #185】【確認済み: expo-audio 57.0.5 の `AudioStatus` に `isLoaded` / `isBuffering` / `error`（`node_modules/expo-audio/build/Audio.types.d.ts`。https://docs.expo.dev/versions/v57.0.0/sdk/audio/ はこの環境から開けず未照合）】
- 両方の状態と切替はサービス層の単一 `PlaybackService` が所有する。一方を始める前に他方を止め、収録開始時は再生を自動停止する。音声セッション（音声モード・割り込み・イヤホンの抜去・録音との切り替え）は §10。
- 制作中の回と配信済みの回は、`feed_episodes.episode_id` の明示リンクを最優先し、次に GUID 完全一致だけを自動対応として扱う。題名や話数の類似では結びつけない。

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
後処理（JS、§8.3）: 題名・番組名・アートワーク等のメタデータを埋め込む → exports を done に
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
- 試聴（§7）は編集タブではステレオで鳴らす（ステレオ録音の左右を編集中にも確かめられる）。書き出しタブでは、選んでいる書き出し設定のチャンネル（モノラル / ステレオ）で鳴らす（`PlaybackService.setTimelineChannels`。Issue #174、ユーザー判断 2026-10-03）。

### 8.1.1 サンプルレートの扱い【事実 + 仮説】

ユーザー判断（2026-10-03、Issue #174）: **録音は 48 kHz 固定。書き出しで 48 kHz か 44.1 kHz を選ぶ。**

- タイムライン・ミックス・ラウドネス測定・リミッターはすべて 48 kHz（`RenderDocument.sampleRate`）で行い、**エンコードの直前に出力のレートへ変換する**（`RenderOptions.sampleRate`）。位置や長さ（`exports.duration_smp` を含む）は 48 kHz のサンプル数のまま。
- 変換は OS 標準・既存ライブラリのリサンプラーを使い、自前で補間しない（ユーザー判断）。
  - iOS: `AVAudioConverter`（`sampleRateConverterQuality = .max`、アルゴリズム `Mastering`）。`RenderJob.swift` の `ResamplingSink`【仮説: 実機で未検証】
  - Android: Media3 の `SonicAudioProcessor`（`androidx.media3:media3-common`。expo-audio と同じ版）。`RenderJob.kt` の `ResamplingSink`【仮説: 実機で未検証】
    - 線形補間なので高域がわずかに下がる（理論値で 10 kHz が約 -1.3 dB、15 kHz が約 -3 dB）。下げる変換で、劣化させたくなければ 48 kHz を選べばよい。ポッドキャスト配信の用途では受け入れる（ユーザー判断 2026-10-03）。高品質な変換が要る用途になったら Oboe のリサンプラー（ポリフェーズ sinc）を検討する
- 試聴にはサンプルレートを反映しない（変換は書き出しの最後だけ）。
- 測定値（`measured_lufs` / `measured_true_peak_db`）は変換前の 48 kHz の値。変換で増えるサンプル間ピークはごくわずかの見込み【仮説】。
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

### 8.3 メタデータの埋め込み（Issue #56、FR-EXP-10）【事実 + 仮説】

ネイティブのレンダ（ミックス・ラウドネス・リミッター・エンコード）が終わったあと、`ExportService` が**後処理として** JS で埋め込み、それから `exports` を `done` にする。`RenderJob` / `Loudness` には手を入れない。

- 両 OS とも同じ実装（`src/services/export/embedMetadata.ts`、バイト列の組み立ては `src/domain/metadata/`）。
  - Android の `MediaMuxer` には題名・アートワークなどファイル単位のメタデータを書く API が無い【確認済み】（公開メソッドは `addTrack` / `setLocation` / `setOrientationHint` / `start` / `stop` / `writeSampleData` / `release`。「Metadata Track」はフレームごとの時刻付きデータで別物）。https://developer.android.com/reference/android/media/MediaMuxer
  - iOS の `AVAssetWriter.metadata` は書ける（書き込み開始後は変更不可）【確認済み】が使わない。片方の OS だけ別経路にすると、同じ値・構造かを片方しか確かめられないため。https://developer.apple.com/documentation/avfoundation/avassetwriter/metadata
- **M4A**: `moov/udta/meta`（ハンドラ `mdir`）の `ilst` に iTunes 形式で書く。値の型は QuickTime の well-known types（UTF-8 = 1、JPEG = 13、PNG = 14、`trkn` は 0）【確認済み】https://developer.apple.com/documentation/quicktime-file-format/well-known_types
  - `moov` を組み直した写しを同じフォルダ（`<exportId>.m4a.tagging`）に書き、できてから元と置き換える。途中で失敗しても元は壊れない。
  - `moov` が `mdat` より前にあれば、大きくなった分だけ `stco` / `co64` をずらす。`MediaMuxer` がどちらに置くかは未確認【仮説】なので、どちらでも動くようにした。
  - 既存の `udta/meta` は置き換え、`udta` のほかの子（位置情報など）は残す。
- **WAV**: 末尾に `LIST/INFO` を足し、RIFF の長さを直す（数百 MB を写さないため、その場で書く）。**アートワークは入れない**（WAV にアートワークの標準は無い。`id3 ` チャンクは慣習で、読めるアプリがまちまち）。文字は UTF-8【仮説: 古い Windows のアプリでは化けることがある】。
- 埋め込めなかったら書き出しを `failed`（`error = export_metadata_failed`）にし、ファイルは消す。題名やアートワークの無いファイルが配信されるのを防ぐ。アートワークだけ読めない（無い・JPEG / PNG でない）ときは、アートワークを省いて続ける。
- 長いファイルの写しで画面を止めないよう、4 MB ごとに JS のスレッドを空ける。

| 項目 | MP4 | WAV | 値 |
|---|---|---|---|
| 題名 | `©nam` | `INAM` | エピソードのタイトル（空なら書かない） |
| アーティスト | `©ART` / `aART` | `IART` | 番組の著者（`shows.author`）。空なら番組名 |
| アルバム | `©alb` | `IPRD` | 番組名 |
| 話数 | `trkn` | `ITRK` | `episodes.episode_number` |
| 日付 | `©day` | `ICRD` | 配信日時 `published_at` → 無ければ配信予定 `publish_planned_at`。端末の時差つき ISO 8601（WAV は日付だけ）。どちらも無ければ書かない |
| ジャンル | `©gen` | `IGNR` | `Podcast`（ID3 の拡張ジャンル名。訳さない） |
| 書いたアプリ | `©too` | `ISFT` | `PodsNow <version>` |
| アートワーク | `covr` | — | `shows.cover_path` |

検証
- 【確認済み: Jest】書き出したファイル（ffmpeg 6.1 で作った AAC。`moov` が後ろ / 前の 2 種類）に埋め込み、読み戻して値・アートワークが一致すること、`mdat` が 1 バイトも変わらずチャンク位置がずれた先を正しく指すこと、壊れたファイルで元が残ること（`src/services/export/__tests__/embedMetadata.test.ts`）。
- 【確認済み: この作業環境】同じ処理の出力を ffprobe（FFmpeg 6.1.1）と mutagen（Python）で読み、全項目とアートワークを読めた。デコードした音声の MD5 が埋め込み前と一致。
- **未検証（実機）**: iOS の `AVAssetWriter` と Android の `MediaMuxer` が実際に書いたファイルへの埋め込み、iOS の「ファイル」アプリ・ミュージック、Android のファイルアプリ、配信サービス（Spotify for Creators / stand.fm）のアップロード画面での表示。手順は Issue #56 のコメント。

## 9. コーデック対応表

| 形式 | iOS | Android | MVP |
|---|---|---|---|
| WAV (PCM) | ○ 自前 writer | ○ 自前 writer | ✅ |
| M4A (AAC-LC) | ○ OS 標準【仮説: AVAssetWriter】 | ○ OS 標準エンコーダ【確認済み】(https://developer.android.com/media/platform/supported-formats) | ✅ |
| MP3 | ✕ OS 標準エンコーダ無し【仮説: Apple は MP3 デコードのみ。要確認】 | ✕ 「Encoder: Not supported」【確認済み】 | 次フェーズ（LAME を同梱。LGPL の扱いを検討） |
| FLAC | 【仮説】AudioToolbox に FLAC エンコード有り（iOS 11+）。要確認 | ○ Android 4.1+【確認済み】 | 次フェーズ |
| Opus | 【仮説】未確認 | ○ Android 10+【確認済み】 | 対象外 |

素材取り込み（デコード）: MP3 / AAC / WAV / FLAC / ALAC は両 OS の標準デコーダで対応できる想定【仮説】。

## 10. 音声セッションの持ち主と切り替え（録音・再生）【事実】

Issue #183。録音前の入力モニター（#169）とロック画面・通知の操作（#184）はこの節に従う。
ここでいう音声セッションは、iOS の `AVAudioSession`（カテゴリ・オプション・有効化）と Android の音声フォーカス。

### 10.1 持ち主は同時に 1 つ

| 持ち主 | 期間 | 設定する場所 |
|---|---|---|
| **録音側** | 入力モニター（#169）・録音の準備・録音中・一時停止中・割り込み中・停止処理中。`RecordingSession` が `idle` でない間 | `podsnow-recorder`。`prepare()` のたびに iOS `.playAndRecord`、Android `AUDIOFOCUS_GAIN`（§3） |
| **再生側** | `PlaybackService` が再生を始めてから、次に録音側が取るまで | 音声モード（§10.2）は `src/infra/playback/playbackSession.ts` だけが `setAudioModeAsync` で決める。タイムライン再生の Android の音声フォーカスと、割り込み・抜去の検知は `podsnow-audio-engine` の `PlaybackSessionWatcher`（§10.3） |

- **後から取る側が設定し直す。手放す側は元に戻さない。** 戻すと、次の持ち主の設定と順番しだいで食い違う（録音直後の再生で出力先・音量が変わる、Issue #183）。
  - 録音側が取るとき: 先に `PlaybackService.stopForRecording()` で再生を止め、それから `recorder.prepare()` が録音用に設定する。入力モニター（#169）も始める前に `stopForRecording()` を呼び、`RecordingSession` が `idle` でない状態として扱う（そうしないと下の「再生を断る」が効かない）。
  - 再生側が取るとき: `PlaybackService` は再生を始める直前に**毎回** `PlaybackSessionPort.enterPlayback()` で §10.2 のモードを当て直す。録音のあとに `.playAndRecord`（`.defaultToSpeaker`、Bluetooth の通話プロファイル）が残っていても、ここで再生用に戻る。録音側は毎回 `prepare()` で設定し直すので、再生用に戻しても次の録音は壊れない。
- **録音側が持っている間、`PlaybackService` は再生を始めない**（`recorderBusy()` が真なら再生・再開を断る）。割り込みのあとの自動再開（§10.3）もしない。
- **セッションを無効にしない（`setActive(false)` を呼ばない）。** expo-audio は既定で、自分のプレイヤーが止まる・鳴り終わると 100 ms 後にセッションを無効にする【事実: コード】（`node_modules/expo-audio/ios/AudioModule.swift` の `pause` / `onPlaybackComplete` → `deactivateSession()`）。同じアプリのタイムライン再生や録音が鳴っていても無効にするので、expo-audio のプレイヤーは必ず `keepAudioSessionActive: true` で作る。
  - ファイル再生（`expoFilePlayback.ts`）: 一時停止してタイムライン再生へ切り替えた直後に、タイムラインが止まるのを防ぐ。
  - 録音中のジングルのモニター（§5、`features/episode/monitor.ts`）: 鳴り終わったときに録音の I/O を止めないため【仮説: 有効なセッションを無効にすると動いている I/O が止まる。実機で未検証】。録音側のセッションに相乗りするので `setAudioModeAsync` も呼ばない。
  - 素材の試聴（素材の一覧と、番組設定の既定構成）: `PlaybackService.toggleAssetPreview()` で、ファイル再生と同じプレイヤーを使う（`features/show/useAssetPreview.ts`）。始めるとほかの再生は止まり、録音側が持つ間は始めない。ミニプレーヤーには出さない（`source` は null）。画面を離れたら止める（Issue #174）。
  - 無効にしない代わり、他アプリの音は再生を止めても自動では戻らない。必要になったら、持ち主が手放すとき（ミニプレーヤーを閉じる等）に限って無効にすることを別 Issue で検討する。
- ロック画面・通知の操作は再生側が持つ間だけ出す。録音側が取ったら消す（録音の通知と混ぜない）。状態は `PlaybackService` から出し、アプリ内のプレーヤーと同じ値を見る（§10.5）。

### 10.2 再生の音声モード

`setAudioModeAsync`（expo-audio 57.0.5）に渡す値。`src/infra/playback/playbackSession.ts` の `PLAYBACK_AUDIO_MODE` が唯一の定義。

| 項目 | 値 | 理由 |
|---|---|---|
| `interruptionMode` | `'doNotMix'` | 他アプリの音と重ねない（既定の `mixWithOthers` では重なり、Android では音声フォーカスを取らないので着信でも止まらない【確認済み: `node_modules/expo-audio/build/Audio.types.d.ts`】）。expo-audio のロック画面（`setActiveForLockScreen`）も `doNotMix` を求める（同）。ロック画面は自作にした（§10.5）が、OS の他アプリとの扱いは同じ |
| `shouldPlayInBackground` | `true` | 画面を消しても・他アプリへ移っても続ける（REQUIREMENTS.md FR-EP-8）。`false` だと expo-audio はバックグラウンドへ移るときに止める【事実: コード】 |
| `playsInSilentMode` | `true` | 消音スイッチ・マナーモードでも鳴らす。再生ボタンを押した操作を優先する |
| `allowsRecording` | `false` | iOS のカテゴリは `.playback`。録音の設定は録音側が `prepare()` で行う |
| `shouldRouteThroughEarpiece` | `false` | 受話口ではなくスピーカー（またはつないだイヤホン）から鳴らす |

- iOS: expo-audio はこの値から `.playback`・オプションなしを設定する【事実: コード】（`AudioModule.swift` の `setAudioMode`）。タイムライン再生（`TimelinePlayer.swift`）は**カテゴリを設定せず**、`setActive(true)` だけ行う。カテゴリを決めるのは JS の 1 か所だけにする。
- Android: expo-audio は `doNotMix` のとき、ファイル再生の開始時に `AUDIOFOCUS_GAIN_TRANSIENT` を取り、喪失で止め、`AUDIOFOCUS_GAIN` で再開する【事実: コード】。タイムライン（`AudioTrack`）は expo-audio の外なので、`PlaybackSessionWatcher.kt` が再生開始時に `AUDIOFOCUS_GAIN`（`USAGE_MEDIA` / `CONTENT_TYPE_SPEECH`、`setWillPauseWhenDucked(true)`）を取り、利用者の一時停止・鳴り終わり・解放で手放す。話し声はダッキングではなく一時停止する【確認済み】(https://developer.android.com/media/optimize/audio-focus)。
- バックグラウンド: iOS は `UIBackgroundModes: audio`（`app.json`。録音のために入れたもの）で続く。Android はロック画面の操作（前面サービス）が無いと約 3 分で止まる【確認済み: 型定義の `shouldPlayInBackground` の注記】。ファイル再生もタイムライン再生も、§10.5 の前面サービス（`mediaPlayback`）でプロセスを保つ。

### 10.3 割り込み・出力の抜去

ファイル再生とタイムライン再生で同じ動きにする。止める・再開するの判断は `PlaybackService` の 1 か所。

| 事象 | iOS の検知 | Android の検知 | 動作 |
|---|---|---|---|
| 着信・Siri・他アプリの排他再生 | `interruptionNotification` `.began` | 音声フォーカスの喪失（`LOSS` / `LOSS_TRANSIENT` / `LOSS_TRANSIENT_CAN_DUCK`） | 一時停止 |
| 割り込みの終了 | `.ended` + `.shouldResume`【確認済み】(https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions) | 一時的な喪失のあとの `AUDIOFOCUS_GAIN`【確認済み】(https://developer.android.com/media/optimize/audio-focus) | OS が再開を勧めるときだけ、**割り込みで止めた再生を**再開する。割り込み中に利用者が操作した・録音を始めた・別の回を再生した場合は再開しない。永続の喪失（`AUDIOFOCUS_LOSS`）では `GAIN` が来ないので再開しない |
| イヤホン・Bluetooth が外れた | `routeChangeNotification` `.oldDeviceUnavailable`（直前の出力が内蔵スピーカー・受話口以外のとき）【仮説: Apple の該当ページはこの環境から本文を取得できず未照合】 | `ACTION_AUDIO_BECOMING_NOISY`【確認済み】(https://developer.android.com/media/platform/output) | 一時停止。**自動では再開しない**（スピーカーから突然鳴らさない） |

経路:

1. `podsnow-audio-engine` の `PlaybackSessionWatcher`（`ios/PlaybackSessionWatcher.swift`、`android/.../PlaybackSessionWatcher.kt`。`TimelinePlayer` とは別のファイル）が検知する。アプリが動いている間は常に見張る（録音中も。そのとき `PlaybackService` は鳴らしていないので何もしない）。
2. Watcher は `onPlaybackInterruption`（`{ type: 'began' | 'ended', shouldResume }`）/ `onOutputDisconnected` を JS へ送り、**そのあとで**タイムライン再生をネイティブ側で止める。JS を待つ間にスピーカーから鳴らさないためと、`PlaybackService` が「割り込みの時点で鳴っていたか」をイベントの順番で正しく知るため（止めた通知 `onPlaybackState` が先に届くと、鳴っていなかったと判断してしまう）。
3. `PlaybackService` はイベントを受けて、鳴っている方（ファイル / タイムライン）を止め、割り込みなら止めた方を覚える。終了のイベントで再開を判断する。
4. expo-audio も自分のプレイヤーを止め・再開する（iOS: 割り込みと抜去で止め、`.shouldResume` で再開。Android: フォーカスの喪失で止め `GAIN` で再開。抜去は扱わない）【事実: コード】。`PlaybackService` の止める・鳴らす操作はどちらも冪等なので、二重になっても状態は食い違わない。
   - ただし expo-audio の再開は、割り込み中に利用者が止めた・閉じたプレイヤーまで鳴らし直す（iOS は割り込みの時点で鳴っていたものを無条件に `play()`、Android は利用者の一時停止で再開の印を消さない）【事実: コード】。そのため `PlaybackService` はファイル再生を「鳴らしたいか」（`fileWanted`、こちらの操作だけで変わる）で持ち、鳴らしたくないのに鳴り出したら止め返す。ミニプレーヤーを閉じたあとに画面に出ないまま鳴り出すのを防ぐ。
   - iOS では expo-audio の止めた通知が Watcher のイベントより先に届くことがある。割り込みの時点で鳴っていたかは `fileWanted` で見るので、順番に依らない。
   - ロック画面・通知の操作も `PlaybackService` を通す（§10.5）。expo-audio の `setActiveForLockScreen` の操作はプレイヤーを直接鳴らすので、上の止め返しで止まる。使わない理由の 1 つ。
5. Android のファイル再生の音声フォーカスは expo-audio が持つ（Watcher がフォーカスを取ると expo-audio のプレイヤーが喪失を受けて止まる）。そのため Android のファイル再生では割り込みのイベントは来ず、`PlaybackService` は状態通知（`playbackStatusUpdate`）で追う。抜去（`BECOMING_NOISY`）は Watcher が受けるので、ファイル再生でも止まる。

### 10.5 ロック画面・通知の操作（Issue #184）

ファイル再生（書き出し・配信）とタイムライン再生（下書き・書き出しタブの試聴）で、同じ表示と操作を出す。

**出すもの**: 題（空なら「無題のエピソード」）、番組名、番組のアートワーク（`shows.cover_path`。プレーヤー画面と同じ）、長さ、再生位置、再生中か。操作は再生 / 一時停止、15 秒戻る、30 秒進む、位置の指定（シークバー）。Android の通知には「止めて閉じる」も出す。ヘッドホン・Bluetooth の再生ボタンも同じ操作として届く。

**持ち主と経路**:

1. 表示と OS からの操作の受け口は `podsnow-audio-engine` の `NowPlaying`（`ios/NowPlaying.swift`、`android/.../NowPlayingService.kt`）。`TimelinePlayer` とは別のファイルにする（`Mixer` を触る #158 と並行するため）。
2. 何を出すかは `PlaybackService` だけが決め、`NowPlayingPort.update()` / `clear()` で渡す。アプリ内のミニプレーヤー・プレーヤー画面と同じ状態（`source` / `isPlaying` / `position` / `duration`）から作るので食い違わない。
3. OS からの操作（`onRemoteCommand`）は鳴らす側を直接触らず、JS の `PlaybackService` に送る。`PlaybackService` が操作し、その結果の状態がまた表示に戻る。利用者の操作として扱うので、割り込みのあとの自動再開は取り消す（§10.3）。
4. 位置は、状態が変わったとき・位置を動かしたとき・再生元が変わったときだけ送る。間は OS が再生中かどうかから進める（iOS `MPNowPlayingInfoPropertyPlaybackRate`、Android `PlaybackState` の速度と更新時刻）。0.1 秒ごとに送らない。

**出す期間**:

- 出す: 利用者が再生を始めたとき（Home・プレーヤー・書き出しタブ・編集画面）。一時停止中も出したままにし、ロック画面から再開できるようにする。
- 消す: ミニプレーヤーの「閉じる」・通知の「止めて閉じる」（`stopHome`）、再生中の書き出しを削除したとき、エピソード画面を抜けたとき（Home から始めていないタイムライン再生）、**録音側が取ったとき**（`stopForRecording`。#169 の入力モニターも同じ）。録音中は出さない（録音の通知と混ぜない。§10.1）。
- 素材の試聴（§10.1）はロック画面に出さない（ミニプレーヤーにも出さない再生なので）。試聴を始めると、それまで出していた表示は消える（同じプレイヤーで鳴らすため、前の再生は止まっている）。

**expo-audio の `setActiveForLockScreen` を使わない理由**【事実: コード】（`node_modules/expo-audio/ios/MediaController.swift`、57.0.5）:

- 送り・戻しの秒数が 10 秒で固定（`preferredIntervals = [10.0]`）。#184 は 15 秒戻る / 30 秒進む。
- ロック画面の操作がプレイヤーを直接動かし、`PlaybackService` を通らない。アプリ内の状態と食い違い、§10.3 の止め返しとも衝突する。
- iOS の `MPRemoteCommandCenter` はアプリで 1 つなので、タイムライン再生の自作と同時に使えない。また、足したハンドラを `removeTarget(self)` で外しており、クロージャで足したものは外れない（切り替えのたびに溜まる）。
- 対象は expo-audio のプレイヤーだけで、タイムライン再生（ネイティブ）は出せない。結局 2 つの実装になる。

**Android の前面サービス**:

- 種別は `mediaPlayback`（`FOREGROUND_SERVICE_MEDIA_PLAYBACK`。Android 14 以降は必須）【確認済み】(https://developer.android.com/develop/background-work/services/fgs/service-types)。宣言は `podsnow-audio-engine` の `AndroidManifest.xml`。expo-audio の config plugin（`AudioControlsService`）は使わない。
- 表示している間は、一時停止中も前面に保つ。【仮説】一時停止で前面を外すと、ロック画面から再開するときにバックグラウンドから前面サービスを始め直すことになり、Android 12 以降の制限で失敗するおそれがある。代わりに通知に「止めて閉じる」を置き、消したい人が消せるようにする。
- 前面サービスは利用者が画面で再生を押したときに始まる（前面にいるときなので Android 14 の制限にかからない）。
- 通知は `MediaSession` と `Notification.MediaStyle`（Android 標準。androidx.media を足さない）で作る。Android 13 以降のメディア操作は `PlaybackState` の操作と独自の操作（15 秒戻る・30 秒進む）から作られる【仮説: 実機で表示を確認する】。
- 通知の文言（操作の名前・チャンネル名）は UI 層から `ServiceLabels.nowPlaying` で渡す（ネイティブは文言を持たない。録音の通知と同じ）。

### 10.4 未検証（実機で確かめる）

- iPhone / Pixel 9a で: 他アプリの音楽を鳴らしたまま再生 → 他アプリが止まる / 再生中の着信 → 止まり、通話後に再開する / 再生中にイヤホン・Bluetooth を外す → 止まり、スピーカーから鳴らない / 録音直後の再生 → 出力先・音量が録音前と同じ / 画面を消したあとも再生が続く（10 分以上。§10.5）/ 録音中のジングルのモニターが鳴り終わっても録音が続く。
- ロック画面・通知（§10.5）: 題・番組名・アートワークの表示、各操作、アプリ内との一致、録音を始めると消えること、10 分以上の継続、Android の通知の「止めて閉じる」、ヘッドホンの再生ボタン。
- iOS の `mediaServicesWereResetNotification`（音声デーモンの再起動）での再生の立て直しは扱っていない（録音側は §4）。

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
