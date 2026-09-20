// 話数の採番の導出化（REQUIREMENTS.md FR-EP-6）と「音声だけ削除」（FR-EP-4）。
// DATA_MODEL.md §4.1 / §4.5 に対応する。
//
// shows.next_episode_number はこの移行以降どこからも読み書きしない。
// DATA_MODEL.md §8 の「破壊的変更は新列追加 → データ移送 → 旧列放置」に従い、
// 列そのものは残す（NOT NULL DEFAULT 1 なので INSERT 側の変更も要らない）。
export const MIGRATION_0002_EPISODE_NUMBERING = `
ALTER TABLE episodes ADD COLUMN audio_purged_at INTEGER;
`;
