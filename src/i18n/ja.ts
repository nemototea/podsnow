/**
 * 日本語カタログ（Issue #80）。**このファイルがキーの正**。
 *
 * `Messages = typeof ja` を `en.ts` に課しているので、キーの追加・削除・
 * 引数の変更は TypeScript が英語側にも強制する。実行時の抜けは起きない。
 *
 * 規約:
 * - 値は文字列か「文字列を返す関数」だけ。React 要素は入れない。
 * - 数値・時間の整形（`formatSmp` など）は domain 側。ここでは受け取った文字列を挟むだけ。
 */

/**
 * Apple Podcasts の分類名（`itunes:category` の英語の `text` 属性値）の日本語名（Issue #259）。
 * 分類の一覧は Apple の Podcasts Connect の分類に従う。ここに無い名前（古い分類など）は英語のまま出す。
 */
const CATEGORY_NAMES: Readonly<Record<string, string>> = {
  Arts: 'アート',
  Books: '本',
  Design: 'デザイン',
  'Fashion & Beauty': 'ファッション/美容',
  Food: 'フード',
  'Performing Arts': '舞台芸術',
  'Visual Arts': 'ビジュアルアート',
  Business: 'ビジネス',
  Careers: 'キャリア',
  Entrepreneurship: '起業',
  Investing: '投資',
  Management: 'マネジメント',
  Marketing: 'マーケティング',
  'Non-Profit': '非営利団体',
  Comedy: 'コメディ',
  'Comedy Interviews': 'コメディインタビュー',
  Improv: '即興',
  'Stand-Up': 'スタンダップ',
  Education: '教育',
  Courses: '講座',
  'How To': 'ハウツー',
  'Language Learning': '語学',
  'Self-Improvement': '自己啓発',
  Fiction: 'フィクション',
  'Comedy Fiction': 'コメディフィクション',
  Drama: 'ドラマ',
  'Science Fiction': 'SF',
  Government: '行政',
  History: '歴史',
  'Health & Fitness': '健康/フィットネス',
  'Alternative Health': '代替医療',
  Fitness: 'フィットネス',
  Medicine: '医療',
  'Mental Health': 'メンタルヘルス',
  Nutrition: '栄養',
  Sexuality: 'セクシュアリティ',
  'Kids & Family': 'キッズ/ファミリー',
  'Education for Kids': '子ども向け教育',
  Parenting: '子育て',
  'Pets & Animals': 'ペット/動物',
  'Stories for Kids': '子ども向けのお話',
  Leisure: 'レジャー',
  'Animation & Manga': 'アニメ/マンガ',
  Automotive: '自動車',
  Aviation: '航空',
  Crafts: 'クラフト',
  Games: 'ゲーム',
  Hobbies: '趣味',
  // 2019 年 8 月より前の分類。新しく選ばせないが、古いフィードを取り込んだときに出る
  'Games & Hobbies': 'ゲーム/趣味',
  'Other Games': 'その他のゲーム',
  'Home & Garden': 'ホーム/ガーデン',
  'Video Games': 'ビデオゲーム',
  Music: '音楽',
  'Music Commentary': '音楽解説',
  'Music History': '音楽史',
  'Music Interviews': '音楽インタビュー',
  News: 'ニュース',
  'Business News': 'ビジネスニュース',
  'Daily News': 'デイリーニュース',
  'Entertainment News': 'エンタメニュース',
  'News Commentary': 'ニュース解説',
  Politics: '政治',
  'Sports News': 'スポーツニュース',
  'Tech News': 'テクノロジーニュース',
  'Religion & Spirituality': '宗教/スピリチュアル',
  Buddhism: '仏教',
  Christianity: 'キリスト教',
  Hinduism: 'ヒンドゥー教',
  Islam: 'イスラム教',
  Judaism: 'ユダヤ教',
  Religion: '宗教',
  Spirituality: 'スピリチュアル',
  Science: '科学',
  Astronomy: '天文学',
  Chemistry: '化学',
  'Earth Sciences': '地球科学',
  'Life Sciences': '生命科学',
  Mathematics: '数学',
  'Natural Sciences': '自然科学',
  Nature: '自然',
  Physics: '物理学',
  'Social Sciences': '社会科学',
  'Society & Culture': '社会/文化',
  Documentary: 'ドキュメンタリー',
  'Personal Journals': '日記・個人',
  Philosophy: '哲学',
  'Places & Travel': '場所/旅行',
  Relationships: '人間関係',
  Sports: 'スポーツ',
  Baseball: '野球',
  Basketball: 'バスケットボール',
  Cricket: 'クリケット',
  'Fantasy Sports': 'ファンタジースポーツ',
  Football: 'アメリカンフットボール',
  Golf: 'ゴルフ',
  Hockey: 'ホッケー',
  Rugby: 'ラグビー',
  Running: 'ランニング',
  Soccer: 'サッカー',
  Swimming: '水泳',
  Tennis: 'テニス',
  Volleyball: 'バレーボール',
  Wilderness: 'アウトドア',
  Wrestling: 'レスリング',
  Technology: 'テクノロジー',
  'True Crime': 'トゥルークライム',
  'TV & Film': 'テレビ/映画',
  'After Shows': 'アフターショー',
  'Film History': '映画史',
  'Film Interviews': '映画インタビュー',
  'Film Reviews': '映画レビュー',
  'TV Reviews': 'テレビレビュー',
};

/** 番組の言語（`shows.language` の主の部分）の日本語名。ここに無い言語はコードのまま出す。 */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  ja: '日本語',
  en: '英語',
  zh: '中国語',
  ko: '韓国語',
  es: 'スペイン語',
  fr: 'フランス語',
  de: 'ドイツ語',
  it: 'イタリア語',
  pt: 'ポルトガル語',
  ru: 'ロシア語',
};

export const ja = {
  /** サービス名。表示用は PodsNow（ポッズナウ）。識別子の `podsnow` とは別物。 */
  app: {
    name: 'PodsNow',
    versionLine: (version: string) => `PodsNow ${version} (MVP)`,
  },

  common: {
    undo: '取り消す',
    redo: 'やり直す',
    open: '開く',
    close: '閉じる',
    save: '保存',
    done: '完了',
    /** 日付などの値が未設定のとき（Issue #167）。 */
    notSet: '未設定',
    /** Android の日付選びのカレンダー（Issue #167）。 */
    calendar: {
      previousMonth: '前の月',
      nextMonth: '次の月',
      today: '今日',
    },
    add: '追加',
    delete: '削除',
    rename: '名前を変更',
    moveUp: '上へ移動',
    moveDown: '下へ移動',
    error: 'エラー',
    loading: '読み込んでいます',
    preparing: '準備しています',
    none: 'なし',
    /** 値が空のとき。括弧で囲まず、弱い色で出す（Issue #170）。 */
    empty: '未入力',
    copy: 'コピー',
    copied: 'コピー済み',
    share: '共有',
    cancel: 'キャンセル',
    shareUnavailable: 'この端末では共有できません',
    openSettings: '設定を開く',
    later: 'あとで',
    retry: 'もう一度書き出す',
    loadingEpisode: 'エピソードを読み込んでいます',
  },

  a11y: {
    back: '戻る',
    close: '閉じる',
    settings: '設定',
    movedTo: (label: string, position: number, total: number) =>
      `${label} を ${total} 件中 ${position} 番目へ移動`,
    zoomIn: '拡大',
    zoomOut: '縮小',
    play: '再生',
    pause: '一時停止',
    decrease: (label: string) => `${label} を下げる`,
    increase: (label: string) => `${label} を上げる`,
    dismiss: '通知を閉じる',
  },

  player: {
    title: 'プレーヤー',
    artwork: '番組アートワーク',
    seek: '再生位置',
    rewind: '15秒戻る',
    forward: '30秒進む',
    open: 'プレーヤーを開く',
    stop: '再生を止めて閉じる',
    /** 再生を押してから音が出るまで（Issue #185）。配信の音声は通信することを示す。 */
    loadingStream: '配信から読み込み中…',
    loadingFile: '読み込み中…',
    retry: 'もう一度読み込む',
    /** プレーヤー画面（Issue #188）。下へ引いても閉じる。 */
    close: 'プレーヤーを閉じる',
    /** 再生元。Home の再生は書き出し → 配信 → 編集中のタイムラインの順に選ぶ（FR-EP-7）。 */
    sourceExport: '書き出したファイル',
    sourceRss: '配信中の音声',
    sourceTimeline: '編集中の下書き',
    recordedOn: (date: string) => `収録日 ${date}`,
    publishedOn: (date: string) => `配信日 ${date}`,
    description: '概要',
  },

  /** エピソードの状態（FR-EP-3）。 */
  status: {
    draft: '下書き',
    ready: '準備OK',
    exported: '書き出し済み',
  },

  /** `AppErrorCode` → 表示文言。 */
  errors: {
    voice_timeline_empty: 'まだ録音がありません',
    recording_resume_failed: '録音の再開に失敗しました',
    disk_space_insufficient: '端末の空き容量が足りません',
    export_app_terminated: 'アプリが終了したため中断されました',
    export_metadata_failed:
      '音声は書き出せましたが、題名やアートワークをファイルに書き込めませんでした',
    import_not_https: 'https:// で始まる URL だけ読み込めます',
    import_network_failed: '接続できませんでした。通信環境を確認してください',
    import_timeout: '応答がありませんでした。しばらくしてからもう一度お試しください',
    import_http_status: (status: string) => `番組の情報を取得できませんでした（${status}）`,
    import_too_large: (maxMb: string) => `ファイルが大きすぎます（上限 ${maxMb} MB）`,
    import_not_a_feed: 'ポッドキャストの RSS として読めませんでした。URL を確認してください',
    import_no_feed_url: 'この番組は RSS の URL が公開されていないため、取り込めません',
    import_other_show: 'すでに別の番組を取り込んでいます。番組は 1 つだけ持てます',
    import_unsupported_encoding: (encoding: string) =>
      `この RSS の文字コード（${encoding}）には対応していません。UTF-8 の RSS だけ読み込めます`,
    cover_processing_failed: 'アートワークを保存できませんでした',
    file_delete_failed: 'ファイルを削除できませんでした。もう一度お試しください',
    share_prepare_failed:
      '共有するファイルを用意できませんでした。空き容量を確かめて、もう一度お試しください',
    playback_stream_failed:
      '配信の音声を読み込めませんでした。通信できるか確かめて、もう一度再生してください',
    playback_file_failed: '書き出したファイルを再生できませんでした。もう一度書き出してください',
  },

  /** 初回起動時に DB へ書き込む既定値。以後はユーザーのデータなので翻訳しない。 */
  seed: {
    showName: 'マイポッドキャスト',
    takeName: (n: number) => `録音 ${n}`,
    /** 取り消しの履歴の名前。テイクの番号は出さない（Issue #179）。 */
    addTakeOp: '録音を追加',
    descriptionTemplate: `――――――
Podcast: {{show_name}}
感想は #PodsNow まで`,
    interruptionNote: '割り込みで録音が途切れました',
  },

  /** Android の録音中通知（フォアグラウンドサービス）。 */
  androidNotification: {
    title: 'PodsNow — REC中',
    text: 'タップして戻る',
    channelName: '録音',
    channelDescription: 'REC中に表示されます',
  },

  /** ロック画面・通知の再生操作（Issue #184、AUDIO_DESIGN.md §10.5）。 */
  nowPlaying: {
    untitled: '無題のエピソード',
    play: '再生',
    pause: '一時停止',
    rewind: '15秒戻る',
    forward: '30秒進む',
    stop: '止めて閉じる',
    channelName: '再生',
    channelDescription: '再生中に表示されます',
  },

  /** Undo 履歴のラベル（トーストに「〜を取り消しました」として出る）。 */
  undo: {
    deleteRange: '範囲を削除',
    deleteSilence: '無音を詰める',
    changeGain: '音量を変更',
    removeAsset: '素材を削除',
    moveAsset: '素材を移動',
    resizeAsset: '素材の長さを変更',
    insertAsset: (name: string) => `${name} を挿入`,
    reanchored: (label: string) => `${label}（素材を追従）`,
    changeFade: 'フェードを変更',
    undid: (label: string) => `「${label}」を取り消しました`,
    redid: (label: string) => `「${label}」をやり直しました`,
  },

  /** 素材の用途（FR-AST-1）。 */
  /** 素材の用途。`hint` は素材の画面の見出しの下に出す、何に使う音かの一文。 */
  assetKinds: {
    opening: { label: 'オープニング', hint: 'エピソードの始まりに流す音' },
    ending: { label: 'エンディング', hint: 'エピソードの終わりに流す音' },
    jingle: { label: 'ジングル', hint: 'コーナーの切り替えなどに差し込む短い音' },
    sfx: { label: '効果音', hint: '拍手や笑い声など、話の途中に差し込む音' },
    bgm: { label: 'BGM', hint: '声の後ろで小さく流す音楽' },
  },

  /** 下部タブ（見本 `.tabs`）。 */
  tabs: { home: 'ホーム', search: '検索', library: '素材', create: '作成' },

  /** 検索タブ。 */
  search: {
    placeholder: 'エピソードや素材を探す',
    noResults: '見つかりませんでした',
    episodes: 'エピソード',
    sounds: '素材',
  },

  home: {
    /** 番組カードの本数（見本 `.showcard small`）。 */
    showCardCount: (episodes: number) => `${episodes} エピソード`,
    /** 番組を設定していないときの番組カード（FR-SHOW-6、Issue #168）。 */
    showCardUnset: '番組の情報が未設定',
    /** 絞り込みのチップ（見本 `.home .chip`）。 */
    filters: { all: 'すべて', draft: '下書き', exported: '書き出し済み' },
    /** 続きからの素材のタイル（見本 `.quick .mat`）。 */
    shortcuts: {
      openingEnding: 'オープニング・エンディング',
      bgmJingle: 'BGM・ジングル',
      sfx: '効果音',
      notesTemplate: 'カンペのひな形',
    },
    sectionShows: 'あなたの番組',
    sectionRecent: '最近のエピソード',
    /** 「最近のエピソード」の右端。上限を超えたときだけ出し、番組画面の一覧を開く。 */
    seeAll: 'すべて見る',
    a11ySeeAll: (count: number) => `エピソードをすべて見る（${count} 件）`,
    /** 下書きバー（見本 `.mini .t small`「下書き · 18:04 · 録音を続ける」）。 */
    miniDraft: (status: string, duration: string) => `${status} · ${duration} · 録音を続ける`,
    miniRecord: '録音に戻る',
    miniOpenDraft: (title: string) => `${title} を開く`,
    badgeNew: '未録音',
    badgePublished: '配信済み',
    /** `name` は `episodeRef` で作った回の呼び方（「『題』」。話数は出さない。Issue #211）。 */
    removed: (name: string) => `${name}を削除しました`,
    audioPurged: (name: string) => `${name}の音声を削除しました`,
    badgeNoAudio: '音声なし',
    untitled: 'タイトル未設定',
    recoveredTitle: '途中の録音を復元しました',
    recoveredBody: (duration: string) => `保存が終わる前に止まった録音です（${duration}）`,
    reviewRecording: '録音を確認する',
    /** 複数の録音を復元したとき（Issue #168 E8）。 */
    recoveredTitleMany: (count: number) => `途中の録音を ${count} 件復元しました`,
    recoveredBodyMany: '保存が終わる前に止まった録音です',
    /** `name` は `episodeRef` で作った回の呼び方。 */
    reviewRecordingOf: (name: string) => `${name}の録音を確認する`,
    /** 回の「…」の読み上げ。話数ではなく題で言う（Issue #211）。 */
    a11yEpisodeMenu: (title: string) => `「${title}」の操作`,
    a11yOpenShow: (name: string) => `${name} を開く`,
    importShow: '配信中の番組を取り込む',
    reimportShow: '番組の情報を読み込み直す',
    onboardingTitle: '番組の情報を入れる',
    onboardingBody: 'すでに配信している番組なら、番組名で探して情報と過去の回を取り込めます',
    onboardingImport: '配信中の番組を取り込む',
    onboardingNew: '新しく始める',
  },

  /** 配信中の番組の取り込み（Issue #101、FR-SHOW-6〜10）。 */
  podcastImport: {
    title: '配信中の番組を取り込む',
    searchLabel: '番組名',
    searchPlaceholder: '番組名で探す',
    search: '探す',
    searching: '探しています…',
    noResults: '見つかりませんでした。番組名を変えるか、RSS の URL から取り込んでください',
    resultsHeader: '検索結果',
    noFeed: 'RSS の URL が公開されていません',
    urlHeader: 'RSS の URL から取り込む',
    urlLabel: 'RSS の URL',
    urlHelp: '配信サービスの番組設定に表示されている URL です',
    loadUrl: '読み込む',
    reloadHeader: '前回の番組',
    reloadBody: (url: string) =>
      `前回取り込んだ RSS（${url}）から、最新の情報と配信済みの回を読み込み直します`,
    reload: '読み込み直す',
    loading: '番組の情報を読み込んでいます…',
    refreshHeader: '最新の番組の情報',
    alreadyAdded: 'この番組は追加済みです',
    alreadyAddedBody: '最新の情報と配信済みの回は「読み込み直す」で取り込めます',
    previewHeader: 'この番組を取り込みますか？',
    a11yArtwork: (name: string) => `${name} のアートワーク`,
    episodesCount: (n: number) => `配信済みの回 ${n} 本`,
    nextNumber: (code: string) => `次の新しいエピソードは ${code} から`,
    noEpisodeNumbers:
      'RSS の最新のフルの回に話数がないので、新しいエピソードの話数は空のまま始まります。使うときは各回の「その他の詳細」で入れられます',
    overwriteNote:
      '番組名・概要・著者などを、この内容で上書きします。RSS に無い項目は今の値を残します',
    /** 回の概要の共通部分を概要欄のひな形にする（Issue #260） */
    templateHeader: '概要欄のひな形',
    useTemplate: 'この内容を概要欄のひな形にする',
    templateHelp:
      '直近の回の概要に共通する行です。選ぶと今のひな形を置き換えます。あとで番組の設定から直せます',
    templateSaved: '概要欄のひな形も保存しました',
    confirm: '取り込む',
    back: '探し直す',
    cannotLeave: '取り込みが終わるまでお待ちください',
    importing: '取り込んでいます…',
    doneTitle: '取り込みました',
    doneBody: (n: number) => `配信済みの回 ${n} 本を取り込みました`,
    coverFailed: 'アートワークは保存できませんでした。あとで番組の設定から入れ直せます',
    toHome: 'ホームへ',
    toShow: '番組の設定を見る',
    failed: '取り込めませんでした',
  },

  record: {
    /** 収録画面の波形の左上の札（見本 `.wavebox .pill.rec`）。 */
    recPill: 'REC',
    /** 収録画面の題の下（見本「テイク 4 · 末尾に追加」）。 */
    appendAtEnd: '末尾に追加',
    insertAtPosition: (at: string) => `${at} に差し込み`,
    levelDb: (db: number) => `${db} dB`,
    close: '閉じる',
    a11yMenuLocked: '録音中は操作できません',
    stop: '録音を止める',
    cannotLeave: '録音中は戻れません。停止してください',
    diskLow: '空き容量が少ないため録音を停止しました',
    /** 録音を始められなかったときのダイアログの題（Issue #165）。 */
    cannotStartTitle: '録音を始められません',
    interrupted: '割り込みで録音が止まりました。ここまでは保存済みです',
    builtInMic: '内蔵マイク',
    /** 名前の取れない外部の入力。 */
    externalInput: '外部マイク',
    routeChanged: (input: string) => `入力が ${input} に切り替わりました`,
    takeAdded: (duration: string) => `録音を追加しました（${duration}）`,
    takeInserted: (duration: string, at: string) => `${at} に録音を差し込みました（${duration}）`,

    registerAssets: '番組の音',
    moreAssets: 'ほかの素材',
    insertSubRecording: '今の発言位置に入ります',
    inserted: (name: string) => `${name} を入れました`,
    insertedNoMonitor: (name: string) => `${name} を入れました · 再生なし`,
    insertedAt: (name: string, at: string) => `${name} を ${at} に入れました`,

    pause: '一時停止',
    resume: '再開',
    finishFirst: '録音を終えてから移動してください',
    /** 録音している状態の表示は「REC中」（ユーザー判断 2026-10-06、#235。DESIGN_SYSTEM.md §2.2）。 */
    stateRecording: 'REC中',
    statePaused: '一時停止中',
    stateInterrupted: '割り込みで止まっています',
    statePreparing: 'マイクを準備しています',
    stateStopping: '録音を保存しています',
    a11yElapsed: (time: string) => `録音時間 ${time}`,
    inputLine: (name: string, channels: string) => `${name} · ${channels}`,
    inputUnknown: '入力を確認できません',
    bluetoothTitle: 'Bluetooth マイクは音質が落ちます',
    a11yInsertNow: (name: string) => `${name} をいまの位置に入れる`,
    start: '録音を開始',
    startHere: 'ここから録音',
    savingOnDevice: (left: string) => `保存中 · 残り約 ${left}`,
    savingOnDeviceUnknown: '保存中',
    savingStopped: '保存が止まりました。ここまでの録音は残っています',
    recordableFor: (left: string) => `残り約 ${left}`,
    freeSpaceUnknown: '空き容量を確認できません',
    hours: (n: number) => `${n} 時間`,
    minutes: (n: number) => `${n} 分`,
    a11yLevel: (db: number) => `入力レベル ${db} dB`,
    a11yLevelIdle: '入力レベル（録音していません）',
    clipped: '音が割れています。マイクから少し離れてください',
    permTitle: 'マイクへのアクセス',
    permBody: '声を録音するために、マイクへのアクセスを許可してください',
    permAllow: '許可する',
    permDeniedTitle: 'マイクが許可されていません',
    permDeniedBody: '設定でマイクへのアクセスを許可すると、録音できるようになります',
  },

  /** カンペ（FR-OUT-1..3、Issue #180）。英語は Notes。 */
  notes: {
    /** 編集画面の見出し、録音中のカードの上段（見本 `.notesbox h4`、`.cue small`）、シートの題。 */
    title: 'カンペ',
    /** 編集画面でカンペが空のとき（DESIGN_SYSTEM.md §8）。 */
    empty: '話す内容を書いておけます',
    placeholder: 'オープニング\n・今日の話題\n・お便り\nエンディング',
    a11yEdit: 'カンペを書く',
    a11ySave: '完了してカンペを保存',
  },

  edit: {
    selectedLabel: '選択中',
    seconds: (s: string) => `${s} 秒`,
    enterNumbers: '秒数で指定',
    playheadInfo: (pos: string, total: string) => `${pos} / ${total}`,
    /** 再生位置を先頭（0:00）へ戻す。 */
    toStart: '先頭へ戻る',
    insertBefore: '前に素材',
    insertAfter: '後ろに素材',
    insert: '素材を追加',
    clearSelection: '選択を解除',
    removeSilence: '無音を詰める',
    deleted: (duration: string) => `${duration} を削除しました`,

    silenceNone: '詰められる無音はありませんでした',
    silenceApplied: (count: number, total: string) =>
      `${count} 箇所、合計 ${total} の無音を詰めました`,

    insertTitle: '素材を入れる',
    insertSubtitle: (at: string) => `${at} に入ります`,
    overlayFallback: '素材',
    gain: '音量',
    /** 選んだ素材の帯のフェード（Issue #254）。長さは帯の上の丸を引いて変える。 */
    fadeLine: (fadeIn: string, fadeOut: string) =>
      `フェードイン ${fadeIn} · フェードアウト ${fadeOut}`,
    overlayHint: '帯を引くと動きます。上の丸でフェード、BGM は両端で長さを変えます',
    playFromOverlay: 'この素材の位置から再生',
    closeOverlay: '選ぶのをやめる',
    /** 録音前の波形で、本編が入る場所の枠（Issue #254）。 */
    voicePlaceholder: '録音するとここに入ります',
    /** 何も選んでいないときのシート。この回の並びを番組に覚えさせる（Issue #254）。 */
    saveStructure: 'この構成を既定にする',
    structureSaved: '次のエピソードからこの構成で始まります',
    moveHere: '再生位置へ移す',
    moveHereSub: (at: string) => `${at} に置き直す（発言に追従）`,
    removeOverlay: 'この素材を外す',
    overlayRemoved: '素材を外しました',
    rangeError: (max: string) => `開始より後、${max} 秒以内の終了位置を指定してください`,
    a11yPlayhead: (pos: string, total: string) => `再生位置 ${pos}、全体 ${total}`,
    a11yUndo: (label: string) => `取り消す：${label}`,
    a11yRedo: (label: string) => `やり直す：${label}`,
    startSec: '開始（秒）',
    endSec: '終了（秒）',
    playSelection: '選択範囲を試聴',
    a11yOverlay: (kind: string, name: string) => `${kind}：${name}`,
    a11yInterruption: '割り込みで止まった位置',
    a11yRouteChange: '入力が切り替わった位置',
  },

  episode: {
    tabs: {
      studio: '収録',
      export: '書き出し',
    },
    duplicated: '新しい回として複製しました',
    menu: {
      duplicate: '複製して新しい回にする',
      purgeAudio: '音声を削除',
      purgeAudioSub: '録音だけ消して容量を空ける。話数・タイトル・概要・書き出し履歴は残る',
      remove: 'エピソードを削除',
      removeMessage: '録音と書き出したファイルも、この端末から消えます。元に戻せません',
    },
    /**
     * 話数の表記（Issue #170）。画面に出す話数はすべてこれで作る。
     * 一覧・見出し・トーストには話数を出さず題で呼ぶ（Issue #211）。話数を出すのは
     * 「その他の詳細」と取り込みのプレビューだけ。
     */
    number: (n: number) => `#${n}`,
    /** 文の中で回を指すとき（「『題』を削除しました」）。`episodeRef` が使う。 */
    quoted: (title: string) => `「${title}」`,
    a11yMenu: 'エピソードの操作',
  },

  details: {
    a11yEdit: (label: string) => `${label}を編集`,
    /** Spotify for Creators と同じまとめ方。種類・話数・シーズンを直す（Issue #211）。 */
    moreDetails: 'その他の詳細',
    title: 'エピソードの詳細',
    suggestionEyebrow: 'AI の下書き候補',
    adopt: '採用する',
    discard: '破棄',
    titleEyebrow: 'タイトル',
    titlePlaceholder: 'タイトル',
    descriptionEyebrow: '概要',
    descriptionPlaceholder: '概要',
    reapplyTemplate: 'テンプレートを再適用',
    episodeEyebrow: '話数',
    seasonEyebrow: 'シーズン',
    /** 「その他の詳細」の値に出すシーズン。 */
    seasonValue: (n: number) => `シーズン ${n}`,
    typeEyebrow: 'エピソードの種類',
    /** `itunes:episodeType`。名前は Spotify for Creators に合わせる（Issue #211）。 */
    episodeTypes: { full: 'フル', trailer: 'トレーラー', bonus: 'ボーナス' },
    numberHelp: '空にすると話数なしになります',
    recordedEyebrow: '収録日',
    badDate: '収録日は YYYY-MM-DD で入力してください',
    noTemplate: '概要欄テンプレートがありません',
    templateApplied: 'テンプレートを適用しました',
    undoTemplate: 'テンプレートの適用を取り消す',
    dateHelp: '例：2026-09-23',
    /** 保存ボタンをなくした代わりに、自動で保存されることを伝える（Issue #167）。 */
    autosaveHelp: '入力した内容は自動で保存されます',
  },

  sound: {
    measuringShort: (pct: number) => `測定中 ${pct}%`,
    embed: 'アートワークとタイトルを埋め込む',
    loudness: '音量をそろえる',
    recommended: '（推奨）',
    truePeak: 'トゥルーピーク上限',
    ducking: '話す間は BGM を下げる',
    advanced: '詳細設定',
    depth: '下げ幅',
    attack: 'アタック',
    release: 'リリース',
    threshold: '声のしきい値',
    /** 試聴の正規化のゲインを裏で測っている間（Issue #158）。 */
    measuring: (pct: number) => `試聴の音量を測っています（${pct}%）`,
    sectionFinish: '音の仕上げ',
    sectionFormat: 'ファイル形式',
    targetLoudness: '目標ラウドネス',
    /** BGM が無い回の「話す間は BGM を下げる」に添える（Issue #262）。 */
    duckingNoBgm: 'BGM が無いので、今回の書き出しには効きません。収録タブで BGM を入れられます',
  },

  export: {
    estimatedSizeShort: (size: string) => `約 ${size}`,
    presets: {
      podcast: { label: 'Podcast', spec: 'M4A · 128 kbps · モノラル' },
      high: { label: '高音質', spec: 'M4A · 256 kbps · ステレオ' },
      wav: { label: 'WAV', spec: '48 kHz · 16 bit · 非圧縮' },
      custom: { label: 'カスタム' },
    },
    specM4a: (kbps: number, channels: string, khz: string) =>
      `M4A · ${khz} kHz · ${kbps} kbps · ${channels}`,
    specWav: (channels: string, khz: string) => `WAV · ${khz} kHz · 16 bit · ${channels}`,
    custom: {
      m4aShort: 'M4A',
      wavShort: 'WAV',
      format: '形式',
      m4a: 'M4A（AAC）',
      wav: 'WAV（非圧縮）',
      bitrate: 'ビットレート',
      sampleRate: 'サンプルレート',
      channels: 'チャンネル',
      mono: 'モノラル',
      stereo: 'ステレオ',
    },
    lufs: (value: string) => `${value} LUFS`,
    lufsBelowTarget: (value: string, target: number) =>
      `${value} LUFS（目標 ${target} LUFS に届いていません）`,
    phaseMeasuring: '音を整えています',
    phaseRendering: 'ファイルを作成しています',
    run: '書き出して共有',
    emptyVoice: 'まだ録音がありません。収録タブで録音してから書き出します',
    historyEyebrow: '書き出し履歴',
    cancelled: '書き出しを中止しました',
    historyFailed: (message: string) => `失敗: ${message}`,
    historyNoMetadata: '題名・アートワークなし',
    historyCancelled: '中止',
    historyRunning: (pct: number) => `進行中 ${pct}%`,
    deleteExport: '書き出しを削除',
    a11yDeleteExport: (when: string) => `${when} の書き出しを削除`,
    deleteExportMessage:
      '書き出したファイルを端末から消します。共有や「ファイル」に保存したコピーと、録音・編集は残ります。',
    deleteExportLastListenable:
      'この回を聴けるのは、この書き出しだけです。録音を削除済みで配信もされていないため、消すとこの回はどこからも聴けなくなります。',
    exportDeleted: '書き出しを削除しました',
    failedTitle: '音声の書き出しに失敗しました',
    failedBody: '録音と編集内容は端末に残っています',
    cancel: '書き出しをキャンセル',
    a11yOpenHandoff: (when: string) => `${when} の書き出しを配信の準備で開く`,
  },

  pack: {
    fieldsHeading: '配信サービスに貼る情報',
    title: '配信の準備',
    shareFile: '音声ファイルを共有',
    noExport: '書き出し済みの音声ファイルがありません',
    toExport: 'エピソードへ戻る',
    titleEyebrow: 'タイトル',
    descriptionEyebrow: '概要',
    allMetadataEyebrow: 'まとめてコピー',
    backHome: 'エピソード一覧へ',
    a11yCopy: (label: string) => `${label} をコピー`,
    a11yCopied: (label: string) => `${label} をコピーしました`,
    olderExport: (when: string, format: string) =>
      `${when} に書き出した ${format} を表示しています`,
    missingFile: '音声ファイルが見つかりません。エピソードへ戻って、もう一度書き出してください',
    belowTargetNote: (target: number) => `音が小さく、目標の ${target} LUFS に届いていません`,
    copyFailed: 'コピーできませんでした',
  },

  /** 共有画面の「まとめてコピー」テキストの見出し。 */
  metadata: {
    title: 'タイトル',
    episode: '話数',
    season: 'シーズン',
    recordedAt: '収録日',
    duration: '長さ',
    file: 'ファイル',
  },

  settings: {
    title: '設定',
    languageEyebrow: '言語',
    language: {
      system: 'システム',
      ja: '日本語',
      en: 'English',
    },
    generalEyebrow: '全般',
    recordingEyebrow: '録音',
    mono: 'モノラル',
    stereo: 'ステレオ',
    inputDefault: '入力ソースの既定',
    inputOsDefault: 'OS の既定',
    inputTypes: {
      builtin: '内蔵',
      wired: '有線',
      bluetooth: 'Bluetooth',
      usb: 'USB',
      other: 'その他',
    },
    inputLastUsed: '前回のデバイス（未接続）',
    bluetoothWarning: '内蔵・有線マイクをおすすめします',
    lowQualitySuffix: ' · 低音質',
    autoResume: '割り込み後に自動で再開',
    androidSource: 'Android の録音ソース',
    sources: {
      voice_recognition: { label: '標準（推奨）', sub: 'AGC なし・軽いノイズ抑制' },
      mic: { label: 'マイク', sub: '端末の自動処理あり' },
      unprocessed: { label: '未処理', sub: '対応端末のみ。素の音' },
      camcorder: { label: 'カムコーダー', sub: '広い集音' },
    },
    editingEyebrow: '編集',
    silenceLength: '無音として扱う長さ',
    seconds: (s: string) => `${s}秒`,
    silenceThreshold: '無音とみなす音量',
    silencePad: '残す余白',
    silenceAuto: '無音を自動で詰める',
    haptics: 'ハプティクス',
    monitorRow: 'ジングルのモニター再生',
    monitor: {
      headphonesOnly: {
        label: 'イヤホン接続時のみ',
        sub: 'スピーカーだと録音に回り込むため（推奨）',
      },
      always: { label: '常に再生', sub: 'スピーカー時は回り込みます' },
      never: { label: '再生しない', sub: '挿入イベントだけ記録' },
    },
    exportEyebrow: '書き出し',
    defaultPreset: '既定のプリセット',
    defaultPresetSheet: '既定の書き出しプリセット',
    presets: {
      podcast: { label: 'Podcast', sub: 'M4A · 128 kbps · モノラル' },
      high: { label: '高音質', sub: 'M4A · 256 kbps · ステレオ' },
      wav: { label: 'WAV', sub: '48 kHz · 16 bit · 非圧縮' },
      custom: { label: 'カスタム', sub: '書き出し画面で最後に選んだ設定' },
    },
    storageEyebrow: 'ストレージ',
    recordingsSize: '録音データ',
    exportsSize: '書き出しファイル',
    freeSpace: '端末の空き容量',
  },

  showSettings: {
    a11yShareShow: '番組を共有',
    /** 番組画面の一覧の日付（見本 `.epi .d`）。 */
    today: '今日',
    minutes: (n: number) => `${n}分`,
    /** 番組画面の一覧の切り替え（見本 `.eplist .chip`）。 */
    sections: { episodes: 'エピソード', assets: '素材', templates: 'ひな形' },
    a11yShowMenu: '番組の操作',
    newEpisode: '新しいエピソードを録音',
    a11yEditEpisode: (label: string) => `${label} を編集`,
    a11yShareEpisode: (label: string) => `${label} を共有`,
    editShowInfo: '番組情報を編集',
    a11yEditShowInfo: '番組名、概要、著者、Web サイト、カテゴリー、言語を編集',
    a11ySaveShowInfo: '完了して番組情報を保存',
    showInfoSaved: '番組情報を保存しました',
    name: '番組名',
    description: '概要',
    author: '著者',
    website: 'Web サイト',
    websitePlaceholder: 'https://',
    /** 編集シートの配信の情報（Issue #259。Spotify for Creators / Apple Podcasts Connect と同じ項目）。 */
    category: 'カテゴリー',
    subcategory: 'サブカテゴリー',
    language: '言語',
    explicit: '露骨な表現を含む',
    /** 番組画面の札（見本 `.showhead .meta .pill`）。配信サービスと同じ略号。 */
    explicitBadge: 'E',
    /** 番組画面の紹介（見本 `.showhead .about`。Issue #259）。3 行に収まらないときの開閉。 */
    aboutMore: 'もっと見る',
    aboutLess: '閉じる',
    /** 紹介が空のとき（見本 `.showhead .write`）。押すと編集シート。 */
    writeAbout: '番組の紹介を書く',
    a11yOpenWebsite: (site: string) => `Web サイト ${site} を開く`,
    /** カテゴリーの表示名（`show_categories` の英語の分類名から）。 */
    categoryName: (name: string) => CATEGORY_NAMES[name] ?? String(name),
    /** 言語の表示名（`shows.language` の主の部分から）。 */
    languageName: (code: string) => LANGUAGE_NAMES[code] ?? String(code),
    a11yLanguage: (language: string) => `言語: ${language}`,
    artworkA11y: '番組のアートワーク',
    chooseArtwork: '画像を選ぶ',
    changeArtwork: '画像を変更',
    removeArtwork: '画像を削除',
    confirmRemoveArtwork: '番組のアートワークを削除しますか？',
    artworkSaved: 'アートワークを保存しました',
    artworkRemoved: 'アートワークを削除しました',
    layoutEyebrow: '新しいエピソードの構成',
    layoutDefaultsNote:
      '音量・配置・フェード・下げ幅は、エピソードの「この構成を既定にする」で変わります',
    notesTemplateEyebrow: 'カンペのひな形',
    notesTemplatePlaceholder: 'オープニング\n・今日の話題\n・お便り\nエンディング',
    notesTemplateHelp:
      '新しいエピソードのカンペに最初から入ります。作った後のエピソードは変わりません',
    a11yEditNotesTemplate: 'カンペのひな形を編集',
    a11ySaveNotesTemplate: 'カンペのひな形を保存',
    notesTemplateSaved: 'カンペのひな形を保存しました',
    chooseAsset: '素材から選ぶ',
    a11yPickAsset: (slot: string) => `${slot} の素材を選ぶ`,
    a11ySlotPreview: (slot: string) => `${slot} の素材を試聴`,
    a11yStopSlotPreview: (slot: string) => `${slot} の試聴を止める`,
    templateEyebrow: '概要欄テンプレート',
    a11yTemplate: '概要欄テンプレート',
    a11yEditDescriptionTemplate: '概要欄テンプレートを編集',
    a11ySaveDescriptionTemplate: '概要欄テンプレートを保存',
    descriptionTemplateSaved: '概要欄テンプレートを保存しました',
    placeholders: {
      title: 'タイトル',
      episode_number: '話数',
      season: 'シーズン',
      show_name: '番組名',
    },
    a11yInsertPlaceholder: (name: string) => `${name} を挿入`,
    templateHelp:
      '{{show_name}} のような記法は、新しいエピソードを作るときに中身へ置き換わります。下のボタンはカーソルの位置に入ります。',
    templatePreview: 'プレビュー',
    placeholderToken: (name: string) => `［${name}］`,
    templateLines: (n: number) => `${n} 行`,
    slotAssets: (slot: string) => `${slot} の素材`,
  },

  showAssets: {
    title: '素材',
    add: '素材を追加',
    count: (n: number) => `${n} 件`,
    a11yOpen: (n: number) => `素材 ${n} 件の管理画面を開く`,
    a11yAdd: (kind: string) => `${kind} に音源を追加`,
    /** 用途ごとのまとまりの最後の行（素材の画面）。押すとファイルを選ぶ。 */
    addKind: (kind: string) => `${kind}を追加`,
    addKindSub: 'ファイルから音声を選ぶ',
    /** 用途の絞り込みの「すべて」。 */
    all: 'すべて',
    importing: (pct: number) => `読み込み中… ${pct}%`,
    imported: (kind: string, name: string) => `${kind} に「${name}」を追加しました`,
    importFailed: (message: string) => `読み込めませんでした: ${message}`,
    removed: (name: string) => `「${name}」を削除しました`,
    confirmRemove: (name: string) => `素材「${name}」を削除しますか？`,
    preview: '試聴',
    stop: '停止',
    favorite: 'お気に入りにする',
    unfavorite: 'お気に入りを解除',
    a11yAssetName: '素材の名前',
    a11yMenu: (name: string) => `${name} の操作`,
  },

  /**
   * 専門用語の説明（DESIGN_SYSTEM.md §2.2、Issue #170）。ラベルの横の ⓘ から開く。
   * 何が起きるかを 1〜3 文で書き、仕組みの詳細（アタック・リリースなど）は書かない。
   */
  glossary: {
    a11yInfo: (term: string) => `${term} の説明`,
    explicit: {
      term: '露骨な表現',
      body: '性的な表現、乱暴な言葉、暴力の描写などを含む番組でオンにします。配信サービスで番組に「E」の印が付き、子ども向けの制限で隠れることがあります。',
    },
    duckDepth: {
      term: '下げ幅',
      body: '声が入っている間に BGM をどれだけ小さくするかです。数字が小さい（マイナスが大きい）ほど BGM が静かになります。-10 dB でおよそ半分の大きさに聞こえます。',
    },
    duckAttack: {
      term: 'アタック',
      body: '声が出てから BGM が下がりきるまでの時間です。短いと話し始めがはっきりし、長いと BGM の変化が目立ちません。',
    },
    duckRelease: {
      term: 'リリース',
      body: '声が止まってから BGM が元の大きさに戻るまでの時間です。短いと話の合間に BGM が出入りして落ち着きません。長いほどなめらかです。',
    },
    duckThreshold: {
      term: '声のしきい値',
      body: 'これより大きい音を「声」とみなして BGM を下げます。息や雑音で BGM が下がるなら上げ、声が小さくて下がらないなら下げます。',
    },
    ducking: {
      term: 'ダッキング',
      body: '声が入っている間だけ、BGM の音量を自動で下げます。話し声が BGM に埋もれず、聞き取りやすくなります。',
    },
    loudness: {
      term: 'ラウドネス',
      body: '耳に聞こえる音の大きさです。LUFS という単位で表し、0 に近いほど大きく聞こえます。オンにすると、書き出す音声を目標の大きさにそろえます。',
    },
    truePeak: {
      term: 'トゥルーピーク',
      body: '音の波のいちばん高いところの大きさです。dBTP という単位で表します。上限を低めにしておくと、配信サービスで変換されたときに音が割れにくくなります。',
    },
    bitrate: {
      term: 'ビットレート',
      body: '1 秒の音声に使うデータの量です。大きいほど音質が良くなり、ファイルも大きくなります。話し声が中心なら 128 kbps で足ります。',
    },
    haptics: {
      term: 'ハプティクス',
      body: '録音の開始・停止やタブの切り替えのときに、端末を短く振動させて操作を知らせます',
    },
    androidSource: {
      term: 'Android の録音ソース',
      body: 'マイクの音をアプリが受け取る前に、Android がかける処理の種類です。標準は音量の自動調整（AGC）をかけず、ノイズを軽く抑えます。',
    },
  },
};
