import type { SqlExecutor } from '@/infra/db/executor';

export interface StorageSummary {
  /** 録音（Segment ファイル）の概算バイト数。 */
  recordingsBytes: number;
  /** 書き出しファイルの合計バイト数。 */
  exportsBytes: number;
  /** 書き出し済みエピソードの録音バイト数（整理候補）。 */
  exportedEpisodesRecordingsBytes: number;
}

/**
 * ストレージ使用量の概算（FR-SET-6）。ファイルを走査せず DB の長さから推定する
 * （16 bit PCM = duration × channels × 2 bytes + 44）。
 */
export async function summarizeStorage(db: SqlExecutor): Promise<StorageSummary> {
  const rec = await db.get<{ bytes: number | null }>(
    `SELECT SUM(COALESCE(s.duration_smp, 0) * t.channels * 2 + 44) AS bytes
     FROM take_segments s JOIN takes t ON t.id = s.take_id`,
  );
  const exported = await db.get<{ bytes: number | null }>(
    `SELECT SUM(COALESCE(s.duration_smp, 0) * t.channels * 2 + 44) AS bytes
     FROM take_segments s JOIN takes t ON t.id = s.take_id JOIN episodes e ON e.id = t.episode_id
     WHERE e.status = 'exported'`,
  );
  const ex = await db.get<{ bytes: number | null }>(
    `SELECT SUM(COALESCE(bytes, 0)) AS bytes FROM exports WHERE status = 'done'`,
  );
  return {
    recordingsBytes: rec?.bytes ?? 0,
    exportsBytes: ex?.bytes ?? 0,
    exportedEpisodesRecordingsBytes: exported?.bytes ?? 0,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024)
    return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
