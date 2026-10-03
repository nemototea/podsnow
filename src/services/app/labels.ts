/**
 * DB に書き込まれる既定文言（Issue #80）。
 *
 * services / infra は文言を持たない（ARCHITECTURE.md §2）。UI 層が `src/i18n/` の
 * カタログから詰めて渡す。**一度書き込んだ行はユーザーのデータ**なので、
 * あとで言語を切り替えても既存の行は書き換えない。
 */
export interface ServiceLabels {
  /** 初回起動時に作る Show の名前。 */
  showName: string;
  /** 初回起動時に作る概要欄テンプレートの本文。 */
  descriptionTemplate: string;
  /** Take の既定名（`録音 1` / `Recording 1`）。 */
  takeName: (takeNumber: number) => string;
  /** 録音の追加を取り消しの履歴に積むときの名前（`録音 2 を追加`）。Issue #122。 */
  addTakeOp: (takeName: string) => string;
  /** 割り込みからの再開時に記録する「録音中の出来事」のラベル。 */
  interruptionNote: string;
  /** Android の録音中通知（フォアグラウンドサービス）の文言。 */
  androidNotification: {
    title: string;
    text: string;
    channelName: string;
    channelDescription: string;
  };
  /** ロック画面・通知の再生操作の文言（Issue #184）。題が空のときの代わりと、Android の通知の操作名・チャンネル。 */
  nowPlaying: NowPlayingLabels;
}

export interface NowPlayingLabels {
  untitled: string;
  play: string;
  pause: string;
  rewind: string;
  forward: string;
  stop: string;
  channelName: string;
  channelDescription: string;
}
