// ラウドネス測定の結果を回ごとに持つ（Issue #158 / AUDIO_DESIGN.md §8.4）。DATA_MODEL.md §4.5 に対応する。
//
// 試聴（書き出しタブ）と書き出しで同じゲインを使うためのキャッシュ。既存の行は NULL（= 未測定）から始まり、
// 書き出しタブを開いたときに測る。
export const MIGRATION_0007_LOUDNESS_CACHE = `
ALTER TABLE episodes ADD COLUMN loudness_cache TEXT;
`;
