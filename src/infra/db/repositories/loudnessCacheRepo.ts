import {
  parseLoudnessCache,
  upsertLoudnessCache,
  type LoudnessCacheEntry,
} from '@/domain/render/loudnessCache';

import type { SqlExecutor } from '../executor';

/** `episodes.loudness_cache`（DATA_MODEL.md §4.5、Issue #158）。 */
export async function getLoudnessCache(
  db: SqlExecutor,
  episodeId: string,
): Promise<LoudnessCacheEntry[]> {
  const row = await db.get<{ loudness_cache: string | null }>(
    'SELECT loudness_cache FROM episodes WHERE id = ?',
    [episodeId],
  );
  return parseLoudnessCache(row?.loudness_cache);
}

/** 測った結果を足す（同じチャンネル数の古い値は置き換える）。`updated_at` は変えない（キャッシュなので）。 */
export async function saveLoudnessMeasure(
  db: SqlExecutor,
  episodeId: string,
  entry: LoudnessCacheEntry,
): Promise<void> {
  const next = upsertLoudnessCache(await getLoudnessCache(db, episodeId), entry);
  await db.run('UPDATE episodes SET loudness_cache = ? WHERE id = ?', [
    JSON.stringify(next),
    episodeId,
  ]);
}
