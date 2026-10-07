/**
 * 話数・シーズンの初期値（REQUIREMENTS.md §2.1.1 / FR-EP-6、Issue #211）。副作用を持たない。
 *
 * 話数とシーズンは回ごとの任意の項目。新しく作る回（複製を含む）の初期値は、配信済みの回だけから決める:
 * 1. 基準の回 = 本編（`full`）で配信日のある回のうち、配信日が最新の回。同じ配信日なら話数の大きい方。
 * 2. 話数 = 基準の回の話数 + 1。シーズン = 基準の回と同じ。0 か空なら空（null）。
 *
 * 手元にだけある回は見ない（並行して作った回の番号が重なってもよい）。カウンターや番組ごとの設定は持たない。
 */
import type { EpisodeType } from '../podcast/feed';

/** 基準の回を選ぶのに使う、配信済みの回の項目。 */
export interface PublishedNumbering {
  publishedAt: number | null;
  episodeType: EpisodeType;
  episodeNumber: number | null;
  season: number | null;
}

export interface Numbering {
  episodeNumber: number | null;
  season: number | null;
}

/** 1 以上の整数だけを値として扱う（0・負・小数・NaN は「未設定」）。 */
function counted(n: number | null): number | null {
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
}

/** 基準の回（配信日が最新の本編）。無ければ null。 */
export function latestPublishedFull<T extends PublishedNumbering>(
  published: readonly T[],
): T | null {
  let best: T | null = null;
  for (const p of published) {
    if (p.episodeType !== 'full' || p.publishedAt === null) continue;
    if (
      best === null ||
      p.publishedAt > best.publishedAt! ||
      (p.publishedAt === best.publishedAt &&
        (counted(p.episodeNumber) ?? 0) > (counted(best.episodeNumber) ?? 0))
    ) {
      best = p;
    }
  }
  return best;
}

/** 新しい回の話数・シーズンの初期値。 */
export function initialNumbering(published: readonly PublishedNumbering[]): Numbering {
  const base = latestPublishedFull(published);
  if (!base) return { episodeNumber: null, season: null };
  const n = counted(base.episodeNumber);
  return { episodeNumber: n === null ? null : n + 1, season: counted(base.season) };
}

/**
 * 話数・シーズンの入力欄の値を読む（FR-META-1）。空か 0 は null（空として保存する）、
 * 1 以上の整数はその値、読めない値は undefined（その項目は保存しない）。
 */
export function parseNumberingInput(s: string): number | null | undefined {
  const v = s.trim();
  if (v === '') return null;
  if (!/^\d+$/.test(v)) return undefined;
  const n = Number.parseInt(v, 10);
  return n === 0 ? null : n;
}
