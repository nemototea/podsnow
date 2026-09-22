import type { OutlineItem } from '@/domain/outline';
import type { Smp } from '@/domain/time';

import type { SqlExecutor, SqlRow } from '../executor';

/*
 * outline_items（トークテーマと台本）と show_topic_template（番組のひな形）の読み書き。
 * DATA_MODEL.md §4.2.1 / §4.11
 *
 * position は配列の並びから振り直す。疎な整数にしないのは、並べ替えが
 * 「配列を作り直して丸ごと保存」だけで済み、途中の値を気にしなくてよいため。
 */

interface OutlineRow extends SqlRow {
  id: string;
  heading: string;
  body: string;
  recorded_take_id: string | null;
  recorded_src_smp: number | null;
  done_at: number | null;
}

export async function listOutline(db: SqlExecutor, episodeId: string): Promise<OutlineItem[]> {
  const rows = await db.all<OutlineRow>(
    'SELECT id, heading, body, recorded_take_id, recorded_src_smp, done_at FROM outline_items WHERE episode_id = ? ORDER BY position',
    [episodeId],
  );
  return rows.map(toItem);
}

/** エピソードの項目をまるごと置き換える。呼び出し側がトランザクションで包む。 */
export async function saveOutline(
  db: SqlExecutor,
  episodeId: string,
  items: readonly OutlineItem[],
): Promise<void> {
  await db.run('DELETE FROM outline_items WHERE episode_id = ?', [episodeId]);
  let position = 0;
  for (const i of items) {
    await db.run(
      'INSERT INTO outline_items (id, episode_id, position, heading, body, recorded_take_id, recorded_src_smp, done_at) VALUES (?,?,?,?,?,?,?,?)',
      [
        i.id,
        episodeId,
        position++,
        i.heading,
        i.body,
        i.recordedTakeId,
        i.recordedSrcSmp,
        i.doneAt,
      ],
    );
  }
}

/**
 * 録音中に項目へ進んだ位置を記録する（= チャプター）。
 * 1 行だけの更新なので、録音中に項目リスト全体を書き戻さない。
 */
export async function markRecordedAt(
  db: SqlExecutor,
  itemId: string,
  at: { takeId: string; srcSmp: Smp } | null,
  doneAt: number | null,
): Promise<void> {
  await db.run(
    'UPDATE outline_items SET recorded_take_id = ?, recorded_src_smp = ?, done_at = ? WHERE id = ?',
    [at?.takeId ?? null, at?.srcSmp ?? null, doneAt, itemId],
  );
}

export async function listShowTopicTemplate(
  db: SqlExecutor,
  showId: string,
): Promise<{ heading: string; body: string }[]> {
  return db.all<SqlRow & { heading: string; body: string }>(
    'SELECT heading, body FROM show_topic_template WHERE show_id = ? ORDER BY position',
    [showId],
  );
}

/** 番組のひな形をまるごと置き換える。呼び出し側がトランザクションで包む。 */
export async function saveShowTopicTemplate(
  db: SqlExecutor,
  showId: string,
  newId: () => string,
  items: readonly { heading: string; body: string }[],
): Promise<void> {
  await db.run('DELETE FROM show_topic_template WHERE show_id = ?', [showId]);
  let position = 0;
  for (const i of items) {
    await db.run(
      'INSERT INTO show_topic_template (id, show_id, position, heading, body) VALUES (?,?,?,?,?)',
      [newId(), showId, position++, i.heading, i.body],
    );
  }
}

function toItem(r: OutlineRow): OutlineItem {
  return {
    id: r.id,
    heading: r.heading,
    body: r.body,
    recordedTakeId: r.recorded_take_id,
    recordedSrcSmp: r.recorded_src_smp === null ? null : (r.recorded_src_smp as Smp),
    doneAt: r.done_at,
  };
}
