import type { SqlExecutor, SqlRow } from '../executor';

export type EpisodeStatus = 'draft' | 'ready' | 'exported';

export interface EpisodeRow extends SqlRow {
  id: string;
  show_id: string;
  title: string;
  description: string;
  description_suggestion: string | null;
  episode_number: number;
  season: number;
  recorded_at: number | null;
  publish_planned_at: number | null;
  status: EpisodeStatus;
  last_opened_at: number | null;
  playhead_smp: number;
  undo_cursor: number;
  sound_settings: string;
  created_at: number;
  updated_at: number;
}

export interface EpisodeListItem extends EpisodeRow {
  duration_smp: number;
  take_count: number;
}

export async function listEpisodes(db: SqlExecutor, showId: string): Promise<EpisodeListItem[]> {
  return db.all<EpisodeListItem>(
    `SELECT e.*,
       COALESCE((SELECT SUM(v.src_end_smp - v.src_start_smp) FROM voice_segments v WHERE v.episode_id = e.id), 0) AS duration_smp,
       (SELECT COUNT(*) FROM takes t WHERE t.episode_id = e.id AND t.deleted_at IS NULL AND t.status IN ('ready','recovered')) AS take_count
     FROM episodes e WHERE e.show_id = ? AND e.deleted_at IS NULL
     ORDER BY e.episode_number DESC, e.created_at DESC`,
    [showId],
  );
}

export async function getEpisode(db: SqlExecutor, id: string): Promise<EpisodeRow | null> {
  return db.get<EpisodeRow>('SELECT * FROM episodes WHERE id = ?', [id]);
}

export async function insertEpisode(
  db: SqlExecutor,
  e: {
    id: string;
    showId: string;
    title: string;
    description: string;
    episodeNumber: number;
    season: number;
    now: number;
  },
): Promise<void> {
  await db.run(
    'INSERT INTO episodes (id, show_id, title, description, episode_number, season, recorded_at, last_opened_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [e.id, e.showId, e.title, e.description, e.episodeNumber, e.season, e.now, e.now, e.now, e.now],
  );
}

export async function updateEpisode(
  db: SqlExecutor,
  id: string,
  patch: Partial<{
    title: string;
    description: string;
    descriptionSuggestion: string | null;
    episodeNumber: number;
    season: number;
    recordedAt: number | null;
    publishPlannedAt: number | null;
    status: EpisodeStatus;
    lastOpenedAt: number;
    playheadSmp: number;
    soundSettings: string;
  }>,
  now: number,
): Promise<void> {
  const map: Record<string, string> = {
    title: 'title',
    description: 'description',
    descriptionSuggestion: 'description_suggestion',
    episodeNumber: 'episode_number',
    season: 'season',
    recordedAt: 'recorded_at',
    publishPlannedAt: 'publish_planned_at',
    status: 'status',
    lastOpenedAt: 'last_opened_at',
    playheadSmp: 'playhead_smp',
    soundSettings: 'sound_settings',
  };
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, col] of Object.entries(map)) {
    const v = (patch as Record<string, string | number | null | undefined>)[k];
    if (v !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(v);
    }
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  vals.push(now);
  vals.push(id);
  await db.run(`UPDATE episodes SET ${sets.join(', ')} WHERE id = ?`, vals);
}

export async function softDeleteEpisode(db: SqlExecutor, id: string, now: number): Promise<void> {
  await db.run('UPDATE episodes SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
}

export async function restoreEpisode(db: SqlExecutor, id: string, now: number): Promise<void> {
  await db.run('UPDATE episodes SET deleted_at = NULL, updated_at = ? WHERE id = ?', [now, id]);
}

/** 最近開いたエピソード（Home の「続き」）。 */
export async function getContinueEpisode(
  db: SqlExecutor,
  showId: string,
): Promise<EpisodeListItem | null> {
  const rows = await db.all<EpisodeListItem>(
    `SELECT e.*,
       COALESCE((SELECT SUM(v.src_end_smp - v.src_start_smp) FROM voice_segments v WHERE v.episode_id = e.id), 0) AS duration_smp,
       (SELECT COUNT(*) FROM takes t WHERE t.episode_id = e.id AND t.deleted_at IS NULL) AS take_count
     FROM episodes e WHERE e.show_id = ? AND e.deleted_at IS NULL AND e.status != 'exported'
     ORDER BY e.last_opened_at DESC NULLS LAST, e.created_at DESC LIMIT 1`,
    [showId],
  );
  return rows[0] ?? null;
}
