import type { SqlExecutor, SqlRow } from '../executor';

export type EpisodeStatus = 'draft' | 'ready' | 'exported';

/** 書き出しプリセットのキー（DATA_MODEL.md §4.5.1）。列の CHECK 制約と揃える。 */
export const EPISODE_EXPORT_PRESETS = ['podcast', 'high', 'wav', 'custom'] as const;
export type EpisodeExportPreset = (typeof EPISODE_EXPORT_PRESETS)[number];

/** 保存値・バックアップ由来の値を検証する。知らない値は null（= 設定の既定）。 */
export function parseEpisodeExportPreset(v: unknown): EpisodeExportPreset | null {
  return typeof v === 'string' && (EPISODE_EXPORT_PRESETS as readonly string[]).includes(v)
    ? (v as EpisodeExportPreset)
    : null;
}

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
  /** 「音声を削除」を実行した時刻（FR-EP-4）。行と話数は残る。 */
  audio_purged_at: number | null;
  /** この回で最後に選んだ書き出しプリセット。NULL = 選んだことがない（DATA_MODEL.md §4.5.1）。 */
  export_preset: EpisodeExportPreset | null;
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

/**
 * 新規エピソードの話数（REQUIREMENTS.md §2.1.1 / FR-EP-6）。
 *
 * 採番用のカウンターは持たず、既存行から導出する。条件は「削除されていないこと」だけで、
 * `status` は見ない。これにより試用で作って消した回は番号を消費せず、消した番号が返る。
 */
export async function nextEpisodeNumber(db: SqlExecutor, showId: string): Promise<number> {
  const r = await db.get<{ n: number }>(
    'SELECT COALESCE(MAX(episode_number), 0) + 1 AS n FROM episodes WHERE show_id = ? AND deleted_at IS NULL',
    [showId],
  );
  return r?.n ?? 1;
}

/** 同じ Show に同じ話数の（削除されていない）エピソードがあるか。`exceptId` は自分自身の除外用。 */
export async function episodeNumberTaken(
  db: SqlExecutor,
  showId: string,
  episodeNumber: number,
  exceptId?: string,
): Promise<boolean> {
  const r = await db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM episodes WHERE show_id = ? AND episode_number = ? AND deleted_at IS NULL AND id != ?',
    [showId, episodeNumber, exceptId ?? ''],
  );
  return (r?.n ?? 0) > 0;
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
    exportPreset: EpisodeExportPreset | null;
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
    exportPreset: 'export_preset',
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

/**
 * 論理削除からの復元。削除トーストの Undo を待つ間に新規作成されると話数が衝突しうるので、
 * そのときだけ採番し直す（REQUIREMENTS.md §2.1.1 の受け入れ基準）。
 */
export async function restoreEpisode(
  db: SqlExecutor,
  id: string,
  now: number,
): Promise<{ episodeNumber: number; renumbered: boolean }> {
  return db.transaction(async () => {
    const ep = await getEpisode(db, id);
    if (!ep) throw new Error('episode not found');
    const taken = await episodeNumberTaken(db, ep.show_id, ep.episode_number, id);
    const episodeNumber = taken ? await nextEpisodeNumber(db, ep.show_id) : ep.episode_number;
    await db.run(
      'UPDATE episodes SET deleted_at = NULL, episode_number = ?, updated_at = ? WHERE id = ?',
      [episodeNumber, now, id],
    );
    return { episodeNumber, renumbered: taken };
  });
}

/**
 * 「音声を削除」の DB 側（FR-EP-4）。takes を論理削除し、`audio_purged_at` を立てる。
 * 行・話数・タイトル・概要・書き出し履歴は残す。ファイルの削除は呼び出し側（EpisodeService）。
 */
export async function markAudioPurged(db: SqlExecutor, id: string, now: number): Promise<void> {
  await db.run(
    'UPDATE takes SET deleted_at = ?, updated_at = ? WHERE episode_id = ? AND deleted_at IS NULL',
    [now, now, id],
  );
  await db.run('UPDATE episodes SET audio_purged_at = ?, updated_at = ? WHERE id = ?', [
    now,
    now,
    id,
  ]);
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
