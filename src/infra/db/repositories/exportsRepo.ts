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
  /** 書き出したときの音の中身の指紋（DATA_MODEL.md §4.13）。0006 より前の行は NULL。 */
  source_fingerprint: string | null;
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
    sourceFingerprint: string | null;
    now: number;
  },
): Promise<void> {
  await db.run(
    'INSERT INTO exports (id, episode_id, format, preset, status, duration_smp, source_fingerprint, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [
      e.id,
      e.episodeId,
      e.format,
      JSON.stringify(e.preset),
      'queued',
      e.durationSmp,
      e.sourceFingerprint,
      e.now,
    ],
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
  r: {
    path: string;
    bytes: number;
    measuredLufs: number;
    measuredTruePeak: number;
    now: number;
    /**
     * 書き出せたが一部ができなかったときの AppErrorCode（例: `export_metadata_failed`）。
     * `done` の行の `error` は警告で、音声のファイルはある（DATA_MODEL.md §4.13）。
     */
    warning?: string | null;
  },
): Promise<void> {
  await db.run(
    'UPDATE exports SET status = ?, progress = 1, path = ?, bytes = ?, measured_lufs = ?, measured_true_peak = ?, error = ?, finished_at = ? WHERE id = ?',
    ['done', r.path, r.bytes, r.measuredLufs, r.measuredTruePeak, r.warning ?? null, r.now, id],
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

export async function getExport(db: SqlExecutor, id: string): Promise<ExportRow | null> {
  return db.get<ExportRow>('SELECT * FROM exports WHERE id = ?', [id]);
}

/** 書き出しの行を消す（Issue #152）。ファイルは呼び出し側が先に消す。 */
export async function deleteExportRow(db: SqlExecutor, id: string): Promise<void> {
  await db.run('DELETE FROM exports WHERE id = ?', [id]);
}

/** 進行中（ネイティブが書いている最中）の状態。これらの行は消さない。 */
export const RUNNING_EXPORT_STATUSES: readonly ExportStatus[] = ['queued', 'rendering', 'encoding'];

export function isExportRunning(status: ExportStatus): boolean {
  return RUNNING_EXPORT_STATUSES.includes(status);
}
