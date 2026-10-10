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
 * 設定の「ストレージ」（FR-SET-6）。画面は DB と端末の空き容量にここを通して触る（Issue #259 で features から移した）。
 */
export class StorageService {
  constructor(
    private readonly deps: {
      db: SqlExecutor;
      /** 端末の空き容量（バイト）。読めなければ throw してよい。 */
      availableDiskBytes: () => number;
    },
  ) {}

  /**
   * 使用量の概算。ファイルを走査せず DB の長さから推定する
   * （16 bit PCM = duration × channels × 2 bytes + 44）。
   */
  async summarize(): Promise<StorageSummary> {
    const { db } = this.deps;
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

  /** 端末の空き容量。読めなければ 0（画面は「不明」と区別しない）。 */
  freeBytes(): number {
    try {
      return this.deps.availableDiskBytes();
    } catch {
      return 0;
    }
  }
}
