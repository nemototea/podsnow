import type { SqlExecutor, SqlRow } from '../executor';

export type ExportFormat = 'm4a' | 'wav' | 'mp3' | 'flac';
export type ExportStatus = 'queued' | 'rendering' | 'encoding' | 'done' | 'failed' | 'cancelled';

export interface ExportRow extends SqlRow {
  id: string;
  episode_id: string;
  format: ExportFormat;
  preset: string;
  status: ExportStatus;
  progress: number;
  path: string | null;
  bytes: number | null;
  duration_smp: number;
  measured_lufs: number | null;
  measured_true_peak: number | null;
  error: string | null;
  created_at: number;
  finished_at: number | null;
}

export async function insertExport(
  db: SqlExecutor,
  e: {
    id: string;
    episodeId: string;
    format: ExportFormat;
    preset: object;
    durationSmp: number;
    now: number;
  },
): Promise<void> {
  await db.run(
    'INSERT INTO exports (id, episode_id, format, preset, status, duration_smp, created_at) VALUES (?,?,?,?,?,?,?)',
    [e.id, e.episodeId, e.format, JSON.stringify(e.preset), 'queued', e.durationSmp, e.now],
  );
}

export async function updateExportProgress(
  db: SqlExecutor,
  id: string,
  status: ExportStatus,
  progress: number,
): Promise<void> {
  await db.run('UPDATE exports SET status = ?, progress = ? WHERE id = ?', [status, progress, id]);
}

export async function finishExport(
  db: SqlExecutor,
  id: string,
  r: { path: string; bytes: number; measuredLufs: number; measuredTruePeak: number; now: number },
): Promise<void> {
  await db.run(
    'UPDATE exports SET status = ?, progress = 1, path = ?, bytes = ?, measured_lufs = ?, measured_true_peak = ?, finished_at = ? WHERE id = ?',
    ['done', r.path, r.bytes, r.measuredLufs, r.measuredTruePeak, r.now, id],
  );
}

export async function failExport(
  db: SqlExecutor,
  id: string,
  status: 'failed' | 'cancelled',
  error: string | null,
  now: number,
): Promise<void> {
  await db.run('UPDATE exports SET status = ?, error = ?, finished_at = ? WHERE id = ?', [
    status,
    error,
    now,
    id,
  ]);
}

export async function listExports(db: SqlExecutor, episodeId: string): Promise<ExportRow[]> {
  return db.all<ExportRow>('SELECT * FROM exports WHERE episode_id = ? ORDER BY created_at DESC', [
    episodeId,
  ]);
}

/** 起動時: 進行中のまま残った書き出しを failed に倒す。 */
export async function failStaleExports(db: SqlExecutor, now: number): Promise<number> {
  const r = await db.run(
    // error 列には AppErrorCode を入れる。表示文言は UI 層が i18n から引く（Issue #80）。
    "UPDATE exports SET status = 'failed', error = 'export_app_terminated', finished_at = ? WHERE status IN ('queued','rendering','encoding')",
    [now],
  );
  return r.changes;
}
