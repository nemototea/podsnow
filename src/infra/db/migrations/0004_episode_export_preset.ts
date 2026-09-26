// 書き出しプリセットの選択をエピソードごとに覚える（Issue #136 / REQUIREMENTS.md FR-EXP-3）。
// DATA_MODEL.md §4.1 / §4.5.1 に対応する。
//
// episodes.export_preset は NULL = 選んだことがない（設定の export.defaultPreset で開く）。
// 既存の回は NULL から始める。
//
// shows.default_export_preset は UI からも読まれておらず、設定の既定と二重の真実になるので落とす。
// DATA_MODEL.md §8 の「旧列放置」の例外（0.1.0 は未公開。0003 と同じ理由）。
// DROP COLUMN は SQLite 3.35 以降【確認済み】(https://www.sqlite.org/lang_altertable.html)。
export const MIGRATION_0004_EPISODE_EXPORT_PRESET = `
ALTER TABLE episodes ADD COLUMN export_preset TEXT
  CHECK (export_preset IS NULL OR export_preset IN ('podcast','high','wav','custom'));

ALTER TABLE shows DROP COLUMN default_export_preset;
`;
