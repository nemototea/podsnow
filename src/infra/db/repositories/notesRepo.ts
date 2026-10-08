import type { SqlExecutor, SqlRow } from '../executor';

/*
 * カンペ（episodes.notes）とカンペのひな形（shows.notes_template）の読み書き。
 * DATA_MODEL.md §4.2.1 / §4.11、Issue #180。
 *
 * 1 列のテキストなので、episodes / shows の他の列の読み書きとは分けて置く。
 * カンペの保存で updated_at を動かさない（入力のたびに一覧の並びや「続き」が変わらないように）。
 */

export async function getEpisodeNotes(db: SqlExecutor, episodeId: string): Promise<string> {
  const row = await db.get<SqlRow & { notes: string }>('SELECT notes FROM episodes WHERE id = ?', [
    episodeId,
  ]);
  return row?.notes ?? '';
}

export async function setEpisodeNotes(
  db: SqlExecutor,
  episodeId: string,
  notes: string,
): Promise<void> {
  await db.run('UPDATE episodes SET notes = ? WHERE id = ?', [notes, episodeId]);
}

export async function getShowNotesTemplate(db: SqlExecutor, showId: string): Promise<string> {
  const row = await db.get<SqlRow & { notes_template: string }>(
    'SELECT notes_template FROM shows WHERE id = ?',
    [showId],
  );
  return row?.notes_template ?? '';
}

export async function setShowNotesTemplate(
  db: SqlExecutor,
  showId: string,
  text: string,
): Promise<void> {
  await db.run('UPDATE shows SET notes_template = ? WHERE id = ?', [text, showId]);
}
