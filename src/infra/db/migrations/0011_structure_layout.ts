// 番組の構成（オープニング・エンディング・BGM）を本編の前後に置き、タイムラインで動かせるようにする（Issue #254）。
// DATA_MODEL.md §4.3 / §4.9 に対応する。
//
// - overlay_clips.end_offset_smp: end_mode = 'timeline_end'（BGM）の終わりを本編の終わりからずらす量。
//   正ならエンディングの下まで伸びる。既存の行は 0 で、これまでと同じ（本編の終わりまで）。
// - show_layout: 「この構成を新しいエピソードの既定にする」で覚える並びとフェード。
//   既定値は新しい形（オープニングを流し終えてから話し、話し終えてからエンディング）。
//   既存の番組も、次に作るエピソードからこの形になる（作成済みのエピソードは変えない）。
//   BGM のフェード（1 秒 / 2 秒）はこれまで EpisodeService に書いていた値。
export const MIGRATION_0011_STRUCTURE_LAYOUT = `
ALTER TABLE overlay_clips ADD COLUMN end_offset_smp INTEGER NOT NULL DEFAULT 0;

ALTER TABLE show_layout ADD COLUMN opening_overlap_smp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE show_layout ADD COLUMN opening_fade_in_smp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE show_layout ADD COLUMN opening_fade_out_smp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE show_layout ADD COLUMN ending_gap_smp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE show_layout ADD COLUMN ending_fade_in_smp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE show_layout ADD COLUMN ending_fade_out_smp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE show_layout ADD COLUMN bgm_start_offset_smp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE show_layout ADD COLUMN bgm_end_offset_smp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE show_layout ADD COLUMN bgm_fade_in_smp INTEGER NOT NULL DEFAULT 48000;
ALTER TABLE show_layout ADD COLUMN bgm_fade_out_smp INTEGER NOT NULL DEFAULT 96000;
`;
