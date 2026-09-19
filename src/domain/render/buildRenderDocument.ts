import type { Smp } from '../time';
import { placeOverlays } from '../timeline/overlays';
import type { OverlayClip, VoiceSegment } from '../timeline/types';
import { placeVoice, totalDuration } from '../timeline/voice';
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

export function buildRenderDocument(input: BuildInput): RenderDocument {
  const voice: RenderClip[] = [];
  for (const p of placeVoice(input.voice)) {
    voice.push(...expandVoiceSegment(p.segment, p.start, input.takeFiles));
  }
  const totalFrames = totalDuration(input.voice);
  const durations = new Map(input.assets.map((a) => [a.assetId, a.duration]));
  const paths = new Map(input.assets.map((a) => [a.assetId, a.path]));
  const overlays: RenderOverlay[] = [];
  for (const placed of placeOverlays(input.voice, input.overlays, durations)) {
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
      tlStart: placed.range.start,
      tlEnd: placed.range.end,
      gainDb: c.gainDb,
      fadeInFrames: c.fadeIn,
      fadeOutFrames: c.fadeOut,
      duck: c.duck,
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
