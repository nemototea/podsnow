// 番組のアートワークの代表色（Issue #235 / DESIGN_SYSTEM.md §2.6）。DATA_MODEL.md §4.1 に対応する。
//
// 番組の色（番組画面・収録画面・ミニプレーヤー）の元。既存の行は NULL（= まだ計算していない）から始まり、
// アートワークがある番組は起動後に計算する。
export const MIGRATION_0008_SHOW_COVER_COLOR = `
ALTER TABLE shows ADD COLUMN cover_color TEXT;
`;
