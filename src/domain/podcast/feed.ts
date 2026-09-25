/**
 * Podcast RSS の規格に沿った番組・回の情報（DATA_MODEL.md §4.1 / §4.5 / §4.17、Issue #101）。
 *
 * 対象の規格: RSS 2.0 + iTunes 名前空間（`itunes:`）+ Podcast 名前空間（`podcast:`）。
 * 値の範囲は Podcast Standards Project の PSP-1 に従う。
 * https://github.com/Podcast-Standards-Project/PSP-1-Podcast-RSS-Specification
 *
 * ここには「取り込んだ文字列を DB に入れられる値へ正規化する」純粋関数だけを置く。
 * XML の解析と通信は services / infra の仕事。
 */
import { SAMPLE_RATE, smp, type Smp } from '../time';

/** `itunes:type`。既定は episodic（新しい回から並べる）。serial は古い回から並べ、話数が必須。 */
export const SHOW_TYPES = ['episodic', 'serial'] as const;
export type ShowType = (typeof SHOW_TYPES)[number];

/** `itunes:episodeType`。既定は full。 */
export const EPISODE_TYPES = ['full', 'trailer', 'bonus'] as const;
export type EpisodeType = (typeof EPISODE_TYPES)[number];

/** 番組の外部 ID の発行元（`show_external_ids.provider`）。 */
export const EXTERNAL_ID_PROVIDERS = ['apple_podcasts', 'podcast_index'] as const;
export type ExternalIdProvider = (typeof EXTERNAL_ID_PROVIDERS)[number];

/** `itunes:category`。Apple の分類名（英語の `text` 属性値）をそのまま持つ。表示名への変換は UI 層。 */
export interface PodcastCategory {
  category: string;
  /** 入れ子の `itunes:category`。無ければ空文字。 */
  subcategory: string;
}

/** `podcast:funding`。 */
export interface PodcastFunding {
  url: string;
  label: string;
}

/** channel 要素から取り出す番組の情報。空の要素は空文字 / null。 */
export interface PodcastShowMeta {
  title: string;
  description: string;
  /** `itunes:author` */
  author: string;
  /** `link` */
  websiteUrl: string;
  /** `language`（ISO 639。例 `ja`, `en-us`）。小文字にそろえる */
  language: string;
  /** `itunes:image@href`。取得して `shows.cover_path` に保存する元 */
  imageUrl: string | null;
  categories: PodcastCategory[];
  explicit: boolean;
  showType: ShowType;
  copyright: string;
  ownerName: string;
  ownerEmail: string;
  /** `itunes:complete` が yes */
  complete: boolean;
  /** `atom:link rel="self"`。無ければ取得に使った URL を入れる */
  feedUrl: string;
  /** `podcast:guid` */
  podcastGuid: string | null;
  funding: PodcastFunding[];
}

/** item 要素から取り出す配信済みの回。 */
export interface PodcastFeedItem {
  /** `guid`。無い item は取り込まない（再取り込み時の突き合わせができないため） */
  guid: string;
  title: string;
  description: string;
  /** `pubDate`（Unix ms） */
  publishedAt: number | null;
  enclosureUrl: string | null;
  /** `enclosure@length`（バイト） */
  enclosureLength: number | null;
  enclosureType: string | null;
  durationSmp: Smp | null;
  episodeNumber: number | null;
  season: number | null;
  episodeType: EpisodeType;
  /** 無ければ null（番組の設定に従う） */
  explicit: boolean | null;
  websiteUrl: string;
  imageUrl: string | null;
}

export interface PodcastFeed {
  show: PodcastShowMeta;
  items: PodcastFeedItem[];
}

function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/**
 * `itunes:explicit`。規格上の値は true / false だが、古いフィードの yes / no / clean /
 * explicit も受け付ける。解釈できなければ null。
 */
export function parseExplicit(v: string | null | undefined): boolean | null {
  const s = norm(v);
  if (s === 'true' || s === 'yes' || s === 'explicit') return true;
  if (s === 'false' || s === 'no' || s === 'clean') return false;
  return null;
}

/** `itunes:type`。未知の値と欠落は episodic（規格の既定）。 */
export function parseShowType(v: string | null | undefined): ShowType {
  return norm(v) === 'serial' ? 'serial' : 'episodic';
}

/** `itunes:episodeType`。未知の値と欠落は full（規格の既定）。 */
export function parseEpisodeType(v: string | null | undefined): EpisodeType {
  const s = norm(v);
  return (EPISODE_TYPES as readonly string[]).includes(s) ? (s as EpisodeType) : 'full';
}

/** `itunes:complete` / `itunes:block` のように yes だけが意味を持つ要素。 */
export function parseYes(v: string | null | undefined): boolean {
  return norm(v) === 'yes';
}

/** `itunes:episode` / `itunes:season`。0 でない正の整数だけを受け付ける。 */
export function parsePositiveInt(v: string | null | undefined): number | null {
  const s = (v ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * `itunes:duration`。規格は秒数だが、実際のフィードには `HH:MM:SS` / `MM:SS` も多い。
 * 小数秒は許す。解釈できなければ null。
 */
export function parseItunesDuration(v: string | null | undefined): Smp | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const parts = s.split(':');
  if (parts.length > 3) return null;
  let sec = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const last = i === parts.length - 1;
    if (!(last ? /^\d+(\.\d+)?$/ : /^\d+$/).test(p)) return null;
    const n = Number(p);
    // 先頭以外の分・秒は 60 未満
    if (i > 0 && n >= 60) return null;
    sec = sec * 60 + n;
  }
  return smp(sec * SAMPLE_RATE);
}

/** `language`。前後の空白を落として小文字にそろえる（`ja-JP` → `ja-jp`）。 */
export function normalizeLanguage(v: string | null | undefined): string {
  return norm(v);
}
