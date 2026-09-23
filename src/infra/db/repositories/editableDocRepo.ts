import type { EditableDoc } from '@/domain/editing/doc';
import type { Smp } from '@/domain/time';
import type {
  Anchor,
  AssetKind,
  OverlayClip,
  OverlayEndMode,
  VoiceSegment,
} from '@/domain/timeline/types';

import type { SqlExecutor, SqlRow } from '../executor';

/*
 * EditableDoc（voice_segments / overlay_clips）の読み書き。
 * saveDoc はエピソードの行をまるごと置き換える。呼び出し側がトランザクションで包む。
 */

interface VoiceRow extends SqlRow {
  id: string;
  take_id: string;
  src_start_smp: number;
  src_end_smp: number;
  gain_db: number;
  fade_in_smp: number;
  fade_out_smp: number;
}

interface OverlayRow extends SqlRow {
  id: string;
  asset_id: string;
  kind: string;
  anchor_type: string;
  anchor_take_id: string | null;
  anchor_smp: number;
  src_start_smp: number;
  src_end_smp: number | null;
  gain_db: number;
  fade_in_smp: number;
  fade_out_smp: number;
  duck: number;
  loop: number;
  end_mode: string;
}

export async function loadDoc(db: SqlExecutor, episodeId: string): Promise<EditableDoc> {
  const voiceRows = await db.all<VoiceRow>(
    'SELECT id, take_id, src_start_smp, src_end_smp, gain_db, fade_in_smp, fade_out_smp FROM voice_segments WHERE episode_id = ? ORDER BY position',
    [episodeId],
  );
  const overlayRows = await db.all<OverlayRow>(
    'SELECT id, asset_id, kind, anchor_type, anchor_take_id, anchor_smp, src_start_smp, src_end_smp, gain_db, fade_in_smp, fade_out_smp, duck, loop, end_mode FROM overlay_clips WHERE episode_id = ? ORDER BY rowid',
    [episodeId],
  );
  return {
    voice: voiceRows.map(rowToVoice),
    overlays: overlayRows.map(rowToOverlay),
  };
}

export async function saveDoc(
  db: SqlExecutor,
  episodeId: string,
  doc: EditableDoc,
  now: number,
): Promise<void> {
  await db.run('DELETE FROM voice_segments WHERE episode_id = ?', [episodeId]);
  await db.run('DELETE FROM overlay_clips WHERE episode_id = ?', [episodeId]);
  let position = 0;
  for (const s of doc.voice) {
    await db.run(
      'INSERT INTO voice_segments (id, episode_id, position, take_id, src_start_smp, src_end_smp, gain_db, fade_in_smp, fade_out_smp, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        s.id,
        episodeId,
        position,
        s.takeId,
        s.srcStart,
        s.srcEnd,
        s.gainDb,
        s.fadeIn,
        s.fadeOut,
        now,
      ],
    );
    position += 10;
  }
  for (const o of doc.overlays) {
    const a = o.anchor;
    await db.run(
      'INSERT INTO overlay_clips (id, episode_id, asset_id, kind, anchor_type, anchor_take_id, anchor_smp, src_start_smp, src_end_smp, gain_db, fade_in_smp, fade_out_smp, duck, loop, end_mode, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        o.id,
        episodeId,
        o.assetId,
        o.kind,
        a.type,
        a.type === 'source' ? a.takeId : null,
        anchorSmp(a),
        o.srcStart,
        o.srcEnd,
        o.gainDb,
        o.fadeIn,
        o.fadeOut,
        o.duck ? 1 : 0,
        o.loop ? 1 : 0,
        o.endMode,
        now,
      ],
    );
  }
}

function anchorSmp(a: Anchor): number {
  switch (a.type) {
    case 'source':
      return a.srcSmp;
    case 'timeline_start':
    case 'timeline_end':
      return a.offset;
    case 'timeline_abs':
      return a.smp;
  }
}

function rowToVoice(r: VoiceRow): VoiceSegment {
  return {
    id: r.id,
    takeId: r.take_id,
    srcStart: r.src_start_smp as Smp,
    srcEnd: r.src_end_smp as Smp,
    gainDb: r.gain_db,
    fadeIn: r.fade_in_smp as Smp,
    fadeOut: r.fade_out_smp as Smp,
  };
}

function rowToOverlay(r: OverlayRow): OverlayClip {
  let anchor: Anchor;
  switch (r.anchor_type) {
    case 'source':
      anchor = { type: 'source', takeId: r.anchor_take_id ?? '', srcSmp: r.anchor_smp as Smp };
      break;
    case 'timeline_start':
      anchor = { type: 'timeline_start', offset: r.anchor_smp as Smp };
      break;
    case 'timeline_end':
      anchor = { type: 'timeline_end', offset: r.anchor_smp as Smp };
      break;
    default:
      anchor = { type: 'timeline_abs', smp: r.anchor_smp as Smp };
  }
  return {
    id: r.id,
    assetId: r.asset_id,
    kind: r.kind as AssetKind,
    anchor,
    srcStart: r.src_start_smp as Smp,
    srcEnd: r.src_end_smp === null ? null : (r.src_end_smp as Smp),
    gainDb: r.gain_db,
    fadeIn: r.fade_in_smp as Smp,
    fadeOut: r.fade_out_smp as Smp,
    duck: r.duck === 1,
    loop: r.loop === 1,
    endMode: r.end_mode as OverlayEndMode,
  };
}
