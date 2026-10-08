import type { Messages } from './types';

/**
 * 回の呼び方（Issue #211）。一覧・見出し・トースト・読み上げには話数を出さず、題で呼ぶ。
 * 題が空なら「タイトル未設定」。話数を出すのは「その他の詳細」と取り込みのプレビューだけ。
 */

/** 一覧や見出しの題。 */
export function episodeName(t: Messages, title: string): string {
  return title || t.home.untitled;
}

/** 文の中で回を指す言い方（「『寝る前に読む本』を削除しました」の「『寝る前に読む本』」）。 */
export function episodeRef(t: Messages, title: string): string {
  return t.episode.quoted(episodeName(t, title));
}
