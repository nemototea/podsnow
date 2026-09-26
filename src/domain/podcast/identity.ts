/**
 * 取り込もうとしている番組が、今の番組と同じかを判定する（docs/podcast-import-cases.md §5）。
 *
 * - `new`: 今の番組はまだ何も取り込んでいない
 * - `same`: 同じ番組（追加済み。読み込み直しは別の操作）
 * - `different`: 別の番組
 *
 * 上から順に比べ、最初に決まったものを採る: podcast:guid → Apple の番組 ID → RSS の URL → 回の guid の重なり。
 */
export type ShowIdentity = 'new' | 'same' | 'different';

export interface CurrentShowIdentity {
  imported: boolean;
  feedUrl: string | null;
  podcastGuid: string | null;
  appleId: string | null;
  /** 取り込み済みの配信済みの回の guid */
  episodeGuids: readonly string[];
}

export interface IncomingShowIdentity {
  /** 取得した URL・自己申告の URL・移転先など、この番組を指す URL の候補 */
  feedUrls: readonly string[];
  podcastGuid: string | null;
  appleId: string | null;
  episodeGuids: readonly string[];
}

/** 回の guid がこの割合以上重なれば同じ番組とみなす【仮説: しきい値】 */
export const GUID_OVERLAP_SAME = 0.5;

/** 比較用に URL をそろえる（スキームの違い・大文字小文字のホスト・末尾の / を無視）。 */
export function normalizeFeedUrl(url: string): string {
  const s = url.trim().replace(/^https?:\/\//i, '');
  const slash = s.indexOf('/');
  const host = (slash === -1 ? s : s.slice(0, slash)).toLowerCase();
  const rest = slash === -1 ? '' : s.slice(slash);
  return `${host}${rest}`.replace(/\/+$/, '');
}

export function judgeShowIdentity(
  current: CurrentShowIdentity,
  incoming: IncomingShowIdentity,
): ShowIdentity {
  if (!current.imported) return 'new';
  if (current.podcastGuid && incoming.podcastGuid) {
    return current.podcastGuid.trim().toLowerCase() === incoming.podcastGuid.trim().toLowerCase()
      ? 'same'
      : 'different';
  }
  if (current.appleId && incoming.appleId) {
    return current.appleId === incoming.appleId ? 'same' : 'different';
  }
  if (current.feedUrl) {
    const cur = normalizeFeedUrl(current.feedUrl);
    if (incoming.feedUrls.some((u) => u && normalizeFeedUrl(u) === cur)) return 'same';
  }
  if (current.episodeGuids.length === 0) return 'different';
  const incomingSet = new Set(incoming.episodeGuids);
  const overlap = current.episodeGuids.filter((g) => incomingSet.has(g)).length;
  return overlap / current.episodeGuids.length >= GUID_OVERLAP_SAME ? 'same' : 'different';
}
