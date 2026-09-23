import { addSmp, smp, subSmp, ZERO_SMP, type Smp } from '../time';
import type { PlacedSegment, Range, SourcePosition, Timeline, VoiceSegment } from './types';

/*
 * 声トラック（EDL）の純粋関数群。DATA_MODEL.md §5。
 * すべて新しい配列を返し、入力を変更しない。
 *
 * 不変条件（DATA_MODEL.md §4.8）: 同一 Take の同一ソース範囲は声トラック上に高々 1 回しか現れない。
 * ここで定義する操作（削除・分割・挿入・並び替え）はこの不変条件を保つ。
 */

export function segmentDuration(seg: VoiceSegment): Smp {
  return subSmp(seg.srcEnd, seg.srcStart);
}

/** 各セグメントの声トラック上の位置を累積で求める。 */
export function placeVoice(voice: readonly VoiceSegment[]): PlacedSegment[] {
  const out: PlacedSegment[] = [];
  let cursor = ZERO_SMP;
  voice.forEach((segment, index) => {
    const end = addSmp(cursor, segmentDuration(segment));
    out.push({ segment, index, start: cursor, end });
    cursor = end;
  });
  return out;
}

export function totalDuration(voice: readonly VoiceSegment[]): Smp {
  return voice.reduce((acc, s) => addSmp(acc, segmentDuration(s)), ZERO_SMP);
}

/** 声トラック上の位置 → (takeId, srcSmp)。総尺以上なら null。 */
export function resolveSource(voice: readonly VoiceSegment[], tlSmp: Smp): SourcePosition | null {
  if (tlSmp < 0) return null;
  for (const p of placeVoice(voice)) {
    if (tlSmp >= p.start && tlSmp < p.end) {
      return {
        takeId: p.segment.takeId,
        srcSmp: addSmp(p.segment.srcStart, subSmp(tlSmp, p.start)),
        segmentIndex: p.index,
      };
    }
  }
  return null;
}

/**
 * (takeId, srcSmp) → 声トラック上の位置。その位置がカットされていれば null。
 * 不変条件により、該当は高々 1 つ。
 */
export function resolveTimeline(
  voice: readonly VoiceSegment[],
  takeId: string,
  srcSmp: Smp,
): Smp | null {
  for (const p of placeVoice(voice)) {
    const s = p.segment;
    if (s.takeId === takeId && srcSmp >= s.srcStart && srcSmp < s.srcEnd) {
      return addSmp(p.start, subSmp(srcSmp, s.srcStart));
    }
  }
  return null;
}

/**
 * Take 内の範囲 [srcA, srcB) が声トラック上でどこに現れるかを返す（複数セグメントに分かれ得る）。
 * 無音検出結果（Take 座標）を声トラック座標に写すために使う。
 */
export function sourceRangeToTimeline(
  voice: readonly VoiceSegment[],
  takeId: string,
  srcA: Smp,
  srcB: Smp,
): Range[] {
  const out: Range[] = [];
  for (const p of placeVoice(voice)) {
    const s = p.segment;
    if (s.takeId !== takeId) continue;
    const a = Math.max(srcA, s.srcStart);
    const b = Math.min(srcB, s.srcEnd);
    if (b > a) {
      out.push({
        start: addSmp(p.start, subSmp(smp(a), s.srcStart)),
        end: addSmp(p.start, subSmp(smp(b), s.srcStart)),
      });
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

/**
 * 声トラック上の位置でセグメントを分割する。境界上なら何もしない。
 * 分割後の 2 つ目の id は `${id}:${srcSmp}` とし決定的にする。
 */
export function splitAt(voice: readonly VoiceSegment[], tlSmp: Smp): VoiceSegment[] {
  const out: VoiceSegment[] = [];
  for (const p of placeVoice(voice)) {
    if (tlSmp > p.start && tlSmp < p.end) {
      const cut = addSmp(p.segment.srcStart, subSmp(tlSmp, p.start));
      const [a, b] = splitSegment(p.segment, cut);
      out.push(a, b);
    } else {
      out.push(p.segment);
    }
  }
  return out;
}

export function splitSegment(seg: VoiceSegment, srcCut: Smp): [VoiceSegment, VoiceSegment] {
  if (srcCut <= seg.srcStart || srcCut >= seg.srcEnd) {
    throw new RangeError(`splitSegment: cut ${srcCut} outside (${seg.srcStart}, ${seg.srcEnd})`);
  }
  const a: VoiceSegment = { ...seg, srcEnd: srcCut, fadeOut: ZERO_SMP };
  const b: VoiceSegment = {
    ...seg,
    id: `${seg.id}:${srcCut}`,
    srcStart: srcCut,
    fadeIn: ZERO_SMP,
  };
  return [a, b];
}

/** 声トラック上の [a, b) を削除する。後続は前に詰まる。オーバーレイは呼び出し側が再解決する。 */
export function deleteRange(voice: readonly VoiceSegment[], a: Smp, b: Smp): VoiceSegment[] {
  if (b <= a) return [...voice];
  const total = totalDuration(voice);
  const start = smp(Math.max(0, a));
  const end = smp(Math.min(total, b));
  if (end <= start) return [...voice];
  const split = splitAt(splitAt(voice, start), end);
  return placeVoice(split)
    .filter((p) => !(p.start >= start && p.end <= end))
    .map((p) => p.segment);
}

/** 複数範囲をまとめて削除する（重なり・順不同可）。 */
export function deleteRanges(
  voice: readonly VoiceSegment[],
  ranges: readonly Range[],
): VoiceSegment[] {
  const merged = mergeRanges(ranges);
  // 後ろから消せば前の範囲の座標がずれない
  let cur = [...voice];
  for (let i = merged.length - 1; i >= 0; i--) {
    const r = merged[i]!;
    cur = deleteRange(cur, r.start, r.end);
  }
  return cur;
}

export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = ranges
    .filter((r) => r.end > r.start)
    .map((r) => ({ ...r }))
    .sort((x, y) => x.start - y.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
    } else {
      out.push(r);
    }
  }
  return out;
}

/** 声トラック上の位置に新しいセグメントを挿入する（境界でなければ分割してから）。 */
export function insertAt(
  voice: readonly VoiceSegment[],
  tlSmp: Smp,
  seg: VoiceSegment,
): VoiceSegment[] {
  const total = totalDuration(voice);
  if (tlSmp >= total) return [...voice, seg];
  if (tlSmp <= 0) return [seg, ...voice];
  const split = splitAt(voice, tlSmp);
  const idx = placeVoice(split).findIndex((p) => p.start === tlSmp);
  const out = [...split];
  out.splice(idx === -1 ? out.length : idx, 0, seg);
  return out;
}

/** セグメントを index から toIndex へ移動（並び替え）。 */
export function moveSegment(
  voice: readonly VoiceSegment[],
  fromIndex: number,
  toIndex: number,
): VoiceSegment[] {
  if (fromIndex < 0 || fromIndex >= voice.length) throw new RangeError('moveSegment: fromIndex');
  const to = Math.max(0, Math.min(voice.length - 1, toIndex));
  const out = [...voice];
  const [s] = out.splice(fromIndex, 1);
  out.splice(to, 0, s!);
  return out;
}

/** Take 全体を 1 セグメントとして末尾に追加する（録音停止時）。 */
export function appendTake(
  voice: readonly VoiceSegment[],
  seg: { id: string; takeId: string; durationSmp: Smp },
): VoiceSegment[] {
  return [
    ...voice,
    {
      id: seg.id,
      takeId: seg.takeId,
      srcStart: ZERO_SMP,
      srcEnd: seg.durationSmp,
      gainDb: 0,
      fadeIn: ZERO_SMP,
      fadeOut: ZERO_SMP,
    },
  ];
}

/**
 * `[0, total)` から `ranges` を除いた残りの区間（昇順・重なりなし）。
 * 収録中の「言い直す」で捨てた範囲を Take から除くのに使う（FR-REC-4）。
 * `ranges` は順不同でも重なっていてもよい。
 */
export function keptIntervals(total: Smp, ranges: readonly Range[]): Range[] {
  if (total <= 0) return [];
  const sorted = ranges
    .map((r) => ({
      start: Math.max(0, Math.min(total, r.start)),
      end: Math.max(0, Math.min(total, r.end)),
    }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  const out: Range[] = [];
  let cursor = 0;
  for (const m of merged) {
    if (m.start > cursor) out.push({ start: smp(cursor), end: smp(m.start) });
    cursor = m.end;
  }
  if (cursor < total) out.push({ start: smp(cursor), end: total });
  return out;
}

/** 隣接し、同じ Take で連続しているセグメントを結合する（表示・レンダの単純化用）。 */
export function coalesce(voice: readonly VoiceSegment[]): VoiceSegment[] {
  const out: VoiceSegment[] = [];
  for (const s of voice) {
    const last = out[out.length - 1];
    if (
      last &&
      last.takeId === s.takeId &&
      last.srcEnd === s.srcStart &&
      last.gainDb === s.gainDb &&
      last.fadeOut === 0 &&
      s.fadeIn === 0
    ) {
      out[out.length - 1] = { ...last, srcEnd: s.srcEnd, fadeOut: s.fadeOut };
    } else {
      out.push(s);
    }
  }
  return out;
}

/**
 * 不変条件の検査: 同一 Take の範囲が重なっていれば違反ペアを返す。
 * 空配列なら OK。テストと data-safety のガードに使う。
 */
export function findSourceOverlaps(voice: readonly VoiceSegment[]): [VoiceSegment, VoiceSegment][] {
  const bad: [VoiceSegment, VoiceSegment][] = [];
  for (let i = 0; i < voice.length; i++) {
    for (let j = i + 1; j < voice.length; j++) {
      const a = voice[i]!;
      const b = voice[j]!;
      if (a.takeId === b.takeId && a.srcStart < b.srcEnd && b.srcStart < a.srcEnd) {
        bad.push([a, b]);
      }
    }
  }
  return bad;
}

export function assertVoiceInvariant(voice: readonly VoiceSegment[]): void {
  for (const s of voice) {
    if (s.srcEnd <= s.srcStart) throw new Error(`voice invariant: empty segment ${s.id}`);
  }
  const bad = findSourceOverlaps(voice);
  if (bad.length) {
    const [a, b] = bad[0]!;
    throw new Error(`voice invariant: overlapping source ranges ${a.id} / ${b.id}`);
  }
}

export function isValidTimeline(tl: Timeline): boolean {
  try {
    assertVoiceInvariant(tl.voice);
    return true;
  } catch {
    return false;
  }
}
