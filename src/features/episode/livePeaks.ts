import { useState } from 'react';

import type { LevelEvent } from '../../../modules/podsnow-recorder/src/PodsnowRecorder.types';

/**
 * 録音中の波形（収録タブ）。録音中はまだ .peaks が無いので、level イベント（既定 50ms ごと）の
 * ピークを溜めて描く。表示だけに使い、保存しない（止めた後は .peaks の波形に置き換わる）。
 */
export interface LivePeak {
  /** 録音開始からのフレーム数（`LevelEvent.frames`）。 */
  frames: number;
  /** 0..1 の振幅。 */
  amp: number;
}

/**
 * dBFS を振幅（0..1）にする。.peaks と同じ線形の値にそろえ、止めて .peaks の波形に
 * 置き換わったときに棒の高さが跳ねないようにする（メーターの dB 目盛りとは別）。
 */
export function levelAmp(peakDb: number): number {
  if (!Number.isFinite(peakDb)) return 0;
  return Math.min(1, 10 ** (Math.min(0, peakDb) / 20));
}

/** 1 つ足す。フレームが戻ったら（新しいテイク・Segment）溜めたものを捨てて始め直す。 */
export function appendLivePeak(list: LivePeak[], e: LevelEvent): LivePeak[] {
  const last = list[list.length - 1];
  const p = { frames: e.frames, amp: levelAmp(e.peakDb) };
  if (last && e.frames < last.frames) return [p];
  if (last && e.frames === last.frames) {
    // 一時停止中はフレームが進まない。同じ位置は大きい方を残す
    if (p.amp > last.amp) list[list.length - 1] = p;
    return list;
  }
  list.push(p);
  return list;
}

/** `frames` より後の最初の位置（二分探索）。 */
function upperBound(list: readonly LivePeak[], frames: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.frames <= frames) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * [from, to) を `n` 本の柱に分け、柱ごとの最大の振幅を返す。
 * level イベントのピークは `frames` までの音なので、柱 (a, b] に入るイベントを数える。
 * イベントより柱が細かいときは、その柱を含む次のイベントの値で埋める（棒が歯抜けにならない）。
 * 録った長さより先の柱は 0。
 */
export function liveColumns(
  list: readonly LivePeak[],
  from: number,
  to: number,
  n: number,
): Float32Array {
  const out = new Float32Array(Math.max(0, n));
  if (n <= 0 || list.length === 0 || to <= from) return out;
  const step = (to - from) / n;
  const end = list[list.length - 1]!.frames;
  for (let i = 0; i < n; i++) {
    const a = from + i * step;
    if (a >= end) break;
    const b = a + step;
    let j = upperBound(list, a);
    let m = 0;
    if (list[j]!.frames > b) {
      m = list[j]!.amp;
    } else {
      for (; j < list.length && list[j]!.frames <= b; j++) m = Math.max(m, list[j]!.amp);
    }
    out[i] = m;
  }
  return out;
}

/**
 * 録音中の level を溜める。`active` が偽になったら捨てる。
 * 60 分で約 7 万件になるので、イベントごとに配列を作り直さず末尾に足す。
 * `appendLivePeak` は同じイベントを 2 回渡しても結果が変わらない（同じフレームは大きい方を残す）。
 */
export function useLivePeaks(level: LevelEvent | null, active: boolean): readonly LivePeak[] {
  const [st, setSt] = useState<{
    level: LevelEvent | null;
    active: boolean;
    list: LivePeak[];
  }>({ level: null, active: false, list: [] });
  if (st.level !== level || st.active !== active) {
    const list = !active ? [] : level ? appendLivePeak(st.list, level) : st.list;
    setSt({ level, active, list });
  }
  return st.list;
}
