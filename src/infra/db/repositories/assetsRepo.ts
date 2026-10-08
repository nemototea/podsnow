import type { SqlExecutor, SqlRow } from '../executor';

export type AssetKind = 'opening' | 'ending' | 'jingle' | 'sfx' | 'bgm';

export interface AssetRow extends SqlRow {
  id: string;
  show_id: string;
  kind: AssetKind;
  name: string;
  path: string;
  original_filename: string | null;
  duration_smp: number;
  sample_rate: number;
  channels: number;
  peaks_path: string | null;
  default_gain_db: number;
  is_favorite: number;
  sort_order: number;
}

export async function listAssets(db: SqlExecutor, showId: string): Promise<AssetRow[]> {
  return db.all<AssetRow>(
    'SELECT * FROM assets WHERE show_id = ? AND deleted_at IS NULL ORDER BY kind, is_favorite DESC, sort_order, created_at',
    [showId],
  );
}

export async function getAsset(db: SqlExecutor, id: string): Promise<AssetRow | null> {
  return db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', [id]);
}

export async function getAssetsByIds(db: SqlExecutor, ids: readonly string[]): Promise<AssetRow[]> {
  if (ids.length === 0) return [];
  const q = ids.map(() => '?').join(',');
  return db.all<AssetRow>(`SELECT * FROM assets WHERE id IN (${q})`, [...ids]);
}

export async function insertAsset(
  db: SqlExecutor,
  a: {
    id: string;
    showId: string;
    kind: AssetKind;
    name: string;
    path: string;
    originalFilename: string | null;
    durationSmp: number;
    sampleRate: number;
    channels: number;
    defaultGainDb: number;
    now: number;
  },
): Promise<void> {
  const so = await db.get<{ n: number }>(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM assets WHERE show_id = ? AND kind = ?',
    [a.showId, a.kind],
  );
  await db.run(
    'INSERT INTO assets (id, show_id, kind, name, path, original_filename, duration_smp, sample_rate, channels, default_gain_db, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      a.id,
      a.showId,
      a.kind,
      a.name,
      a.path,
      a.originalFilename,
      a.durationSmp,
      a.sampleRate,
      a.channels,
      a.defaultGainDb,
      so?.n ?? 0,
      a.now,
      a.now,
    ],
  );
}

export async function updateAsset(
  db: SqlExecutor,
  id: string,
  patch: Partial<{
    name: string;
    isFavorite: boolean;
    sortOrder: number;
    defaultGainDb: number;
    peaksPath: string;
  }>,
  now: number,
): Promise<void> {
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    vals.push(patch.name);
  }
  if (patch.isFavorite !== undefined) {
    sets.push('is_favorite = ?');
    vals.push(patch.isFavorite ? 1 : 0);
  }
  if (patch.sortOrder !== undefined) {
    sets.push('sort_order = ?');
    vals.push(patch.sortOrder);
  }
  if (patch.defaultGainDb !== undefined) {
    sets.push('default_gain_db = ?');
    vals.push(patch.defaultGainDb);
  }
  if (patch.peaksPath !== undefined) {
    sets.push('peaks_path = ?');
    vals.push(patch.peaksPath);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  vals.push(now);
  vals.push(id);
  await db.run(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`, vals);
}

export async function softDeleteAsset(db: SqlExecutor, id: string, now: number): Promise<void> {
  await db.run('UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
}
