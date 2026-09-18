import { addSmp, smp, subSmp, type Smp } from '../time';
import type { OverlayClip, Range, VoiceSegment } from './types';
import { resolveTimeline, totalDuration } from './voice';

/** オーバーレイの声トラック上での配置結果。 */
export type PlacedOverlay =
  | { clip: OverlayClip; status: 'placed'; range: Range }
  | { clip: OverlayClip; status: 'orphaned'; reason: 'anchor_cut' };

/** 素材内で使う長さ。srcEnd が null なら素材末尾まで。 */
export function overlaySourceLength(clip: OverlayClip, assetDuration: Smp): Smp {
  const end = clip.srcEnd ?? assetDuration;
  return smp(Math.max(0, Math.min(end, assetDuration) - clip.srcStart));
}

/** アンカーを声トラック上の開始位置に解決する。source アンカーがカット済みなら null。 */
export function resolveAnchorStart(
  voice: readonly VoiceSegment[],
  clip: OverlayClip,
  overlayLength: Smp,
): Smp | null {
  const total = totalDuration(voice);
  const a = clip.anchor;
  switch (a.type) {
    case 'source':
      return resolveTimeline(voice, a.takeId, a.srcSmp);
    case 'timeline_start':
      return smp(Math.max(0, a.offset));
    case 'timeline_end':
      // Ending: 声トラックの末尾に、素材の末尾が offset だけ食い込む/離れるように置く
      return smp(Math.max(0, total - overlayLength + a.offset));
    case 'timeline_abs':
      return smp(Math.max(0, a.smp));
  }
}

/**
 * オーバーレイを配置する。
 * - endMode 'asset_end': 素材（の使用範囲）の長さ
 * - endMode 'timeline_end': 声トラック末尾まで（loop=true なら繰り返し、false なら素材長で打ち切り）
 * - endMode 'fixed': fixedDuration
 */
export function placeOverlay(
  voice: readonly VoiceSegment[],
  clip: OverlayClip,
  assetDuration: Smp,
): PlacedOverlay {
  const srcLen = overlaySourceLength(clip, assetDuration);
  const start = resolveAnchorStart(voice, clip, srcLen);
  if (start === null) return { clip, status: 'orphaned', reason: 'anchor_cut' };
  const total = totalDuration(voice);
  let end: Smp;
  switch (clip.endMode) {
    case 'asset_end':
      end = addSmp(start, srcLen);
      break;
    case 'timeline_end':
      end = clip.loop ? smp(Math.max(total, start)) : smp(Math.min(total, start + srcLen));
      if (end < addSmp(start, srcLen) && !clip.loop) end = smp(Math.min(total, start + srcLen));
      break;
    case 'fixed':
      end = addSmp(start, clip.fixedDuration ?? srcLen);
      break;
  }
  if (end <= start) end = addSmp(start, smp(1));
  return { clip, status: 'placed', range: { start, end } };
}

export function placeOverlays(
  voice: readonly VoiceSegment[],
  overlays: readonly OverlayClip[],
  assetDurations: ReadonlyMap<string, Smp>,
): PlacedOverlay[] {
  return overlays.map((clip) => {
    const d = assetDurations.get(clip.assetId);
    if (d === undefined) {
      // 素材が見つからない場合も孤立扱い（UI で警告）
      return { clip, status: 'orphaned', reason: 'anchor_cut' } as PlacedOverlay;
    }
    return placeOverlay(voice, clip, d);
  });
}

/**
 * 声を削除した結果、source アンカーが消えたオーバーレイを最寄りの生きている位置へ付け替える提案を作る。
 * 削除前の声トラックでの位置を基準に、削除後の声トラックで同じ Take 上の最も近い位置を探す。
 */
export function suggestReanchor(
  before: readonly VoiceSegment[],
  after: readonly VoiceSegment[],
  clip: OverlayClip,
): OverlayClip | null {
  if (clip.anchor.type !== 'source') return null;
  const { takeId, srcSmp } = clip.anchor;
  if (resolveTimeline(after, takeId, srcSmp) !== null) return null; // 生きている
  const wasAt = resolveTimeline(before, takeId, srcSmp);
  if (wasAt === null) return null;
  // after 上で、削除前の位置以降に最初に現れる同 Take の点を探す。無ければ直前。
  let best: { srcSmp: Smp; dist: number } | null = null;
  for (const s of after) {
    if (s.takeId !== takeId) continue;
    const candidates: Smp[] = [s.srcStart, subSmp(s.srcEnd, smp(1))];
    for (const c of candidates) {
      const dist = Math.abs(c - srcSmp);
      if (!best || dist < best.dist) best = { srcSmp: c, dist };
    }
  }
  if (!best) return null;
  return { ...clip, anchor: { type: 'source', takeId, srcSmp: best.srcSmp } };
}
