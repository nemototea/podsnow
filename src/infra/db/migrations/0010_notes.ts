// トークテーマと台本（outline_items）と番組のひな形（show_topic_template）を、
// 1 枚のカンペ（episodes.notes）とカンペのひな形（shows.notes_template）に置き換える（Issue #180）。
// DATA_MODEL.md §4.2.1 / §4.11 に対応する。
//
// データは移さずに捨てる（ユーザー判断 2026-10-08）。項目の列を 1 枚の文章に直すと、
// 見出しと本文の区切りやチャプターの位置が文章の中に紛れ、どれも元に戻せない形になるため。
// DATA_MODEL.md §7 の「旧列放置」の例外（0.1.0 は未公開。旧テーブルを残すと二重の真実になる）。
// 移行前の DB ファイルは open.ts がこれまでどおりバックアップする。
//
// 概要欄のひな形の {{topics}} も廃止したので取り除く。残すと展開されずに文字のまま出る。
// 既定のひな形（i18n の seed.descriptionTemplate）は先頭が「{{topics}}」と空行なので、
// 後ろの改行ごと消して跡を残さない。
export const MIGRATION_0010_NOTES = `
ALTER TABLE episodes ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE shows ADD COLUMN notes_template TEXT NOT NULL DEFAULT '';

DROP INDEX idx_outline_items_episode;
DROP TABLE outline_items;
DROP INDEX idx_show_topic_template_show;
DROP TABLE show_topic_template;

UPDATE description_templates
  SET body = REPLACE(REPLACE(REPLACE(body,
    '{{topics}}' || char(10) || char(10), ''),
    '{{topics}}' || char(10), ''),
    '{{topics}}', '')
  WHERE body LIKE '%{{topics}}%';
`;
