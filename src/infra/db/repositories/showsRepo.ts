import type { SqlExecutor, SqlRow } from '../executor';

export interface ShowRow extends SqlRow {
  id: string;
  name: string;
  description: string;
  author: string;
  cover_path: string | null;
  default_season: number;
  next_episode_number: number;
  default_export_preset: string | null;
}

export interface ShowLayoutRow extends SqlRow {
  show_id: string;
  opening_asset_id: string | null;
  ending_asset_id: string | null;
  bgm_asset_id: string | null;
  bgm_gain_db: number;
  bgm_duck_db: number;
  opening_gain_db: number;
  ending_gain_db: number;
}

export interface TemplateRow extends SqlRow {
  id: string;
  show_id: string;
  body: string;
  is_default: number;
}

/** MVP は 1 Show 固定。無ければ作って返す（FR-SHOW-1）。 */
export async function ensureDefaultShow(
  db: SqlExecutor,
  newId: () => string,
  now: number,
): Promise<ShowRow> {
  const existing = await db.get<ShowRow>(
    'SELECT * FROM shows WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1',
  );
  if (existing) return existing;
  const id = newId();
  await db.transaction(async () => {
    await db.run('INSERT INTO shows (id, name, created_at, updated_at) VALUES (?,?,?,?)', [
      id,
      'マイポッドキャスト',
      now,
      now,
    ]);
    await db.run('INSERT INTO show_layout (show_id) VALUES (?)', [id]);
    await db.run(
      'INSERT INTO description_templates (id, show_id, body, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      [newId(), id, DEFAULT_TEMPLATE, 1, now, now],
    );
  });
  return (await db.get<ShowRow>('SELECT * FROM shows WHERE id = ?', [id]))!;
}

export const DEFAULT_TEMPLATE = `{{topics}}

――――――
Podcast: {{show_name}}
感想は #podsnow まで`;

export async function getShow(db: SqlExecutor, id: string): Promise<ShowRow | null> {
  return db.get<ShowRow>('SELECT * FROM shows WHERE id = ?', [id]);
}

export async function updateShow(
  db: SqlExecutor,
  id: string,
  patch: Partial<{
    name: string;
    description: string;
    author: string;
    coverPath: string | null;
    defaultSeason: number;
    defaultExportPreset: string;
  }>,
  now: number,
): Promise<void> {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    vals.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    vals.push(patch.description);
  }
  if (patch.author !== undefined) {
    sets.push('author = ?');
    vals.push(patch.author);
  }
  if (patch.coverPath !== undefined) {
    sets.push('cover_path = ?');
    vals.push(patch.coverPath);
  }
  if (patch.defaultSeason !== undefined) {
    sets.push('default_season = ?');
    vals.push(patch.defaultSeason);
  }
  if (patch.defaultExportPreset !== undefined) {
    sets.push('default_export_preset = ?');
    vals.push(patch.defaultExportPreset);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  vals.push(now);
  vals.push(id);
  await db.run(`UPDATE shows SET ${sets.join(', ')} WHERE id = ?`, vals);
}

export async function getLayout(db: SqlExecutor, showId: string): Promise<ShowLayoutRow> {
  const r = await db.get<ShowLayoutRow>('SELECT * FROM show_layout WHERE show_id = ?', [showId]);
  if (r) return r;
  await db.run('INSERT INTO show_layout (show_id) VALUES (?)', [showId]);
  return (await db.get<ShowLayoutRow>('SELECT * FROM show_layout WHERE show_id = ?', [showId]))!;
}

export async function updateLayout(
  db: SqlExecutor,
  showId: string,
  patch: Partial<{
    openingAssetId: string | null;
    endingAssetId: string | null;
    bgmAssetId: string | null;
    bgmGainDb: number;
    bgmDuckDb: number;
    openingGainDb: number;
    endingGainDb: number;
  }>,
): Promise<void> {
  await getLayout(db, showId);
  const map: Record<string, string> = {
    openingAssetId: 'opening_asset_id',
    endingAssetId: 'ending_asset_id',
    bgmAssetId: 'bgm_asset_id',
    bgmGainDb: 'bgm_gain_db',
    bgmDuckDb: 'bgm_duck_db',
    openingGainDb: 'opening_gain_db',
    endingGainDb: 'ending_gain_db',
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
  vals.push(showId);
  await db.run(`UPDATE show_layout SET ${sets.join(', ')} WHERE show_id = ?`, vals);
}

export async function getDefaultTemplate(
  db: SqlExecutor,
  showId: string,
): Promise<TemplateRow | null> {
  return db.get<TemplateRow>(
    'SELECT * FROM description_templates WHERE show_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1',
    [showId],
  );
}

export async function updateTemplate(
  db: SqlExecutor,
  id: string,
  body: string,
  now: number,
): Promise<void> {
  await db.run('UPDATE description_templates SET body = ?, updated_at = ? WHERE id = ?', [
    body,
    now,
    id,
  ]);
}
