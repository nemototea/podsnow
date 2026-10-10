/**
 * 番組画面に出す番組情報の整形（Issue #259、REQUIREMENTS.md FR-SHOW-3a）。
 *
 * 取り込んだ値（RSS 由来）をそのまま画面に出せる形にする純粋関数だけを置く。
 * 表示名への翻訳（カテゴリー・言語）は UI 層（`src/i18n/`）の仕事。
 */
import type { PodcastCategory } from './feed';

/** 番組の Web サイト。`href` は開く URL、`label` は画面に出す短い形（ホスト名とパス）。 */
export interface ShowWebsite {
  href: string;
  label: string;
}

/**
 * `shows.website_url` を、押して開ける形にする。
 *
 * 取り込んだ値は外部の文字列なので、http / https 以外（`javascript:` や他のアプリの scheme）は開かない。
 * スキームの無い値（`example.com`）は https を補う。開けない値は null（画面に出さない）。
 */
export function showWebsite(raw: string): ShowWebsite | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  const m = /^(https?):\/\/([^/?#@]+)([^?#]*)/i.exec(withScheme);
  if (!m) return null;
  const host = m[2]!.toLowerCase().replace(/^www\./, '');
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(host) || !host.includes('.')) return null;
  const path = m[3]!.replace(/\/+$/, '');
  return { href: withScheme, label: host + path };
}

/**
 * カテゴリーの並び（`show_categories`、先頭が主カテゴリー）を、画面に出す名前の並びにする。
 * 主と副を出現順に平らにし、同じ名前は 1 度だけ（`Society & Culture` の副が 2 つあっても主は 1 回）。
 */
export function categoryNames(rows: readonly PodcastCategory[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    for (const name of [r.category, r.subcategory]) {
      const v = name.trim();
      if (v && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

/** 言語コード（`ja`、`en-us`）の主の部分（`ja`、`en`）。空なら空。 */
export function primaryLanguage(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}
