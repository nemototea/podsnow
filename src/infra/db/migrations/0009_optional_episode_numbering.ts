// 話数・シーズンを回ごとの任意の項目にする（Issue #211 / REQUIREMENTS.md §2.1.1）。DATA_MODEL.md §4.5 に対応する。
//
// episodes.episode_number / season は NOT NULL だったので、NULL 可の列へ置き換える。
// SQLite は列の NOT NULL を外せないので、新しい列を足して値を写し、旧列を落としてから名前を戻す。
// テーブルを作り直さないので、takes などからの外部キーに触れない。
// 既存の値はそのまま残す（0 は「未設定」なので NULL にする。新しい列は 1 以上だけを受け付ける）。
// DATA_MODEL.md §7 の「旧列放置」の例外（0.1.0 は未公開。旧列を残すと二重の真実になる。0004 と同じ）。
// DROP COLUMN は SQLite 3.35 以降、RENAME COLUMN は 3.25 以降【確認済み】(https://www.sqlite.org/lang_altertable.html)。
//
// shows.default_season はこの移行以降どこからも読み書きしない（列は NOT NULL DEFAULT 1 のまま残す）。
export const MIGRATION_0009_OPTIONAL_EPISODE_NUMBERING = `
ALTER TABLE episodes ADD COLUMN episode_number_v2 INTEGER
  CHECK (episode_number_v2 IS NULL OR episode_number_v2 > 0);
ALTER TABLE episodes ADD COLUMN season_v2 INTEGER
  CHECK (season_v2 IS NULL OR season_v2 > 0);
UPDATE episodes SET
  episode_number_v2 = CASE WHEN episode_number > 0 THEN episode_number END,
  season_v2 = CASE WHEN season > 0 THEN season END;
ALTER TABLE episodes DROP COLUMN episode_number;
ALTER TABLE episodes DROP COLUMN season;
ALTER TABLE episodes RENAME COLUMN episode_number_v2 TO episode_number;
ALTER TABLE episodes RENAME COLUMN season_v2 TO season;
`;
