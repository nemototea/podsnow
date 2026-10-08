// 初期スキーマ。DATA_MODEL.md §4 に対応する。
// 変更は新しい移行ファイルで行い、このファイルは編集しない（DATA_MODEL.md §8）。
export const MIGRATION_0001_INIT = `
CREATE TABLE shows (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  cover_path TEXT,
  default_season INTEGER NOT NULL DEFAULT 1,
  next_episode_number INTEGER NOT NULL DEFAULT 1,
  default_export_preset TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE description_templates (
  id TEXT PRIMARY KEY NOT NULL,
  show_id TEXT NOT NULL REFERENCES shows(id),
  body TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_description_templates_show ON description_templates(show_id);

CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL,
  show_id TEXT NOT NULL REFERENCES shows(id),
  kind TEXT NOT NULL CHECK (kind IN ('opening','ending','jingle','sfx','bgm')),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  original_filename TEXT,
  duration_smp INTEGER NOT NULL,
  sample_rate INTEGER NOT NULL DEFAULT 48000,
  channels INTEGER NOT NULL DEFAULT 1,
  peaks_path TEXT,
  default_gain_db REAL NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_assets_show_kind ON assets(show_id, kind, sort_order);

CREATE TABLE show_layout (
  show_id TEXT PRIMARY KEY NOT NULL REFERENCES shows(id),
  opening_asset_id TEXT REFERENCES assets(id),
  ending_asset_id TEXT REFERENCES assets(id),
  bgm_asset_id TEXT REFERENCES assets(id),
  bgm_gain_db REAL NOT NULL DEFAULT -14,
  bgm_duck_db REAL NOT NULL DEFAULT -10,
  opening_gain_db REAL NOT NULL DEFAULT 0,
  ending_gain_db REAL NOT NULL DEFAULT 0
);

CREATE TABLE episodes (
  id TEXT PRIMARY KEY NOT NULL,
  show_id TEXT NOT NULL REFERENCES shows(id),
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  description_suggestion TEXT,
  episode_number INTEGER NOT NULL,
  season INTEGER NOT NULL DEFAULT 1,
  recorded_at INTEGER,
  publish_planned_at INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','exported')),
  last_opened_at INTEGER,
  playhead_smp INTEGER NOT NULL DEFAULT 0,
  undo_cursor INTEGER NOT NULL DEFAULT 0,
  sound_settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_episodes_show ON episodes(show_id, deleted_at, last_opened_at);

CREATE TABLE takes (
  id TEXT PRIMARY KEY NOT NULL,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('recording','ready','orphaned','recovered','failed')),
  sample_rate INTEGER NOT NULL DEFAULT 48000,
  channels INTEGER NOT NULL DEFAULT 1,
  bit_depth INTEGER NOT NULL DEFAULT 16,
  input_label TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_smp INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_takes_episode ON takes(episode_id, deleted_at);
CREATE INDEX idx_takes_status ON takes(status);

CREATE TABLE take_segments (
  id TEXT PRIMARY KEY NOT NULL,
  take_id TEXT NOT NULL REFERENCES takes(id),
  seq INTEGER NOT NULL,
  path TEXT NOT NULL,
  offset_smp INTEGER NOT NULL DEFAULT 0,
  duration_smp INTEGER,
  header_valid INTEGER NOT NULL DEFAULT 0,
  reason_closed TEXT CHECK (reason_closed IN ('stop','interruption','route_change','error','disk_low','crash_recovered')),
  peaks_path TEXT,
  UNIQUE (take_id, seq)
);

CREATE TABLE voice_segments (
  id TEXT PRIMARY KEY NOT NULL,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  position INTEGER NOT NULL,
  take_id TEXT NOT NULL REFERENCES takes(id),
  src_start_smp INTEGER NOT NULL,
  src_end_smp INTEGER NOT NULL,
  gain_db REAL NOT NULL DEFAULT 0,
  fade_in_smp INTEGER NOT NULL DEFAULT 0,
  fade_out_smp INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  CHECK (src_end_smp > src_start_smp)
);
CREATE INDEX idx_voice_segments_episode ON voice_segments(episode_id, position);

CREATE TABLE overlay_clips (
  id TEXT PRIMARY KEY NOT NULL,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  kind TEXT NOT NULL CHECK (kind IN ('opening','ending','jingle','sfx','bgm')),
  anchor_type TEXT NOT NULL CHECK (anchor_type IN ('source','timeline_start','timeline_end','timeline_abs')),
  anchor_take_id TEXT REFERENCES takes(id),
  anchor_smp INTEGER NOT NULL DEFAULT 0,
  src_start_smp INTEGER NOT NULL DEFAULT 0,
  src_end_smp INTEGER,
  gain_db REAL NOT NULL DEFAULT 0,
  fade_in_smp INTEGER NOT NULL DEFAULT 0,
  fade_out_smp INTEGER NOT NULL DEFAULT 0,
  duck INTEGER NOT NULL DEFAULT 0,
  loop INTEGER NOT NULL DEFAULT 0,
  end_mode TEXT NOT NULL DEFAULT 'asset_end' CHECK (end_mode IN ('asset_end','timeline_end','fixed')),
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_overlay_clips_episode ON overlay_clips(episode_id);

CREATE TABLE markers (
  id TEXT PRIMARY KEY NOT NULL,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  take_id TEXT NOT NULL REFERENCES takes(id),
  src_smp INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'edit_point' CHECK (kind IN ('edit_point','mistake','interruption','route_change','topic')),
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_markers_episode ON markers(episode_id);
CREATE INDEX idx_markers_take ON markers(take_id, src_smp);

CREATE TABLE topics (
  id TEXT PRIMARY KEY NOT NULL,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  position INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  checked_at INTEGER,
  checked_take_id TEXT REFERENCES takes(id),
  checked_src_smp INTEGER
);
CREATE INDEX idx_topics_episode ON topics(episode_id, position);

CREATE TABLE edit_ops (
  id TEXT PRIMARY KEY NOT NULL,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  seq INTEGER NOT NULL,
  label TEXT NOT NULL,
  op TEXT NOT NULL,
  group_key TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (episode_id, seq)
);

CREATE TABLE exports (
  id TEXT PRIMARY KEY NOT NULL,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  format TEXT NOT NULL CHECK (format IN ('m4a','wav','mp3','flac')),
  preset TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('queued','rendering','encoding','done','failed','cancelled')),
  progress REAL NOT NULL DEFAULT 0,
  path TEXT,
  bytes INTEGER,
  duration_smp INTEGER NOT NULL DEFAULT 0,
  measured_lufs REAL,
  measured_true_peak REAL,
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX idx_exports_episode ON exports(episode_id, created_at);

CREATE TABLE transcripts (
  id TEXT PRIMARY KEY NOT NULL,
  take_id TEXT NOT NULL REFERENCES takes(id),
  provider TEXT NOT NULL,
  language TEXT,
  segments TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_transcripts_take ON transcripts(take_id);

CREATE TABLE recovery_journal (
  id TEXT PRIMARY KEY NOT NULL,
  take_id TEXT NOT NULL REFERENCES takes(id),
  segment_id TEXT NOT NULL REFERENCES take_segments(id),
  state TEXT NOT NULL CHECK (state IN ('open','closed')),
  last_heartbeat_at INTEGER NOT NULL,
  last_known_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_recovery_journal_state ON recovery_journal(state);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;
