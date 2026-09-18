import type { Smp } from '../time';
import type { OverlayClip, VoiceSegment } from '../timeline/types';

export type MarkerKind = 'edit_point' | 'mistake' | 'interruption' | 'route_change' | 'topic';

export interface Marker {
  id: string;
  takeId: string;
  srcSmp: Smp;
  label: string;
  kind: MarkerKind;
  resolved: boolean;
}

/**
 * Undo の対象となるエピソードの編集状態（DATA_MODEL.md §4.12 の対象テーブル）。
 * Take 自体は含まない（録音は Undo 対象外）。
 */
export interface EditableDoc {
  voice: readonly VoiceSegment[];
  overlays: readonly OverlayClip[];
  markers: readonly Marker[];
}

export const EMPTY_DOC: EditableDoc = { voice: [], overlays: [], markers: [] };

export function cloneDoc(d: EditableDoc): EditableDoc {
  return {
    voice: d.voice.map((s) => ({ ...s })),
    overlays: d.overlays.map((o) => ({ ...o, anchor: { ...o.anchor } })),
    markers: d.markers.map((m) => ({ ...m })),
  };
}

export function docEquals(a: EditableDoc, b: EditableDoc): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
