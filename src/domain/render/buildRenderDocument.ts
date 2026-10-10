import type { Smp } from '../time';
import { placeOverlays, timelineBounds } from '../timeline/overlays';
import { ducksUnderVoice, type OverlayClip, type VoiceSegment } from '../timeline/types';
import { placeVoice } from '../timeline/voice';
import type {
  DuckingSettings,
  LoudnessSettings,
  RenderClip,
  RenderDocument,
  RenderOverlay,
} from './types';

/** Take を構成する Segment ファイル（DATA_MODEL.md §4.7）。 */
export interface TakeFile {
  takeId: string;
  /** Take 内の開始位置。 */
  offset: number;
  /** フレーム数。 */
  duration: number;
  /** 絶対パス。 */
  path: string;
}

export interface AssetFile {
  assetId: string;
  path: string;
  duration: Smp;
}

export interface BuildInput {
  sampleRate: number;
  channels: 1 | 2;
  voice: readonly VoiceSegment[];
  overlays: readonly OverlayClip[];
  takeFiles: readonly TakeFile[];
  assets: readonly AssetFile[];
  ducking: DuckingSettings;
  loudness: LoudnessSettings;
}

/**
 * 声セグメント（Take 座標）を Segment ファイル単位の RenderClip に展開する。
 * 1 セグメントが複数ファイルにまたがる場合は分割し、フェードは外側の端にだけ付ける。
 */
export function expandVoiceSegment(
  seg: VoiceSegment,
  tlStart: number,
  files: readonly TakeFile[],
): RenderClip[] {
  const parts = files
    .filter((f) => f.takeId === seg.takeId && f.duration > 0)
    .sort((a, b) => a.offset - b.offset);
  const out: RenderClip[] = [];
  for (const f of parts) {
    const a = Math.max(seg.srcStart, f.offset);
    const b = Math.min(seg.srcEnd, f.offset + f.duration);
    if (b <= a) continue;
    out.push({
      path: f.path,
      fileStart: a - f.offset,
      fileEnd: b - f.offset,
      tlStart: tlStart + (a - seg.srcStart),
      gainDb: seg.gainDb,
      fadeInFrames: 0,
      fadeOutFrames: 0,
    });
  }
  if (out.length) {
    out[0]!.fadeInFrames = seg.fadeIn;
    out[out.length - 1]!.fadeOutFrames = seg.fadeOut;
  }
  return out;
}

/**
 * 出力の 0 が本編のどこに当たるか（Issue #254）。本編より前に素材が無ければ 0、
 * オープニングを本編の前に置いていれば、その長さ（本編の始まりの出力上の位置）。
 * 編集画面は本編の位置で数え、再生エンジンとのやり取りでこの分を足し引きする。
 */
export function outputOrigin(
  voice: readonly VoiceSegment[],
  overlays: readonly OverlayClip[],
  assetDurations: ReadonlyMap<string, Smp>,
): number {
  return -timelineBounds(voice, placeOverlays(voice, overlays, assetDurations)).start;
}

export function buildRenderDocument(input: BuildInput): RenderDocument {
  const durations = new Map(input.assets.map((a) => [a.assetId, a.duration]));
  const paths = new Map(input.assets.map((a) => [a.assetId, a.path]));
  const placedAll = placeOverlays(input.voice, input.overlays, durations);
  // 本編より前の素材があれば、いちばん前を出力の 0 に合わせて全体をずらす。
  // ネイティブは 0 から totalFrames までを鳴らすので、負の位置を渡さない（Issue #254）
  const bounds = timelineBounds(input.voice, placedAll);
  const shift = -bounds.start;
  const totalFrames = bounds.end - bounds.start;
  const voice: RenderClip[] = [];
  for (const p of placeVoice(input.voice)) {
    voice.push(...expandVoiceSegment(p.segment, p.start + shift, input.takeFiles));
  }
  const overlays: RenderOverlay[] = [];
  for (const placed of placedAll) {
    if (placed.status !== 'placed') continue; // 孤立したオーバーレイは鳴らさない
    const c = placed.clip;
    const path = paths.get(c.assetId);
    const assetDur = durations.get(c.assetId);
    if (!path || assetDur === undefined) continue;
    const fileEnd = Math.min(c.srcEnd ?? assetDur, assetDur);
    if (fileEnd <= c.srcStart) continue;
    overlays.push({
      path,
      fileStart: c.srcStart,
      fileEnd,
      tlStart: placed.range.start + shift,
      tlEnd: placed.range.end + shift,
      gainDb: c.gainDb,
      fadeInFrames: c.fadeIn,
      fadeOutFrames: c.fadeOut,
      duck: ducksUnderVoice(c.kind),
      loop: c.loop,
    });
  }
  return {
    sampleRate: input.sampleRate,
    channels: input.channels,
    totalFrames,
    voice,
    overlays,
    ducking: input.ducking,
    loudness: input.loudness,
  };
}
