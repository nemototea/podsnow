// 書き出しが今の編集と同じ音かを判定する指紋（Issue #168 / REQUIREMENTS.md FR-EP-7）。
// DATA_MODEL.md §4.13 に対応する。
//
// 既存の行は NULL のまま（書き出したときの中身は今から分からない）。NULL は古い書き出しとして扱い、
// Home ではタイムラインを鳴らす。書き出し履歴からはこれまでどおり共有・保存できる。
export const MIGRATION_0006_EXPORT_SOURCE_FINGERPRINT = `
ALTER TABLE exports ADD COLUMN source_fingerprint TEXT;
`;
