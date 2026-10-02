import type { EpisodeRow } from '@/infra/db/repositories/episodesRepo';

/** 書き出しタブの「エピソードの詳細」の入力中の値（すべて文字列のまま持つ）。 */
export interface DetailsDraft {
  title: string;
  description: string;
  episodeNumber: string;
  season: string;
  /** `YYYY-MM-DD`。未設定は空文字。 */
  recordedAt: string;
}

export interface DetailsPatch {
  title?: string;
  description?: string;
  episodeNumber?: number;
  season?: number;
  recordedAt?: number | null;
}

type EpisodeDetails = Pick<
  EpisodeRow,
  'title' | 'description' | 'episode_number' | 'season' | 'recorded_at'
>;

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateInput(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 空なら null、読めなければ undefined（端末の現地時刻の 0 時）。 */
export function fromDateInput(s: string): number | null | undefined {
  const v = s.trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(y, mo, day);
  // 2026-02-31 のような繰り上がりは読めない日付として扱う
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return undefined;
  return d.getTime();
}

export function draftFromEpisode(e: EpisodeDetails): DetailsDraft {
  return {
    title: e.title,
    description: e.description,
    episodeNumber: String(e.episode_number),
    season: String(e.season),
    recordedAt: toDateInput(e.recorded_at),
  };
}

function positiveInt(s: string): number | null {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 自動保存で DB に書く差分（Issue #167）。変わった項目だけを返し、何も無ければ null。
 * 読めない値（話数・シーズンが 1 未満や数字でない、日付の形が違う）はその項目だけ保存しない。
 */
export function detailsPatch(draft: DetailsDraft, saved: EpisodeDetails): DetailsPatch | null {
  const patch: DetailsPatch = {};
  const title = draft.title.trim();
  if (title !== saved.title) patch.title = title;
  if (draft.description !== saved.description) patch.description = draft.description;
  const num = positiveInt(draft.episodeNumber);
  if (num !== null && num !== saved.episode_number) patch.episodeNumber = num;
  const sea = positiveInt(draft.season);
  if (sea !== null && sea !== saved.season) patch.season = sea;
  const rec = fromDateInput(draft.recordedAt);
  if (rec !== undefined && toDateInput(rec) !== toDateInput(saved.recorded_at)) {
    patch.recordedAt = rec;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** 保存した差分を、手元に持っている保存済みの値へ反映する（次の差分を正しく取るため）。 */
export function applyDetailsPatch<T extends EpisodeDetails>(saved: T, patch: DetailsPatch): T {
  return {
    ...saved,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.episodeNumber !== undefined ? { episode_number: patch.episodeNumber } : {}),
    ...(patch.season !== undefined ? { season: patch.season } : {}),
    ...(patch.recordedAt !== undefined ? { recorded_at: patch.recordedAt } : {}),
  };
}
