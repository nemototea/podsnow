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

/**
 * アンカーを声トラック上の開始位置に解決する。source アンカーがカット済みなら null。
 * 位置は本編（声）の始まりを 0 として数え、本編より前（オープニングなど）は負になる（Issue #254）。
 */
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
      // 本編の始まりから offset。負なら本編より前（オープニングを流し終えてから話す形）
      return smp(a.offset);
    case 'timeline_end':
      // 素材の末尾を本編の末尾に合わせ、そこから offset ずらす。offset = 素材の長さなら本編のあとに続く
      return smp(total - overlayLength + a.offset);
    case 'timeline_abs':
      return smp(a.smp);
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
    case 'timeline_end': {
      // 本編の終わり（から endOffset ずらした所）まで
      const until = total + (clip.endOffset ?? 0);
      end = clip.loop ? smp(Math.max(until, start)) : smp(Math.min(until, start + srcLen));
      break;
    }
    case 'fixed':
      end = addSmp(start, clip.fixedDuration ?? srcLen);
      break;
  }
  if (end <= start) end = addSmp(start, smp(1));
  return { clip, status: 'placed', range: { start, end } };
}

/**
 * 書き出す範囲（Issue #254）。本編の始まりを 0 とした位置で、始まりは 0 以下、終わりは本編の終わり以上。
 * 本編より前に置いた素材（オープニング）や、本編のあとに置いた素材（エンディング）まで含める。
 * 書き出しと再生は `start` を 0 に合わせて全体をずらす（`buildRenderDocument`）。
 */
export function timelineBounds(
  voice: readonly VoiceSegment[],
  placed: readonly PlacedOverlay[],
): Range {
  let start = 0;
  let end: number = totalDuration(voice);
  for (const p of placed) {
    if (p.status !== 'placed') continue;
    start = Math.min(start, p.range.start);
    end = Math.max(end, p.range.end);
  }
  return { start: smp(start), end: smp(end) };
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
