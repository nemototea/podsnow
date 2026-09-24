# docs/design-refresh — デザイン刷新の統合記録（Issue #94）

> 凡例: **【事実】** このリポジトリで確認・実施したこと / **【確認済み】** 公式ドキュメント等で確認済み（出典付き） / **【仮説】** 未検証

設計成果物（受け渡しパッケージ `PodsNow-Design`、2026-09-22 作成）をネイティブアプリへ統合した作業の記録。
仕様そのものは `DESIGN_SYSTEM.md` が正。ここには「なぜそうしたか」と「何を確かめ、何を確かめていないか」を残す。

## 1. 状態【事実】

| 区分 | 状態 |
|---|---|
| 実装 | 完了。色・書体・ロゴ・共通部品・主要画面・補助画面を新しいデザインに統一した |
| 自動検証 | lint / typecheck / Jest（267 件）/ format:check / 色の再生成（246 組）/ ブランドの再生成 が通る（§6.1） |
| 画面検証 | react-native-web による Web 描画で、日英・Dark/Light・幅 320 / 390 / 430 の実操作フローを撮影した（§6.2）。**ネイティブ描画ではない** |
| 実機検証 | **未実施**。この作業環境には iOS シミュレータ・Android エミュレータ・実機が無い。手順は `docs/device-checklist.md` の K / DS |
| リリース可否 | 実機検証（特に DS-1〜DS-3、K-1〜K-3）が済むまでリリース可能とは言わない |

## 2. 基点【事実】

- 設計の基点: `b59f9ba`（#92 マージ時点）。
- 統合の基点: `release/0.1.0` の `110d805`（#93 マージ後）。設計の後に #93（3 タブ化、マーカー廃止、
  `outline_items` / `recording_events`、エピソードトップ・詳細・音・書き出し画面の統合）が入っている。
- 設計時点へ巻き戻すことはしていない。#93 の成果はすべて維持した。

## 3. 設計と現行仕様の食い違いと、その扱い【事実】

優先関係（ユーザー指示 → 既存の機能・データ契約 → 設計の外観仕様 → 画面例）に従い、機能と IA は #93 を正とし、
外観と部品を設計に合わせた。

| 設計 | 現行（#93）| 扱い | 理由 |
|---|---|---|---|
| 収録 / 編集 の 2 モード | 録音 / 編集 / 書き出し の 3 タブ | 3 タブのまま、Segmented を設計の見た目（選択の下線・面）にした。#96 で下線はやめ、面と輪郭に変えた（§9） | FR-EP-5、docs/ux-restructure.md §3 |
| 「マーカーを打つ」 | マーカーは廃止し「言い直す」 | 収録操作バーに「言い直す」を置いた | #93 でデータモデルから外れている（DATA_MODEL §4.10）。マーカーを戻すとデータ契約が変わる |
| 04 音の仕上げ / 05 詳細 / 06 書き出し の別画面 | 書き出しタブのセクション | 書き出しタブ内に「音の仕上げ」「エピソードの詳細」「書き出し」「履歴」を順に置いた | #93 で 4 画面を畳んだ |
| エピソードトップ画面（§8.2） | 廃止済み | 作らない | #93 |
| Home の下部タブバー（エピソード / 番組 / 設定） | Home 内の導線 | タブバーは入れず、ヘッダーに設定、本文末尾に「番組と素材」「復元」 | ルートを増やさない（設計 README §5「ルートや状態管理を不要に再構築しない」） |
| 編集の下部 CTA「音を仕上げる」 | 同じ画面のタブ | 「書き出しへ進む」（タブ切替）にした | 音の仕上げは書き出しタブにある |
| トークテーマのチェックボックス | 「次へ」で進む（進んだ位置がチャプター） | チェックの見た目で話し終えた項目を示し、操作は「次へ：〇〇」ボタン | FR-OUT-4。チェックを独立に付け外しするとチャプターの意味が変わる |
| サンプルの番組名・EP 014・テイク 03・ファイル名 | 実データ | すべて実データから表示。架空の初期データは入れていない | 設計 README §5 |
| 「約 3 時間録音できます」 | 空き容量の実測（`checkDiskSpace`） | 実測から 16 bit PCM の実レートで概算し「概算」と明記。取れなければ「確認できません」 | 設計 §8.3 |

## 4. 工程と主な変更ファイル【事実】

| 工程 | 変更 |
|---|---|
| A. 文書 | `DESIGN_SYSTEM.md`（全面）、`PRODUCT.md` §3、`DEVELOPMENT.md` §4.5、`assets/brand/README.md`、`assets/fonts/README.md`、`docs/device-checklist.md`（K 改訂、DS 追加）、`docs/store-listing.md` |
| B. 色 | `scripts/design/ramps.py`（新パレット。面と塗りは OKLCh 決め打ち、文字と境界は目標比から逆算）、`generate.py`（246 組の検査、voice ≠ success、色相 30°）、`src/ui/tokens/colors.ts`（生成物）、`tones.ts`（rec / success）、`tokens.test.ts` |
| B. 書体 | `scripts/fonts/generate.py`、`assets/fonts/*.ttf` と OFL、`app.json`（expo-font plugin）、`src/ui/Text.tsx`、`src/ui/fonts.ts`、`src/ui/tokens/scale.ts`、ESLint（RN の Text 直使用を禁止） |
| B. ロゴ | `scripts/brand/geometry.py`・`glyphs.py`・`extract_glyphs.py`・`render.py`（多角形の塗り）・`generate.py`、`assets/brand/*.svg`、`assets/images/*.png`、`src/ui/brand/wordmark.ts`、`src/ui/Wordmark.tsx`、`app.json`（スプラッシュ・アダプティブ背景） |
| C. 共通部品 | `src/ui/components.tsx`（Screen / Header / IconButton / Button / Row / Field / Segmented / Chip / Sheet / Toast / Notice / ProgressBar）、`src/ui/Icon.tsx`、`src/ui/useToast.ts` |
| D. 主要画面 | `src/app/index.tsx`、`src/app/episode/[id]/index.tsx`、`src/features/episode/{RecordTab,EditTab,ExportTab,Transport,LevelMeter,Waveform}.tsx`、`useRecordingContext.ts`、`selectionInput.ts`、`src/app/episode/[id]/share.tsx` |
| E. 補助画面 | `src/app/show/index.tsx`、`src/features/show/AssetsSection.tsx`、`src/app/settings.tsx`、`src/app/episode/[id]/backup.tsx`、`src/app/restore.tsx` |
| 文言 | `src/i18n/ja.ts`・`en.ts`（追加と、見出しに変わった英語の大文字表記の是正） |
| ロジック（最小） | `src/domain/time.ts`（`formatClock`）、`src/domain/storage.ts`（録音可能時間の概算）、`EditingService.undoTopId`、`useWorkspace`（`undoTopId` の受け渡し） |

録音サービス、WAV writer、復旧、SQLite スキーマ、EDL、`voice_segments` の編集ロジック、サンプル時間の
計算は変更していない（data-safety の変更なし）。

### 4.1 実装中に見つけて直した既存の不具合【事実】

| 不具合 | 直し方 | 確認 |
|---|---|---|
| 編集タブで声の塊をタップしても選択されない。波形の上に `onPress` の無い透明な `Pressable` が区間ごとに重なり、タップを奪っていた | 区間の枠を `pointerEvents="none"` の View にした | Web 描画で選択できることを確認。実機は DS-8 |
| マイク権限をどこからも要求していなかった（`requestPermissions` の呼び出しが無い）。Android では初回の録音開始が失敗しうる | 録音開始前に `getPermissions` を見て、未決定なら説明シート → 要求、拒否なら「設定を開く」 | Web 描画で分岐の表示を確認。OS の挙動は DS-7 |
| 波形のタップ位置が数値でない場合に `smp()` が例外を投げる | 数値でなければ何もしない | Web 描画で例外が出なくなった |
| 「取り消す」付きの通知が、その後の別の編集を取り消しうる | 通知を出した操作が履歴の先頭にあるときだけ取り消し、先頭が変わったら通知を閉じる | `EditingService` のテスト、Web 描画 |

## 5. 色・書体・ロゴの生成と再現【事実】

- 色: `python3 scripts/design/generate.py`。設計値との差は sRGB の 1 段が 6 値（`DESIGN_SYSTEM.md` §5.4）。
- 書体: `python3 scripts/fonts/generate.py`（fontTools）。同じ原本から 2 回生成してバイト一致を確認した（タイムスタンプを固定）。
- ロゴ: `python3 scripts/brand/generate.py`（標準ライブラリ）。2 回生成してすべての PNG / SVG がバイト一致。
  受け渡しパッケージの SVG と Chromium で描画して比べた差（しきい値を超える画素の割合）:

| ファイル | 差 |
|---|---|
| `app-icon.svg` | 0.011% |
| `wordmark-dark.svg` | 0.097% |
| `wordmark-light.svg` | 0.006% |
| `android-foreground.svg` / `android-monochrome.svg` / `icon-small.svg` | 0% |

  生成した PNG と SVG の差: `icon.png` 0.13%、`android-icon-foreground.png` 0.03%（アンチエイリアスの違い）。
- 前景の最大描画半径 311px（Android の安全域 338px 以内）。

## 6. 検証

### 6.1 自動検証【事実】

実行環境: Linux（クラウドコンテナ）、Node 22.22.2、npm 10.9.7、Python 3.11.15。

| コマンド | 結果 |
|---|---|
| `npm run lint` | 成功（警告 0） |
| `npm run typecheck` | 成功 |
| `npm test` | 25 スイート / 267 件 成功（着手前は 21 / 226。既存の失敗は無かった） |
| `npm run format:check` | 成功 |
| `python3 scripts/design/generate.py` | 57 トークン x 2 テーマ、246 組が基準を満たす |
| `python3 scripts/brand/generate.py` | 成功。安全域・キャンバス・`app.json` の色の検査に合格 |

追加したテストは実際のリスクに向けた: 二重停止で Take が 1 回だけ確定する、`undoTopId` が別の操作を指さない、
操作付きの通知が時間で消えない、書体が無いときに OS 書体へ退避する、等幅は同梱した太さだけを使う、
録音可能時間の概算（容量不明・しきい値・ステレオ・切り捨て）、選択範囲の数値入力（範囲外・順序）、
`formatClock` の 1 時間境界、声と完了・録音と破壊が別の色であること。

### 6.2 画面検証（Web 描画）【事実】

`scripts/web-preview/`。アプリ本体のコードを react-native-web で描画し、SQLite を sql.js、ファイルをメモリ、
録音と音声エンジンをシミュレータ（時間を 60 倍速、疑似的なピーク）に差し替える。Playwright で実際に
タップして次の流れを通し、各段階を撮影した（コンソールエラー 0）。

新規 → 録音開始 → 一時停止 → 再開 → 収録を終える → 編集 → 塊を選択 → カット → 取り消す → 書き出し →
書き出し完了 → 配信の準備 → コピー → エピソード一覧 → 設定 → 番組と素材

| 条件 | 端末相当の寸法 |
|---|---|
| 日本語 / Dark | 390 x 844 |
| 日本語 / Light | 390 x 844 |
| 英語 / Dark | 390 x 844 |
| 英語 / Light | 430 x 932 |
| 日本語 / Dark | 320 x 640 |
| 英語 / Dark | 320 x 640 |

状態: マイク未許可・拒否、Bluetooth 入力の注意、割り込み、収録中のタブ移動の抑止、書き出し失敗、
トークテーマの進行、Home の制作中カード、エピソードの操作シート。

代表的な画像は `docs/design-refresh/screens/`、参照案との並べ比較は `docs/design-refresh/comparison.png`。

**Web 描画で確かめられないもの**: iOS / Android の書体描画とメトリクス、Dynamic Type / Android の文字拡大、
safe area とホームインジケータ、キーボード、VoiceOver / TalkBack、ジェスチャ（ハンドルのドラッグ）、
ネイティブの録音・再生・書き出し、アイコンのマスク。これらは実機で確認する（`docs/device-checklist.md`）。

### 6.3 参照案との差【事実】

| 差 | 理由 |
|---|---|
| Home に下部タブバーが無い | §3。導線は設定アイコンと「番組とデータ」 |
| 収録画面の「マーカーを打つ」「ジングルを挿入」が、「言い直す」とジングル・効果音のチップ | §3 |
| 3 タブ（設計は 2 モード） | §3 |
| 編集の選択時ツールが多い（カット・試聴・録り直す・前後に素材・解除） | #93 の機能（パンチイン、選択の前後への素材挿入）を削らないため |
| 編集の下部に 5 秒戻る / 再生 / 5 秒進む（設計は波形の下） | 位置を固定した操作バーにまとめ、通知が重ならないようにするため |
| 一覧の右端が「›」ではなく「⋯」（操作メニュー） | 複製・バックアップ・音声を削除・エピソードを削除 を残すため |

## 7. OS 差・技術上の判断【事実】

| 判断 | 理由 |
|---|---|
| UI の書体はロケールで 1 つ選ぶ（日本語 → Noto Sans JP、英語 → Manrope） | React Native に Web のフォールバック列が無い。混植は OS のグリフ代替に任せる（【仮説】DS-1） |
| 書体は静的ウェイトを同梱し、`getLoadedFonts()` で有無を見て退避 | 可変軸を指定できない。書体の欠落で起動・収録を止めないため |
| Noto Sans JP 4 ウェイト（約 23 MB）を同梱 | 疑似太字を避けるため。JIS 第 1〜4 水準に絞っても 5.1 MB / ウェイトで効果が小さかった。縮める案: Android では OS の Noto Sans CJK を使う、または 500 を 400 に寄せて 3 ウェイトにする（どちらも設計判断が要る） |
| アイコンに react-native-svg 15.15.4 を追加 | 設計は線幅 2 の単一アイコンセットを求め、フォント字形の流用を禁じている。Expo SDK 57 が指定するバージョン（`expo/bundledNativeModules.json`） |
| `expo-font` を依存に明記 | config plugin を使うため（これまでは expo の推移的依存として入っていた） |
| キーボード回避は iOS だけ `KeyboardAvoidingView` の padding | Android は既定の resize に任せる【仮説: 実機で確認】 |
| 「最後の書き出しのあとに編集した」表示は入れなかった | 書き出し完了時にも `episodes.updated_at` が更新されるため、正しく判定できない。誤表示をしない |
| ロゴ生成に字形データ（`glyphs.py`）を置いた | 通常の再生成を標準ライブラリだけで行うため。字形の抽出だけ fontTools |

## 8. 懸念・残件【事実】

- **実機未検証**（§1）。特にアイコンのマスク、書体の実ウェイト、200% 文字拡大、読み上げ。
- **アプリ容量**: 書体で約 23.6 MB 増える（§7）。
- **Web 検証ハーネス**は `scripts/web-preview/` にあり、製品には含めない。依存（react-native-web、
  @expo/metro-runtime、sql.js）は `--no-save` で入れる。
- 設定の「元データを整理」とカバーアートは、従来どおり案内・未対応の表示のまま（機能を足していない）。
- セキュリティ: 新たな通信・解析・クリップボード読取は無い。共有とコピーはユーザー操作のときだけ。
  書き出しの失敗理由（ネイティブのエラーメッセージ）を画面にそのまま出す既存の挙動は残っている。
  パスなどが含まれる場合は表示に出る【仮説: ネイティブのメッセージ内容は未確認】。

## 9. 設計から外した定型（Issue #96）【事実】

刷新後に「AI 生成に見える UI」の監査をした。自動検出は slop-detect（27 項目）と Impeccable、手作業は
コードと画面の確認。紫・グラデーション・グラス・発光・絵文字アイコンなどの典型は元から無かったが、
次の定型は設計の画面例どおりに入っていたので外した。規則は DESIGN_SYSTEM.md §2.1–§2.2。

| 設計（#94 で実装した形） | #96 の形 |
|---|---|
| Home の番組名の上の「あなたの番組」、制作中カードの「制作中」 | 置かない。制作中カードはタイトル → `EP. 003 · 12:34` → 状態 → 動詞のボタン |
| 英語の `YOUR SHOW` `IN PROGRESS` `VOICE` `SOUNDS`、状態の `NEW` | 文頭だけ大文字。`NEW` は「未録音 / Not recorded」（何が新しいのかを言う） |
| 配信の準備の冒頭のチェック円・「音声を書き出しました。」・「音声とテキストを配信サービスへ。」 | 置かない。ファイル（名前・尺・サイズ）と共有を最初に出す。話数の色付きタイルも外した |
| ファイルが無いとき、ファイルのカードの中にエラー通知を入れ子 | 通知はカードの外（上）に出し、カードの共有ボタンを無効にする |
| Segmented の選択を下辺 2px のシトロン線で示す | 一段明るい面 + 輪郭 1 周 + 文字色 |
| ボタンの中の「→」（編集を続ける、次へ：〇〇、書き出しへ進む、エピソードを開く） | 外した。移動する行の末尾のシェブロンは OS の慣習なので残した |
| キャッチコピー調の文言（「最初の1本を、ここから。」「タイトルはあとで大丈夫。」など） | 平叙の説明（「エピソードはまだありません」「タイトルと概要は録音のあとで入力できます」） |
| バックアップ・復元のヘッダー補足とリード文の二重説明、素材画面のリード文、言語・テーマの「すぐに反映されます」 | 一つにまとめるか、削った |
| `heading` 18px（本文 16px との差が小さく、slop-detect の「平坦な文字階層」に該当） | 20 / 28 |

監査のときの注意: Web 描画の DOM を保存して検出ツールにかけるときは `<script>` を外す。残すと読み込み時に
アプリが起動し直し、「ルートが見つからない」画面を測ってしまう。


検出ツールの結果（#96 の後、Web 描画 7 画面 × ダーク / ライト）:

- slop-detect: 14 画面とも Clean（0〜3 / 100）。残る 1 項目は「平坦な文字階層」（最大と最小の文字サイズの比が
  2.0 未満）。書き出し・配信の準備・設定はヘッダーが 16–20px で、比を 2.0 にするには全画面に 26px 以上の
  見出しが要る。これはランディングページ向けの基準で、モバイルのナビゲーションの見出し（iOS は 17pt）に
  合わないので追わない。
- Impeccable: 角丸の片側の線（`border-accent-on-rounded`）は 0 件になった。残りは無効ボタンの文字の
  コントラスト（WCAG 1.4.3 は無効な部品を対象外とする）、波形の切り抜き（意図どおり）、
  react-native-safe-area-context の Web 版が使う `padding` の transition（Web 描画だけ）。

## 10. OS の標準部品へ寄せた（Issue #98）【事実】

「iPhone の利用者が違和感を持たない操作感」と「既存の資産を使い、デザインは色・形・配置・太さで当てる」
という方針で、自作していた部品を置き換えた。方針と対応表は DESIGN_SYSTEM.md §6.2。

| 以前（#94 の自作） | #98 |
|---|---|
| `Header`（自作のバー） | expo-router のネイティブスタックヘッダー（`ScreenHeader`）。収録中は `usePreventRemove` と `gestureEnabled: false` で戻る操作を止める |
| 「…」→ 下からのシート | iOS: `Stack.Toolbar.Menu`（ヘッダー）と `@expo/ui` の `Menu`（行）。他: 従来のシート |
| 設定の選択 → シート | iOS: `@expo/ui` の `Picker`（menu）。他: シート（選択中にチェック） |
| 権限・エラー・無音の確認 → シート | `Alert`（Web 検証は confirm / alert） |
| 言い直す → シート | iOS: `ActionSheetIOS`。他: シート |
| 名前の変更 → シート | iOS: `Alert.prompt`。他: シート |
| 入力・一覧のシート | iOS: `Modal` の `pageSheet`（下スワイプで閉じる）。他: 従来のシート |
| 自作トグル | `Switch` |
| 自作タブ | iOS: `UISegmentedControl`。他: 従来の `Segmented` |
| SVG アイコン | iOS: SF Symbols（`expo-symbols`、無いときは SVG）。他: SVG |
| 収録日の文字入力 | iOS: `@react-native-community/datetimepicker`（compact）。他: 文字入力 |
| RN の `Animated` / `PanResponder` のトースト、瞬時に縮むボタン | Reanimated の出入り・ばね、Gesture Handler のスワイプ、押下の縮小を 120ms で補間 |
| 設定の「ハプティクス」が何もしない（不具合） | `services.haptics`（`expo-haptics`）。録音の開始・停止、一時停止・再開、言い直し、タブ・選択・話題の切り替え、コピー、書き出し完了 |

### 10.1 この作業で見つけて直した不具合【事実】

- **設定の選択肢が表示されていなかった。** `Row` が `below` を受け取りながら描いておらず、録音品質・チャンネル・
  想定時間・無音の 3 項目の選択肢が見えず変更できなかった。#94 で入れた退行。
- **Home の題が無く、戻るボタンの読み上げが「index」になっていた。** Home の `title` をアプリ名にした。
- **行の右の操作（「…」）が行の押下と入れ子だった。** ネイティブのメニューを押すと行の移動も起きうるので、
  右の操作を行の押下の外へ出した。

### 10.2 検証と未検証【事実】

- `npm run lint` / `typecheck` / `test` / `format:check`、Web 描画の全フロー（Android / Web 側の実装）。
- `expo export -p ios` と `-p android` でバンドルが作れること、`expo prebuild -p ios` が通り、
  追加したライブラリの最低 iOS（16.4）がアプリの設定と一致すること。
- **iOS の実機・シミュレータでは確かめていない**（この環境は Linux）。iOS 専用の実装（`*.ios.tsx`）は
  Web 描画に出ないため、見た目・動き・読み上げは未確認。確認手順は Issue #98 に残した。
