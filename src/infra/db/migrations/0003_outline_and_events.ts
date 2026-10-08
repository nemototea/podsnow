// トークテーマと台本（outline_items）、録音中の出来事（recording_events）、
// 番組のトークテーマのひな形（show_topic_template）。
// DATA_MODEL.md §4.2.1 / §4.10 / §4.11、REQUIREMENTS.md §2.2.1 に対応する。
//
// topics と markers はテーブルごと置き換える。DATA_MODEL.md §8 は「新列追加 → データ移送 →
// 旧列放置」を原則にしているが、これは公開済みのデータを守るための規則で、0.1.0 は未公開。
// 二重の真実（同じ内容が topics と outline_items の両方にある状態）を残すほうが害が大きいので、
// 移送したうえで旧テーブルを落とす。
//
// markers のうち edit_point / mistake / topic は移送しない:
//   - edit_point / mistake は機能ごと廃止（FR-REC-4 → 収録中の「言い直す」）
//   - topic は outline_items.recorded_take_id / recorded_src_smp が持つ（移送元は topics 側）
export const MIGRATION_0003_OUTLINE_AND_EVENTS = `
CREATE TABLE outline_items (
  id TEXT PRIMARY KEY NOT NULL,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  position INTEGER NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  recorded_take_id TEXT REFERENCES takes(id),
  recorded_src_smp INTEGER,
  done_at INTEGER
);
CREATE INDEX idx_outline_items_episode ON outline_items(episode_id, position);

INSERT INTO outline_items (id, episode_id, position, heading, body, recorded_take_id, recorded_src_smp, done_at)
  SELECT id, episode_id, position, text, '', checked_take_id, checked_src_smp, checked_at FROM topics;

DROP TABLE topics;

CREATE TABLE recording_events (
  id TEXT PRIMARY KEY NOT NULL,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  take_id TEXT NOT NULL REFERENCES takes(id),
  src_smp INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('interruption','route_change','disk_low')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_recording_events_episode ON recording_events(episode_id);
CREATE INDEX idx_recording_events_take ON recording_events(take_id, src_smp);

INSERT INTO recording_events (id, episode_id, take_id, src_smp, label, kind, created_at)
  SELECT id, episode_id, take_id, src_smp, label, kind, created_at
    FROM markers WHERE kind IN ('interruption','route_change');

DROP TABLE markers;

CREATE TABLE show_topic_template (
  id TEXT PRIMARY KEY NOT NULL,
  show_id TEXT NOT NULL REFERENCES shows(id),
  position INTEGER NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_show_topic_template_show ON show_topic_template(show_id, position);
`;
