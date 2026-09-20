import type { SqlExecutor, SqlRow } from '../executor';

/*
 * takes / take_segments / recovery_journal の読み書き（DATA_MODEL.md §4.6, §4.7, §4.15）。
 */

export type TakeStatus = 'recording' | 'ready' | 'orphaned' | 'recovered' | 'failed';
export type SegmentCloseReason =
  'stop' | 'interruption' | 'route_change' | 'error' | 'disk_low' | 'crash_recovered';

export interface TakeRow extends SqlRow {
  id: string;
  episode_id: string;
  name: string;
  status: TakeStatus;
  sample_rate: number;
  channels: number;
  bit_depth: number;
  input_label: string | null;
  started_at: number;
  ended_at: number | null;
  duration_smp: number;
}

export interface SegmentRow extends SqlRow {
  id: string;
  take_id: string;
  seq: number;
  path: string;
  offset_smp: number;
  duration_smp: number | null;
  header_valid: number;
  reason_closed: string | null;
  peaks_path: string | null;
}

export interface JournalRow extends SqlRow {
  id: string;
  take_id: string;
  segment_id: string;
  state: 'open' | 'closed';
  last_heartbeat_at: number;
  last_known_bytes: number;
}

export async function insertTake(
  db: SqlExecutor,
  t: {
    id: string;
    episodeId: string;
    name: string;
    sampleRate: number;
    channels: number;
    inputLabel: string | null;
    now: number;
  },
): Promise<void> {
  await db.run(
    'INSERT INTO takes (id, episode_id, name, status, sample_rate, channels, bit_depth, input_label, started_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [
      t.id,
      t.episodeId,
      t.name,
      'recording',
      t.sampleRate,
      t.channels,
      16,
      t.inputLabel,
      t.now,
      t.now,
      t.now,
    ],
  );
}

export async function getTake(db: SqlExecutor, id: string): Promise<TakeRow | null> {
  return db.get<TakeRow>('SELECT * FROM takes WHERE id = ?', [id]);
}

export async function listTakes(db: SqlExecutor, episodeId: string): Promise<TakeRow[]> {
  return db.all<TakeRow>(
    'SELECT * FROM takes WHERE episode_id = ? AND deleted_at IS NULL ORDER BY started_at',
    [episodeId],
  );
}

export async function countTakes(db: SqlExecutor, episodeId: string): Promise<number> {
  const r = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM takes WHERE episode_id = ?', [
    episodeId,
  ]);
  return r?.n ?? 0;
}

export async function finalizeTake(
  db: SqlExecutor,
  id: string,
  status: TakeStatus,
  durationSmp: number,
  now: number,
): Promise<void> {
  await db.run(
    'UPDATE takes SET status = ?, duration_smp = ?, ended_at = ?, updated_at = ? WHERE id = ?',
    [status, durationSmp, now, now, id],
  );
}

export async function insertSegment(
  db: SqlExecutor,
  s: { id: string; takeId: string; seq: number; path: string; offsetSmp: number },
): Promise<void> {
  await db.run(
    'INSERT INTO take_segments (id, take_id, seq, path, offset_smp, header_valid) VALUES (?,?,?,?,?,0)',
    [s.id, s.takeId, s.seq, s.path, s.offsetSmp],
  );
}

export async function closeSegment(
  db: SqlExecutor,
  id: string,
  durationSmp: number,
  reason: SegmentCloseReason,
): Promise<void> {
  await db.run(
    'UPDATE take_segments SET duration_smp = ?, header_valid = 1, reason_closed = ? WHERE id = ?',
    [durationSmp, reason, id],
  );
}

export async function listSegments(db: SqlExecutor, takeId: string): Promise<SegmentRow[]> {
  return db.all<SegmentRow>('SELECT * FROM take_segments WHERE take_id = ? ORDER BY seq', [takeId]);
}

export async function openJournal(
  db: SqlExecutor,
  j: { id: string; takeId: string; segmentId: string; now: number },
): Promise<void> {
  await db.run(
    'INSERT INTO recovery_journal (id, take_id, segment_id, state, last_heartbeat_at, last_known_bytes) VALUES (?,?,?,?,?,0)',
    [j.id, j.takeId, j.segmentId, 'open', j.now],
  );
}

export async function heartbeatJournal(
  db: SqlExecutor,
  segmentId: string,
  now: number,
  bytes: number,
): Promise<void> {
  await db.run(
    'UPDATE recovery_journal SET last_heartbeat_at = ?, last_known_bytes = ? WHERE segment_id = ? AND state = ?',
    [now, bytes, segmentId, 'open'],
  );
}

export async function closeJournal(db: SqlExecutor, segmentId: string): Promise<void> {
  await db.run('UPDATE recovery_journal SET state = ? WHERE segment_id = ?', ['closed', segmentId]);
}

export async function listOpenJournals(db: SqlExecutor): Promise<JournalRow[]> {
  return db.all<JournalRow>(
    'SELECT * FROM recovery_journal WHERE state = ? ORDER BY last_heartbeat_at',
    ['open'],
  );
}

export async function getSegment(db: SqlExecutor, id: string): Promise<SegmentRow | null> {
  return db.get<SegmentRow>('SELECT * FROM take_segments WHERE id = ?', [id]);
}
