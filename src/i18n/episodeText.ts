import type { Messages } from './types';

/**
 * 回の呼び方（Issue #211）。話数は任意の項目なので、空の回は題で呼ぶ。
 * 話数の表記はすべて `episode.number` で作る（DESIGN_SYSTEM.md §2.2、Issue #170）。題が空なら「タイトル未設定」。
 */

/** 一覧や見出しの題（「#43 寝る前に読む本」）。話数が空の回は題だけ。 */
export function episodeHeading(t: Messages, n: number | null, title: string): string {
  const name = title || t.home.untitled;
  return n === null ? name : `${t.episode.number(n)} ${name}`;
}

/** トーストなどで回を指す言い方（「#43」）。話数が空の回はかぎ括弧で囲んだ題。 */
export function episodeRef(t: Messages, n: number | null, title: string): string {
  return n === null ? t.episode.quoted(title || t.home.untitled) : t.episode.number(n);
}

/** 回の「…」メニューの読み上げ（「エピソード 3 の操作」）。話数が空の回は題で言う。 */
export function episodeMenuLabel(t: Messages, n: number | null, title: string): string {
  return n === null
    ? t.home.a11yEpisodeMenuTitled(title || t.home.untitled)
    : t.home.a11yEpisodeMenu(n);
}
