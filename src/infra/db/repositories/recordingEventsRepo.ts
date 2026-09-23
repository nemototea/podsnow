import type { Smp } from '@/domain/time';

import type { SqlExecutor, SqlRow } from '../executor';

/*
 * recording_events（録音中の出来事）。DATA_MODEL.md §4.10
 *
 * ユーザーが打つマーカーは持たない。ここに入るのはアプリが自動で記録したものだけで、
 * Undo の対象にもしない（起きた事実であって、編集ではない）。
 */

export type RecordingEventKind = 'interruption' | 'route_change' | 'disk_low';

export interface RecordingEvent {
  id: string;
  takeId: string;
  srcSmp: Smp;
  label: string;
  kind: RecordingEventKind;
  createdAt: number;
}

interface EventRow extends SqlRow {
  id: string;
  take_id: string;
  src_smp: number;
  label: string;
  kind: string;
  created_at: number;
}

export async function listRecordingEvents(
  db: SqlExecutor,
  episodeId: string,
): Promise<RecordingEvent[]> {
  const rows = await db.all<EventRow>(
    'SELECT id, take_id, src_smp, label, kind, created_at FROM recording_events WHERE episode_id = ? ORDER BY created_at, rowid',
    [episodeId],
  );
  return rows.map((r) => ({
    id: r.id,
    takeId: r.take_id,
    srcSmp: r.src_smp as Smp,
    label: r.label,
    kind: r.kind as RecordingEventKind,
    createdAt: r.created_at,
  }));
}

export async function insertRecordingEvent(
  db: SqlExecutor,
  episodeId: string,
  e: RecordingEvent,
): Promise<void> {
  await db.run(
    'INSERT INTO recording_events (id, episode_id, take_id, src_smp, label, kind, created_at) VALUES (?,?,?,?,?,?,?)',
    [e.id, episodeId, e.takeId, e.srcSmp, e.label, e.kind, e.createdAt],
  );
}
