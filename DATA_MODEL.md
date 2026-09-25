# DATA_MODEL.md — PodsNow データモデル

> 凡例: **【事実】** 対話で決定した仕様 / **【確認済み】** 公式ドキュメント等で確認済み（出典付き） / **【仮説】** 未検証・要スパイク

## 1. 方針

- 永続化は **SQLite（expo-sqlite、WAL モード）** と **端末ファイルシステム（expo-file-system）**。【事実】
- SQLite が「唯一の真実」。メモリ上の状態は SQLite から再構築できる。
- 音声ファイルは DB に入れず、DB は **パス（アプリルートからの相対）** と **メタ情報** だけを持つ。
- すべての主要テーブルに `id TEXT PRIMARY KEY`（UUID v4）、`created_at`、`updated_at`、論理削除用 `deleted_at` を持たせる（将来の同期用）。【事実】
- 時間は **サンプル数（整数、48 kHz 基準）** を第一候補【仮説】。列名は `*_smp`。UI では ms に変換。
- 移行は `PRAGMA user_version` で管理【確認済み】(https://docs.expo.dev/versions/latest/sdk/sqlite/)。

## 2. ファイルレイアウト

`Paths.document`（【確認済み】システムに削除されない領域）配下:

```
podsnow/
├── db/podsnow.db                       # SQLite (+ -wal, -shm)
├── shows/<showId>/
│   ├── cover.jpg
│   └── assets/<assetId>.wav            # 取り込み時に 48k WAV へ変換したもの【仮説】
│   └── assets/<assetId>.peaks          # 波形キャッシュ
├── episodes/<episodeId>/
│   ├── takes/<takeId>/
│   │   ├── seg-0001.wav                # Segment（連続録音の単位）
│   │   ├── seg-0002.wav
│   │   └── seg-0001.peaks
│   ├── exports/<exportId>.m4a|.wav
│   └── backup-staging/                 # バックアップ作成時の一時領域
└── tmp/                                # 取り込み・レンダリングの中間ファイル（起動時に掃除）
```

- Segment は 1 つの連続録音。一時停止ではファイルを分けず、割り込み・エラー・ルート変更（設定次第）で分ける（AUDIO_DESIGN.md §4）。
- `.peaks`: 独自のバイナリ（ヘッダ + `Int8` の min/max ペア列、既定 100 サンプル/秒）【仮説】。
- バックアップ `.podsnow` は zip（`manifest.json` + `episode.json` + `takes/**`、`assets/**` は参照 ID のみ、または同梱を選択）。

## 3. ER 図

```
shows 1──* episodes 1──* takes 1──* take_segments
  │            │            │
  │            ├──* voice_segments (EDL: take_id + src range)
  │            ├──* overlay_clips ──▶ assets
  │            ├──* recording_events
  │            ├──* outline_items
  │            ├──* edit_ops
  │            ├──* exports
  │            └──* transcripts (将来) ──▶ takes
  ├──* assets
  ├──* show_categories / show_funding / show_external_ids (RSS の番組情報)
  ├──* feed_episodes (RSS から取り込んだ配信済みの回) ··▶ episodes
  ├──1 description_templates
  ├──* show_topic_template (トークテーマのひな形)
  └──1 show_layout (既定構成)
app_settings (key-value)
recovery_journal
```

## 4. テーブル定義

型は SQLite の親和型で記載。`PK` = 主キー、`FK` = 外部キー。

### 4.1 `shows`
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | 番組名 |
| description | TEXT | 番組概要 |
| author | TEXT | |
| cover_path | TEXT | 相対パス |
| default_season | INTEGER | 新規エピソードの既定シーズン |
| default_export_preset | TEXT | JSON |
| website_url | TEXT NOT NULL DEFAULT '' | `link` |
| language | TEXT NOT NULL DEFAULT '' | `language`（ISO 639。小文字。空 = 未設定） |
| explicit | INTEGER NOT NULL DEFAULT 0 | `itunes:explicit`（0 / 1） |
| show_type | TEXT NOT NULL DEFAULT 'episodic' | `itunes:type`。`episodic` / `serial` |
| copyright | TEXT NOT NULL DEFAULT '' | `copyright` |
| owner_name / owner_email | TEXT NOT NULL DEFAULT '' | `itunes:owner` の `itunes:name` / `itunes:email` |
| complete | INTEGER NOT NULL DEFAULT 0 | `itunes:complete`（yes = 1） |
| feed_url | TEXT nullable | RSS の URL（`atom:link rel="self"`、無ければ取得に使った URL）。自分で始めた番組は NULL |
| podcast_guid | TEXT nullable | `podcast:guid`（UUIDv5） |
| cover_source_url | TEXT nullable | `itunes:image@href`。取得元の記録で、表示と書き出しは `cover_path` を使う |
| feed_imported_at | INTEGER nullable | 最後に RSS から取り込んだ時刻 |
| created_at / updated_at / deleted_at | INTEGER | Unix ms |

MVP は起動時に 1 行自動作成。【事実】

`website_url` から `feed_imported_at` までは 0004 で追加した（REQUIREMENTS.md FR-SHOW-3a）。
値の範囲は Podcast Standards Project の PSP-1 に従う
【確認済み】(https://github.com/Podcast-Standards-Project/PSP-1-Podcast-RSS-Specification)。
取り込んだ値の正規化（`true` / `yes` / `clean` などの揺れ）は `src/domain/podcast/feed.ts` が持つ。

`podcast:locked`（ホスティング事業者の乗り換え可否）、`podcast:person`、`podcast:txt`、`itunes:block` は持たない。
PodsNow は RSS を配信しないので、今は使い道がない。RSS を配信することになったら列を足す。【事実】

### 4.1.1 `show_categories`（`itunes:category`）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| show_id | TEXT FK | |
| position | INTEGER | 0 が主カテゴリー |
| category | TEXT | Apple の分類名（英語の `text` 属性値、例 `Society & Culture`）。表示名は UI 層で訳す |
| subcategory | TEXT NOT NULL DEFAULT '' | 入れ子の `itunes:category`。無ければ空 |

### 4.1.2 `show_funding`（`podcast:funding`）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| show_id | TEXT FK | |
| position | INTEGER | |
| url | TEXT | `url` 属性 |
| label | TEXT NOT NULL DEFAULT '' | 要素の本文（リンクの説明） |

### 4.1.3 `show_external_ids`（外部サービスの番組 ID）
| 列 | 型 | 説明 |
|---|---|---|
| show_id | TEXT FK | 主キー（`show_id`, `provider`） |
| provider | TEXT | `apple_podcasts`（iTunes Search API の `collectionId`） / `podcast_index` |
| external_id | TEXT | |
| updated_at | INTEGER | |

外部の ID を `shows.id` に使わない。検索元を増やしても PodsNow の ID は変わらない（Issue #101 §9）。

カテゴリー・支援リンク・外部 ID は「番組の子の並び」で、`show_topic_template` と同じく `created_at` / `deleted_at` を持たない。
置き換えは丸ごと（`replaceCategories` / `replaceFunding`）。

話数の採番用カウンター列は持たない。台帳は `episodes` の行そのもので、新規作成時は
`SELECT COALESCE(MAX(episode_number), 0) + 1 FROM episodes WHERE show_id = ? AND deleted_at IS NULL`
で導出する（REQUIREMENTS.md §2.1.1 / FR-EP-6）。【事実】

理由: カウンターは `episodes` と二重の真実になるうえ、**ストレージクリアやクリーンインストールで失われたとき復元する手段がない**。
導出なら状態を持たないので壊れる状態も存在せず、`.podsnow` を復元した時点で台帳が再構築される（§7）。

### 4.2 `show_layout`（既定構成）
| 列 | 型 | 説明 |
|---|---|---|
| show_id | TEXT PK FK | |
| opening_asset_id | TEXT FK nullable | |
| ending_asset_id | TEXT FK nullable | |
| bgm_asset_id | TEXT FK nullable | |
| bgm_gain_db | REAL | 既定 -14 |
| bgm_duck_db | REAL | 既定 -10（声がある区間での追加減衰） |
| opening_gain_db / ending_gain_db | REAL | |

新規エピソード作成時、この行から `overlay_clips` を生成する。MVP は 1 種類のみ【事実】。将来 `episode_templates` テーブルに一般化。

### 4.2.1 `show_topic_template`（トークテーマのひな形）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| show_id | TEXT FK | |
| position | INTEGER | 並び順 |
| heading | TEXT | 見出し |
| body | TEXT NOT NULL DEFAULT '' | 台本の下書き（空でよい） |

新規エピソード作成時、この並びから `outline_items` を生成する（FR-SHOW-4）。
生成後はエピソードのデータなので、ひな形を変えても既存エピソードは書き換えない（`ServiceLabels` と同じ考え方）。

### 4.3 `description_templates`
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| show_id | TEXT FK | |
| body | TEXT | ベーステンプレート本文。プレースホルダ `{{title}}` `{{episode_number}}` `{{season}}` `{{topics}}` `{{show_name}}` を許可【事実: 決まり文句の適用が主目的。展開は最小限】 |
| is_default | INTEGER | |

### 4.4 `assets`（Show Assets）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| show_id | TEXT FK | |
| kind | TEXT | `opening` / `ending` / `jingle` / `sfx` / `bgm` |
| name | TEXT | |
| path | TEXT | 内部 WAV の相対パス |
| original_filename | TEXT | 取り込み元名 |
| duration_smp | INTEGER | |
| sample_rate | INTEGER | 48000 固定（取り込み時に変換）【仮説】 |
| channels | INTEGER | |
| peaks_path | TEXT | |
| default_gain_db | REAL | |
| is_favorite | INTEGER | Quick Insert 先頭 |
| sort_order | INTEGER | |
| created_at / updated_at / deleted_at | INTEGER | |

### 4.5 `episodes`
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| show_id | TEXT FK | |
| title | TEXT | |
| description | TEXT | 編集済み本文 |
| description_suggestion | TEXT nullable | 将来 AI の下書き候補（提案 → 採用/破棄）【事実: 接続点】 |
| episode_number | INTEGER | |
| season | INTEGER | |
| recorded_at | INTEGER | |
| publish_planned_at | INTEGER nullable | |
| status | TEXT | `draft` / `ready` / `exported`（自動判定。DB にはキャッシュとして保存） |
| last_opened_at | INTEGER | Home の「続き」判定 |
| playhead_smp | INTEGER | 最後の再生位置 |
| undo_cursor | INTEGER | `edit_ops.seq` の現在位置（0 = 履歴なし）。§4.12 |
| sound_settings | TEXT | JSON: `{ loudness: { enabled, targetLufs: -16, truePeakDbtp: -1 }, ducking: { enabled, depthDb, attackMs, releaseMs } }` |
| audio_purged_at | INTEGER nullable | 「音声を削除」（FR-EP-4）を実行した時刻。録音だけ消し、行・話数・メタデータ・書き出し履歴は残す。一覧では「音声なし」として表示する |
| guid | TEXT | RSS の `guid`。作成時の `id` を入れ、以後変えない（PSP-1: 一意で、決して変えない）。0004 で既存行にも `id` を入れた。索引 `(show_id, guid)` |
| episode_type | TEXT NOT NULL DEFAULT 'full' | `itunes:episodeType`。`full` / `trailer` / `bonus` |
| explicit | INTEGER nullable | `itunes:explicit`（0 / 1）。NULL は番組の `explicit` に従う |
| website_url | TEXT NOT NULL DEFAULT '' | `link` |
| published_at | INTEGER nullable | 実際に配信した日時（`pubDate`）。予定は `publish_planned_at` |
| created_at / updated_at / deleted_at | INTEGER | |

### 4.6 `takes`
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| episode_id | TEXT FK | |
| name | TEXT | 「録音 3」など |
| status | TEXT | `recording` / `ready` / `orphaned`（復旧待ち） / `recovered` / `failed` |
| sample_rate | INTEGER | |
| channels | INTEGER | |
| bit_depth | INTEGER | 16 |
| input_label | TEXT | 録音時の入力デバイス名 |
| started_at | INTEGER | |
| ended_at | INTEGER nullable | |
| duration_smp | INTEGER | 全 Segment の合計（確定後） |
| created_at / updated_at / deleted_at | INTEGER | |

### 4.7 `take_segments`
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| take_id | TEXT FK | |
| seq | INTEGER | 1 から |
| path | TEXT | `seg-0001.wav` |
| offset_smp | INTEGER | Take 内の開始位置（= 先行 Segment の合計） |
| duration_smp | INTEGER | 確定後に確定。録音中は NULL |
| header_valid | INTEGER | 0 = 復旧が必要（ヘッダ未確定） |
| reason_closed | TEXT | `stop` / `interruption` / `route_change` / `error` / `disk_low` / `crash_recovered` |
| peaks_path | TEXT nullable | |

Take の「時間軸」は Segment を `seq` 順に連結したもの。割り込みで欠落した時間は Take 上に存在しない（連結する）。欠落位置には自動マーカー（§4.10）を打つ。

### 4.8 `voice_segments`（声トラックの EDL）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| episode_id | TEXT FK | |
| position | INTEGER | 並び順（0 起点。連続値でなくてよい。疎な整数） |
| take_id | TEXT FK | |
| src_start_smp | INTEGER | Take 内の開始 |
| src_end_smp | INTEGER | Take 内の終了（排他） |
| gain_db | REAL | 既定 0 |
| fade_in_smp / fade_out_smp | INTEGER | 既定 0 |
| updated_at | INTEGER | |

- 声トラック上の時刻は `position` 順に長さを累積して求める（`domain/timeline`）。
- 範囲削除 = 対象 `voice_segments` の分割・削除。Take ファイルは触らない。【事実: 非破壊】
- 録音停止時に `[0, duration)` を指す 1 行を末尾（または再生位置に差し込み）に追加する。この追加は取り消しの履歴に 1 つの操作として積む（§4.12）。
- **不変条件（重要）**: 同一 Take の同一ソース範囲は声トラック上に **高々 1 回** しか現れない（範囲同士が重ならない）。マーカー（§4.10）と `source` アンカーのオーバーレイ（§4.9）は `(take_id, src_smp)` → 声トラック上の位置 1 点 に解決される前提で設計されている。MVP の編集操作（範囲削除 / 位置を選んだ差し込み / 無音カット）はこの不変条件を保つ。将来「声クリップの複製」を追加する場合は、`resolveTimeline` が複数位置を返せるように変更し、マーカー・オーバーレイの解決規則を決め直す必要がある。

### 4.9 `overlay_clips`（素材レイヤー）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| episode_id | TEXT FK | |
| asset_id | TEXT FK | |
| kind | TEXT | asset.kind のコピー（レイヤー分類用） |
| anchor_type | TEXT | `source` / `timeline_start` / `timeline_end` / `timeline_abs` |
| anchor_take_id | TEXT FK nullable | `source` のとき |
| anchor_smp | INTEGER | `source`: Take 内位置 / `timeline_abs`: 声トラック上の位置 / start,end: オフセット |
| src_start_smp / src_end_smp | INTEGER | 素材内の使用範囲（トリム） |
| gain_db | REAL | |
| fade_in_smp / fade_out_smp | INTEGER | |
| duck | INTEGER | BGM 等、声のある区間で減衰させるか |
| loop | INTEGER | BGM を末尾まで繰り返すか |
| end_mode | TEXT | `asset_end` / `timeline_end` / `fixed`（BGM 用） |
| updated_at | INTEGER | |

アンカー設計【仮説】:
- 収録中のジングル挿入は `anchor_type='source'`（Take 内の時刻）。**声を前でカットしてもジングルは同じ発言位置に追従する**。アンカー位置自体がカットされた場合は「孤立」として警告し、最寄りの生きている位置へ移動を提案。
- Opening は `timeline_start`、Ending は `timeline_end`（オフセット付き）。声の総尺が変わっても自動追従。
- 後から手で配置した素材は `timeline_abs`（絶対位置）だが、UI で「発言に追従」に切り替え可。

### 4.10 `recording_events`（録音中の出来事）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| episode_id | TEXT FK | |
| take_id | TEXT FK | Take の時刻に紐づく（カットに追従） |
| src_smp | INTEGER | |
| label | TEXT | 表示用の補足（デバイス名など。文言は UI 層が作る） |
| kind | TEXT | `interruption` / `route_change` / `disk_low`。**すべてアプリが自動で記録する** |
| created_at | INTEGER | |

**ユーザーが打つマーカーは持たない【事実】。** 旧 `markers` の `edit_point` / `mistake` は廃止し、
収録タブの塊の選択と削除（FR-EDIT-2）、位置を選んだ録音（FR-REC-1）で置き換える（「言い直す」も #122 で廃止）。
旧 `topic` は `outline_items.recorded_take_id / recorded_src_smp`（§4.11）に吸収した。

理由: マーカーは押した時点では何も解決せず、あとで「戻る → 次へ → 範囲選択 → 削除」の作業が残る。
ユーザーが本当に指したいのは「捨てる範囲」であり、「あとで見る場所」ではない（`docs/ux-restructure.md` §1.3）。

### 4.11 `outline_items`（トークテーマと台本）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| episode_id | TEXT FK | |
| position | INTEGER | 並び順 |
| heading | TEXT | 見出し（トークテーマ）。必須 |
| body | TEXT NOT NULL DEFAULT '' | 台本本文。**空なら見出しだけの項目**。台本かどうかを表す列は持たない |
| recorded_take_id | TEXT FK nullable | 録音中にこの項目へ進んだ位置 = チャプターの始まり |
| recorded_src_smp | INTEGER nullable | 同上（Take 内の時刻。カットに追従する） |
| done_at | INTEGER nullable | 話し終えた時刻 |

**「収録スタイル」を表す列は `episodes` にも置かない【事実】。**
台本を書けば `body` が埋まり、書かなければ見出しだけになり、何も書かなければ項目が 0 件になる。
モードを持たせると、ユーザーに「選ぶ前に選択肢の意味を理解させる」ことになる（REQUIREMENTS.md §2.2.1）。

概要欄の `{{topics}}` には `heading` を箇条書きとして差し込む。将来の文字起こし（§4.14）は
チャプター単位のテキストとしてここにぶら下がり、要約・概要の下書きの入力になる。【事実】

旧 `topics` からの移行: `text → heading`、`checked_at → done_at`、
`checked_take_id / checked_src_smp → recorded_take_id / recorded_src_smp`、`body` は空文字で追加。

### 4.12 `edit_ops`（編集履歴 / Undo）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| episode_id | TEXT FK | |
| seq | INTEGER | 単調増加 |
| label | TEXT | 「範囲を削除」など |
| op | TEXT | JSON。`{ before, after }`。声の並びと重ねた素材（`EditableDoc`）の操作前後のスナップショット |
| group_key | TEXT nullable | 連続操作のまとめ（スライダー） |
| created_at | INTEGER | |

`episodes.undo_cursor` に「適用済みの最後の op の seq」を持つ（0 = なし）。Undo = cursor を 1 つ戻し `before` を書き戻す、Redo = `after` を書き戻す。新規操作で cursor より後の行を削除する。上限は既定 200 件【仮説】。

【事実】スナップショットにする理由: 逆操作の実装ミスで録音データの参照が壊れるのを避ける（エピソードのセグメント数は高々数百で、JSON にしても小さい）。
その代わり、**声の並びと素材を書き換える処理は、すべてこの履歴を通す**。履歴の外で書くと、古い `before` を書き戻したときにその変更が消える（Issue #122 で、録音の追加が履歴の外にあり、録音後に取り消すとテイクが外れた）。

- **履歴の寿命**: エピソード画面を開いたときと抜けたときに空にする（FR-EDIT-7）。再起動をまたいで持たない。doc（声の並びと素材）は常に保存済み（FR-SAFE-8）。
- **対象**: `voice_segments`、`overlay_clips`。
- **録音の追加**: 停止時に、録音を始めたときの doc を `before`、テイクを足した doc を `after` として積む（Take の確定と同じトランザクション）。録音中に重ねた素材も `after` に含まれ、取り消せばテイクと一緒に外れる。Take の行と録音ファイルは消さない（FR-SAFE-7）。
- **対象外**: `outline_items`（削除の確認で守る、FR-UI-2）、`episodes.sound_settings`、`recording_events`（アプリが記録した事実）、Take の行そのもの（削除は論理削除 + ゴミ箱）。
- 復旧（`RecoveryService`）が足すテイクは履歴に積まない。復旧は起動時に走り、次に画面を開いた時点で履歴は空から始まる。

### 4.13 `exports`
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| episode_id | TEXT FK | |
| format | TEXT | `m4a` / `wav`（将来 `mp3` / `flac`） |
| preset | TEXT | JSON（bitrate, channels, sampleRate, loudness） |
| status | TEXT | `queued` / `rendering` / `encoding` / `done` / `failed` / `cancelled` |
| progress | REAL | |
| path | TEXT nullable | |
| bytes | INTEGER nullable | |
| duration_smp | INTEGER | |
| measured_lufs / measured_true_peak | REAL nullable | **書き出したファイル（出力）**の統合ラウドネス（LUFS）とトゥルーピーク（dBTP）。`preset.loudness` が無い古い行は調整前の値なので表示しない |
| error | TEXT nullable | |
| created_at / finished_at | INTEGER | |

### 4.14 `transcripts`（将来。MVP はスキーマのみ）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| take_id | TEXT FK | |
| provider | TEXT | `os_speech` / `local_llm` / … |
| language | TEXT | |
| segments | TEXT | JSON `[{ startSmp, endSmp, text, confidence }]` |
| created_at | INTEGER | |

### 4.15 `recovery_journal`
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| take_id | TEXT FK | |
| segment_id | TEXT FK | |
| state | TEXT | `open` / `closed` |
| last_heartbeat_at | INTEGER | 録音中に 1 秒ごと更新【仮説: 間隔】 |
| last_known_bytes | INTEGER | ネイティブが報告した書き込み済みバイト数 |

起動時に `state='open'` の行があれば復旧フロー（§6）へ。

### 4.17 `feed_episodes`（RSS から取り込んだ配信済みの回）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | |
| show_id | TEXT FK | |
| guid | TEXT | item の `guid`。`(show_id, guid)` で一意。`guid` の無い item は取り込まない |
| title | TEXT | |
| description | TEXT | 本文（HTML を含みうる。表示時に扱う。REQUIREMENTS.md NFR-10） |
| published_at | INTEGER nullable | `pubDate`（Unix ms） |
| enclosure_url / enclosure_length / enclosure_type | TEXT / INTEGER / TEXT nullable | `enclosure` の `url` / `length`（バイト）/ `type` |
| duration_smp | INTEGER nullable | `itunes:duration`。秒・`HH:MM:SS` どちらもサンプル数に直す（§1） |
| episode_number / season | INTEGER nullable | `itunes:episode` / `itunes:season`（0 でない整数のみ） |
| episode_type | TEXT NOT NULL DEFAULT 'full' | `itunes:episodeType` |
| explicit | INTEGER nullable | NULL は番組に従う |
| website_url | TEXT NOT NULL DEFAULT '' | `link` |
| image_url | TEXT nullable | `itunes:image@href` |
| episode_id | TEXT FK nullable | PodsNow で作った回との対応 |
| created_at / updated_at | INTEGER | |

`episodes` とは分ける。`episodes` は「PodsNow で作っている回（録音と編集の作業場所）」で、
配信済みの回を入れると音声の無い行がホームの一覧と「続き」に混ざる。【事実】

- 再取り込みは `guid` で突き合わせて上書きし、`id` / `episode_id` / `created_at` は残す。
- フィードから消えた行は消さない。最新 N 件しか RSS に載せないホスティングがあるため。
- 音声（`enclosure`）はダウンロードしない。
- 話数の採番（§4.1）は今のところ `episodes` だけから導出する。取り込んだ回の最大話数を初期値に使うかは未決【仮説】（REQUIREMENTS.md U-7）。

### 4.16 `app_settings`
`expo-sqlite/kv-store`（【確認済み】AsyncStorage 互換の KV）を使う案と、専用テーブル `app_settings(key TEXT PK, value TEXT)` の案がある。型安全性のため専用テーブル + Zod スキーマ【仮説】。

キー例: `theme`, `recording.sampleRate`, `recording.channels`, `recording.preferredInput`, `silence.minDurationMs`, `silence.thresholdDb`, `silence.autoApply`, `haptics`, `export.defaultPreset`（`podcast` / `high` / `wav` / `custom`）, `export.custom`（`{ format: m4a|wav, bitrate, channels: 1|2 }`。サンプルレートは 48 kHz 固定）, `interruption.autoResume`, `monitor.jinglePlayback`（`always` / `headphonesOnly` / `never`）。

## 5. タイムラインのセマンティクス（domain/timeline）

```ts
type VoiceSegment = { id; takeId; srcStart; srcEnd; gainDb; fadeIn; fadeOut };
type Timeline = { voice: VoiceSegment[] /* position 順 */; overlays: OverlayClip[]; };

// 声トラック上の位置 → (takeId, srcSmp)
resolveSource(timeline, tlSmp): { takeId, srcSmp } | null
// (takeId, srcSmp) → 声トラック上の位置（カットされていれば null）
resolveTimeline(timeline, takeId, srcSmp): number | null
// 範囲削除: [a, b) を削除し、影響する VoiceSegment を分割・除去
deleteRange(timeline, a, b): { next: Timeline; op: EditOp }
// 無音カット計画: detectSilence の結果 → 削除範囲リスト（前後に残す余白付き）
planSilenceRemoval(ranges, { padMs }): Range[]
```

これらは純粋関数で、Jest で網羅テストする。`RenderDocument`（ネイティブへ渡す JSON）は `Timeline` + ファイルパス + Sound 設定から生成する。

## 6. 復旧フロー（起動時）

1. `recovery_journal.state='open'` を検索。
2. 各 Segment について、ファイル実長からデータ長を計算し、WAV ヘッダを書き直す（ネイティブ `repairWavHeader(path)`）。
3. `take_segments.duration_smp` を確定、`header_valid=1`、`reason_closed='crash_recovered'`。
4. `takes.status='recovered'` にし、`voice_segments` 末尾に追加（未追加なら）。
5. ユーザーへ「未確定の録音を復元しました（n 分 m 秒）」を表示し、該当 Take を Editor で開く。
6. `recovery_journal` を `closed` に。

## 7. バックアップ形式 `.podsnow`【仮説】

```
manifest.json     { formatVersion: 1, app: "podsnow", createdAt, episodeId, showId }
episode.json      episodes / takes / take_segments / voice_segments / overlay_clips / recording_events / outline_items / exports(メタのみ) の行を JSON で
takes/<takeId>/seg-0001.wav ...
assets/<assetId>.wav  (オプション。既定は同梱)
```
復元時、ID が衝突する場合は新 UUID を採番して参照を張り替える。

`episodes.guid` は引き継ぐ（配信済みの回を指す値なので）。同じ番組に同じ `guid` の回が残っている場合
（同じバックアップを 2 回復元した等）だけ、新しい id を `guid` に使う。0004 より前のバックアップには `guid` が無いので、新しい id を使う。

**話数は `episode.json` の `episode_number` をそのまま使う**（振り直さない）。同じ Show に同じ話数が既にある場合のみ
§4.1 の式で MAX+1 に振り直し、その旨をユーザーに伝える。【事実: FR-EP-6】

理由: `.podsnow` は「その回の保存」なので、復元で第 5 回が第 8 回になるのは意図に反する。
また、ストレージクリア後に話数の台帳を再構築できるのはこの性質があるからで、振り直すと
カウンターを廃止した意味が失われる（§4.1）。

## 8. 移行戦略
- `PRAGMA user_version` を 1 から開始。`src/infra/db/migrations/0001_init.sql` … を順に適用。
- Drizzle 採用時は drizzle-kit の生成 SQL をそのまま使う【仮説】。
- 破壊的変更は必ず「新列追加 → データ移送 → 旧列放置」の順。DB ファイル自体のバックアップを移行前に `db/podsnow.db.bak-<version>` として残す。

## 9. ストレージ見積り
- 48 kHz / 16 bit / mono = 96 KB/s ≈ 5.8 MB/分 ≈ **345 MB/時間**。ステレオは 2 倍。
- 録音開始時の必要空き容量チェック: `Paths.availableDiskSpace`【確認済み】 ≥ (想定 60 分 × レート) + 200 MB 余裕。不足時は分数を示して警告。
- 録音中の監視: 残り 5 分相当（≈ 30 MB）を下回ったら `diskLow` → 安全停止。【仮説: しきい値】
