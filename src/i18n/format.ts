import type { Locale } from '@/domain/locale';

/**
 * 日付・日時の表示（Issue #170）。画面ごとに `getMonth()` で組み立てず、ここを通す。
 *
 * 並び・区切り・12/24 時間は言語の慣習に任せる（`Intl.DateTimeFormat`）。
 * 値（`YYYY-MM-DD` の入力欄、ファイル名）の書式はここではなく domain が持つ。
 */

/** `Intl` に渡す言語タグ。地域は固定する（端末の地域設定で並びが変わらないように）。 */
export const INTL_TAG: Readonly<Record<Locale, string>> = { ja: 'ja-JP', en: 'en-US' };

const DATE: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

/** 日付（例: `2026年9月30日` / `September 30, 2026`）。 */
export function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], DATE).format(date);
}

/**
 * 日時（例: `9月30日 14:05` / `Sep 30, 2:05 PM`）。
 * `now` と同じ年なら年を省き、違う年なら付ける（書き出し履歴など、最近の日時が並ぶ所向け）。
 */
export function formatDateTime(ms: number, locale: Locale, now: number = Date.now()): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    ...TIME,
  }).format(d);
}
