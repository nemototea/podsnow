import type { OverlayClip, VoiceSegment } from '../timeline/types';

/**
 * Undo の対象となるエピソードの編集状態（DATA_MODEL.md §4.12 の対象テーブル）。
 * Take 自体は含まない（録音は Undo 対象外）。
 *
 * マーカーは持たない（FR-REC-4 廃止）。ユーザーが打つ編集点は無くなり、
 * 録音中の出来事は `recording_events`、チャプターは `outline_items` が持つ。
 * どちらも「起きた事実」なので Undo の対象ではない。
 */
export interface EditableDoc {
  voice: readonly VoiceSegment[];
  overlays: readonly OverlayClip[];
}

export const EMPTY_DOC: EditableDoc = { voice: [], overlays: [] };

export function cloneDoc(d: EditableDoc): EditableDoc {
  return {
    voice: d.voice.map((s) => ({ ...s })),
    overlays: d.overlays.map((o) => ({ ...o, anchor: { ...o.anchor } })),
  };
}

export function docEquals(a: EditableDoc, b: EditableDoc): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
