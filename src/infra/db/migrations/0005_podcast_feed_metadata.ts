// Podcast RSS の規格（RSS 2.0 + iTunes 名前空間 + Podcast 名前空間）に合わせた番組・回の情報と、
// RSS から取り込んだ配信済みの回（feed_episodes）。
// DATA_MODEL.md §4.1 / §4.1.1〜§4.1.3 / §4.5 / §4.17、REQUIREMENTS.md FR-SHOW-6〜10、Issue #101 に対応する。
//
// 既存の行はそのまま残る。新しい列はすべて既定値つき（または NULL 可）なので、INSERT 側の変更は要らない。
// episodes.guid だけは既存行に id を入れる。guid は一度決めたら変えない値なので、作成時の id を使う。
export const MIGRATION_0005_PODCAST_FEED_METADATA = `
ALTER TABLE shows ADD COLUMN website_url TEXT NOT NULL DEFAULT '';
ALTER TABLE shows ADD COLUMN language TEXT NOT NULL DEFAULT '';
ALTER TABLE shows ADD COLUMN explicit INTEGER NOT NULL DEFAULT 0 CHECK (explicit IN (0,1));
ALTER TABLE shows ADD COLUMN show_type TEXT NOT NULL DEFAULT 'episodic' CHECK (show_type IN ('episodic','serial'));
ALTER TABLE shows ADD COLUMN copyright TEXT NOT NULL DEFAULT '';
ALTER TABLE shows ADD COLUMN owner_name TEXT NOT NULL DEFAULT '';
ALTER TABLE shows ADD COLUMN owner_email TEXT NOT NULL DEFAULT '';
ALTER TABLE shows ADD COLUMN complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0,1));
ALTER TABLE shows ADD COLUMN locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1));
ALTER TABLE shows ADD COLUMN feed_url TEXT;
ALTER TABLE shows ADD COLUMN podcast_guid TEXT;
ALTER TABLE shows ADD COLUMN cover_source_url TEXT;
ALTER TABLE shows ADD COLUMN feed_imported_at INTEGER;

CREATE TABLE show_categories (
  id TEXT PRIMARY KEY NOT NULL,
  show_id TEXT NOT NULL REFERENCES shows(id),
  position INTEGER NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_show_categories_show ON show_categories(show_id, position);

CREATE TABLE show_funding (
  id TEXT PRIMARY KEY NOT NULL,
  show_id TEXT NOT NULL REFERENCES shows(id),
  position INTEGER NOT NULL,
  url TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_show_funding_show ON show_funding(show_id, position);

CREATE TABLE show_external_ids (
  show_id TEXT NOT NULL REFERENCES shows(id),
  provider TEXT NOT NULL CHECK (provider IN ('apple_podcasts','podcast_index')),
  external_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (show_id, provider)
);

ALTER TABLE episodes ADD COLUMN guid TEXT;
UPDATE episodes SET guid = id WHERE guid IS NULL;
CREATE INDEX idx_episodes_guid ON episodes(show_id, guid);
ALTER TABLE episodes ADD COLUMN episode_type TEXT NOT NULL DEFAULT 'full' CHECK (episode_type IN ('full','trailer','bonus'));
ALTER TABLE episodes ADD COLUMN explicit INTEGER CHECK (explicit IS NULL OR explicit IN (0,1));
ALTER TABLE episodes ADD COLUMN website_url TEXT NOT NULL DEFAULT '';
ALTER TABLE episodes ADD COLUMN published_at INTEGER;

CREATE TABLE feed_episodes (
  id TEXT PRIMARY KEY NOT NULL,
  show_id TEXT NOT NULL REFERENCES shows(id),
  guid TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  published_at INTEGER,
  enclosure_url TEXT,
  enclosure_length INTEGER,
  enclosure_type TEXT,
  duration_smp INTEGER,
  episode_number INTEGER,
  season INTEGER,
  episode_type TEXT NOT NULL DEFAULT 'full' CHECK (episode_type IN ('full','trailer','bonus')),
  explicit INTEGER CHECK (explicit IS NULL OR explicit IN (0,1)),
  website_url TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  episode_id TEXT REFERENCES episodes(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (show_id, guid)
);
CREATE INDEX idx_feed_episodes_show ON feed_episodes(show_id, published_at);
`;
