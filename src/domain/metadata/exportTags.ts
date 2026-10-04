/**
 * 書き出したファイルに埋め込むメタデータの値（Issue #56、REQUIREMENTS.md FR-EXP-10）。
 *
 * M4A は iTunes 形式（`mp4Tags.ts`）、WAV は `LIST/INFO`（`riffInfo.ts`）に同じ値を書く。
 * 値の出どころは AUDIO_DESIGN.md §8.3。
 */
export interface ExportTags {
  /** エピソードのタイトル。空なら書かない。 */
  title: string | null;
  /** 番組の著者。空なら番組名。どちらも空なら書かない。 */
  artist: string | null;
  /** 番組名。空なら書かない。 */
  album: string | null;
  /** 話数。0 以下なら書かない。 */
  track: number | null;
  /**
   * 配信日時（無ければ配信予定）を、端末の時差つき ISO 8601 で（`2026-10-03T21:00:00+09:00`）。
   * WAV には先頭の日付（`YYYY-MM-DD`）だけを書く。無ければ書かない。
   */
  date: string | null;
  /** ジャンル。ポッドキャストの標準のジャンル名（ID3 の拡張ジャンル 186）で、訳さない。 */
  genre: string;
  /** 書いたアプリ。 */
  encoder: string;
}

export const EXPORT_GENRE = 'Podcast';

export interface ExportTagSource {
  title: string;
  episodeNumber: number;
  showName: string;
  author: string;
  /** Unix ms。 */
  publishedAt: number | null;
  /** Unix ms。 */
  publishPlannedAt: number | null;
  appVersion: string;
  /**
   * 日付を書くときの時差（分、UTC より進んでいれば正。日本は +540）。
   * services が端末の時差（`-Date#getTimezoneOffset()`）を渡す。
   */
  utcOffsetMinutes: number;
}

export function exportTags(src: ExportTagSource): ExportTags {
  const clean = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim() || null;
  const album = clean(src.showName);
  const when = src.publishedAt ?? src.publishPlannedAt;
  return {
    title: clean(src.title),
    artist: clean(src.author) ?? album,
    album,
    track: src.episodeNumber > 0 ? Math.trunc(src.episodeNumber) : null,
    date: when == null ? null : isoWithOffset(when, src.utcOffsetMinutes),
    genre: EXPORT_GENRE,
    encoder: `PodsNow ${src.appVersion}`,
  };
}

/** `2026-10-03T21:00:00+09:00`。秒未満は切り捨てる。 */
export function isoWithOffset(ms: number, offsetMinutes: number): string {
  const off = Math.trunc(offsetMinutes);
  const local = new Date(Math.floor(ms / 1000) * 1000 + off * 60_000).toISOString().slice(0, 19);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  const hh = String(Math.floor(a / 60)).padStart(2, '0');
  const mm = String(a % 60).padStart(2, '0');
  return `${local}${sign}${hh}:${mm}`;
}

/** 埋め込むアートワーク。 */
export interface CoverImage {
  kind: 'jpeg' | 'png';
  bytes: Uint8Array;
}

/** 先頭のバイトから画像の形式を見分ける。JPEG / PNG 以外は null（埋め込まない）。 */
export function coverImage(bytes: Uint8Array): CoverImage | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { kind: 'jpeg', bytes };
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= png.length && png.every((v, i) => b[i] === v)) return { kind: 'png', bytes };
  return null;
}
