import type { Smp } from '../time';

/** 声トラックの 1 区間。Take の [srcStart, srcEnd) を参照する（DATA_MODEL.md §4.8）。 */
export interface VoiceSegment {
  id: string;
  takeId: string;
  srcStart: Smp;
  /** 排他。 */
  srcEnd: Smp;
  gainDb: number;
  fadeIn: Smp;
  fadeOut: Smp;
}

export type AssetKind = 'opening' | 'ending' | 'jingle' | 'sfx' | 'bgm';

/** オーバーレイの位置指定（DATA_MODEL.md §4.9）。 */
export type Anchor =
  | { type: 'source'; takeId: string; srcSmp: Smp }
  | { type: 'timeline_start'; offset: Smp }
  | { type: 'timeline_end'; offset: Smp }
  | { type: 'timeline_abs'; smp: Smp };

export type OverlayEndMode = 'asset_end' | 'timeline_end' | 'fixed';

export interface OverlayClip {
  id: string;
  assetId: string;
  kind: AssetKind;
  anchor: Anchor;
  srcStart: Smp;
  /** null = 素材の末尾まで。 */
  srcEnd: Smp | null;
  gainDb: number;
  fadeIn: Smp;
  fadeOut: Smp;
  duck: boolean;
  loop: boolean;
  endMode: OverlayEndMode;
  /** endMode = 'fixed' のときの長さ。 */
  fixedDuration?: Smp;
}

export interface Timeline {
  /** position 順に並んだ声トラック。 */
  voice: readonly VoiceSegment[];
  overlays: readonly OverlayClip[];
}

/** 声トラック上の半開区間 [start, end)。 */
export interface Range {
  start: Smp;
  end: Smp;
}

export interface SourcePosition {
  takeId: string;
  srcSmp: Smp;
  /** voice 配列のインデックス。 */
  segmentIndex: number;
}

export interface PlacedSegment {
  segment: VoiceSegment;
  index: number;
  /** 声トラック上の開始位置。 */
  start: Smp;
  end: Smp;
}
