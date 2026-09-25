import type {
  ExternalIdProvider,
  PodcastCategory,
  PodcastFunding,
  ShowType,
} from '@/domain/podcast/feed';

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
  // 以下は Podcast RSS の規格に対応する列（DATA_MODEL.md §4.1、0004）
  website_url: string;
  language: string;
  /** 0 / 1 */
  explicit: number;
  show_type: ShowType;
  copyright: string;
  owner_name: string;
  owner_email: string;
  /** 0 / 1 */
  complete: number;
  /** `podcast:locked`（0 / 1）。自前配信の RSS に yes で出し、他のホスティングへの無断の取り込みを断る */
  locked: number;
  feed_url: string | null;
  podcast_guid: string | null;
  cover_source_url: string | null;
  feed_imported_at: number | null;
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

/** 初回起動時にだけ使う既定値。文言は UI 層が i18n から渡す（Issue #80）。 */
export interface ShowSeed {
  name: string;
  descriptionTemplate: string;
}

/**
 * MVP は 1 Show 固定。無ければ `seed` で作って返す（FR-SHOW-1）。
 * 既にあれば `seed` は使わない（既存の行はユーザーのデータ）。
 */
export async function ensureDefaultShow(
  db: SqlExecutor,
  newId: () => string,
  now: number,
  seed: ShowSeed,
): Promise<ShowRow> {
  const existing = await db.get<ShowRow>(
    'SELECT * FROM shows WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1',
  );
  if (existing) return existing;
  const id = newId();
  await db.transaction(async () => {
    await db.run('INSERT INTO shows (id, name, created_at, updated_at) VALUES (?,?,?,?)', [
      id,
      seed.name,
      now,
      now,
    ]);
    await db.run('INSERT INTO show_layout (show_id) VALUES (?)', [id]);
    await db.run(
      'INSERT INTO description_templates (id, show_id, body, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      [newId(), id, seed.descriptionTemplate, 1, now, now],
    );
  });
  return (await db.get<ShowRow>('SELECT * FROM shows WHERE id = ?', [id]))!;
}

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
    websiteUrl: string;
    language: string;
    explicit: boolean;
    showType: ShowType;
    copyright: string;
    ownerName: string;
    ownerEmail: string;
    complete: boolean;
    locked: boolean;
    feedUrl: string | null;
    podcastGuid: string | null;
    coverSourceUrl: string | null;
    feedImportedAt: number | null;
  }>,
  now: number,
): Promise<void> {
  const map: Record<string, string> = {
    name: 'name',
    description: 'description',
    author: 'author',
    coverPath: 'cover_path',
    defaultSeason: 'default_season',
    defaultExportPreset: 'default_export_preset',
    websiteUrl: 'website_url',
    language: 'language',
    explicit: 'explicit',
    showType: 'show_type',
    copyright: 'copyright',
    ownerName: 'owner_name',
    ownerEmail: 'owner_email',
    complete: 'complete',
    locked: 'locked',
    feedUrl: 'feed_url',
    podcastGuid: 'podcast_guid',
    coverSourceUrl: 'cover_source_url',
    feedImportedAt: 'feed_imported_at',
  };
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, col] of Object.entries(map)) {
    const v = (patch as Record<string, string | number | boolean | null | undefined>)[k];
    if (v === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
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

export interface ShowCategoryRow extends SqlRow {
  id: string;
  show_id: string;
  position: number;
  category: string;
  subcategory: string;
}

export interface ShowFundingRow extends SqlRow {
  id: string;
  show_id: string;
  position: number;
  url: string;
  label: string;
}

/** `itunes:category` の並び（DATA_MODEL.md §4.1.1）。先頭が主カテゴリー。 */
export async function listCategories(db: SqlExecutor, showId: string): Promise<ShowCategoryRow[]> {
  return db.all<ShowCategoryRow>(
    'SELECT * FROM show_categories WHERE show_id = ? ORDER BY position',
    [showId],
  );
}

/**
 * カテゴリーを丸ごと置き換える。取り込みと番組設定の保存はどちらも「全体の上書き」なので差分は取らない。
 * トランザクションは呼び出し側で張る（`saveOutline` と同じ）。
 */
export async function replaceCategories(
  db: SqlExecutor,
  showId: string,
  categories: readonly PodcastCategory[],
  newId: () => string,
): Promise<void> {
  await db.run('DELETE FROM show_categories WHERE show_id = ?', [showId]);
  let position = 0;
  for (const c of categories) {
    await db.run(
      'INSERT INTO show_categories (id, show_id, position, category, subcategory) VALUES (?,?,?,?,?)',
      [newId(), showId, position++, c.category, c.subcategory],
    );
  }
}

/** `podcast:funding` の並び（DATA_MODEL.md §4.1.2）。 */
export async function listFunding(db: SqlExecutor, showId: string): Promise<ShowFundingRow[]> {
  return db.all<ShowFundingRow>('SELECT * FROM show_funding WHERE show_id = ? ORDER BY position', [
    showId,
  ]);
}

/** 支援リンクを丸ごと置き換える。トランザクションは呼び出し側で張る。 */
export async function replaceFunding(
  db: SqlExecutor,
  showId: string,
  funding: readonly PodcastFunding[],
  newId: () => string,
): Promise<void> {
  await db.run('DELETE FROM show_funding WHERE show_id = ?', [showId]);
  let position = 0;
  for (const f of funding) {
    await db.run(
      'INSERT INTO show_funding (id, show_id, position, url, label) VALUES (?,?,?,?,?)',
      [newId(), showId, position++, f.url, f.label],
    );
  }
}

/** 外部サービスでの番組 ID（DATA_MODEL.md §4.1.3）。PodsNow の `shows.id` とは混ぜない。 */
export async function getExternalId(
  db: SqlExecutor,
  showId: string,
  provider: ExternalIdProvider,
): Promise<string | null> {
  const r = await db.get<{ external_id: string }>(
    'SELECT external_id FROM show_external_ids WHERE show_id = ? AND provider = ?',
    [showId, provider],
  );
  return r?.external_id ?? null;
}

export async function setExternalId(
  db: SqlExecutor,
  showId: string,
  provider: ExternalIdProvider,
  externalId: string,
  now: number,
): Promise<void> {
  await db.run(
    `INSERT INTO show_external_ids (show_id, provider, external_id, updated_at) VALUES (?,?,?,?)
     ON CONFLICT (show_id, provider) DO UPDATE SET external_id = excluded.external_id, updated_at = excluded.updated_at`,
    [showId, provider, externalId, now],
  );
}
