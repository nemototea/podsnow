import { File } from 'expo-file-system';

import { resolveSource } from '@/domain/timeline/voice';
import type { VoiceSegment } from '@/domain/timeline/types';
import { joinRoot } from '@/infra/files/layout';

/** .peaks（PKS1）を読む。戻り値は (min,max) の Int8 ペア列と 1 秒あたりの個数。 */
export interface PeaksData {
  perSecond: number;
  sampleRate: number;
  /** [min0, max0, min1, max1, ...] */
  data: Int8Array;
}

export function parsePeaks(bytes: Uint8Array): PeaksData | null {
  if (bytes.length < 16) return null;
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== 'PKS1') return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleRate = dv.getUint32(4, true);
  const perSecond = dv.getUint32(8, true);
  const count = dv.getUint32(12, true);
  const data = new Int8Array(
    bytes.buffer,
    bytes.byteOffset + 16,
    Math.min(count * 2, bytes.length - 16),
  );
  return { perSecond, sampleRate, data };
}

export async function readPeaksFile(root: string, rel: string): Promise<PeaksData | null> {
  try {
    const f = new File(`file://${joinRoot(root, rel)}`);
    if (!f.exists) return null;
    return parsePeaks(await f.bytes());
  } catch {
    return null;
  }
}

/** Take 単位に Segment のピークを連結したもの（Take 座標で引ける）。 */
export interface TakePeaks {
  perSecond: number;
  sampleRate: number;
  /** offsetSmp 昇順。 */
  parts: { offsetSmp: number; durationSmp: number; data: Int8Array }[];
}

export function lookupTakePeak(tp: TakePeaks, srcSmp: number): [number, number] {
  for (const p of tp.parts) {
    if (srcSmp >= p.offsetSmp && srcSmp < p.offsetSmp + p.durationSmp) {
      const idx = Math.floor(((srcSmp - p.offsetSmp) * tp.perSecond) / tp.sampleRate) * 2;
      if (idx + 1 < p.data.length) return [p.data[idx]!, p.data[idx + 1]!];
      return [0, 0];
    }
  }
  return [0, 0];
}

/**
 * 声トラックの [fromSmp, toSmp) を columns 本の棒にまとめる。各棒は [min, max]（-127..127）。
 * 棒の幅の中で複数ピークを走査して min/max を取る。
 */
export function sampleVoiceColumns(
  voice: readonly VoiceSegment[],
  peaksByTake: ReadonlyMap<string, TakePeaks>,
  fromSmp: number,
  toSmp: number,
  columns: number,
): Int8Array {
  const out = new Int8Array(columns * 2);
  if (columns <= 0 || toSmp <= fromSmp) return out;
  const step = (toSmp - fromSmp) / columns;
  for (let c = 0; c < columns; c++) {
    const a = fromSmp + c * step;
    const b = a + step;
    let mn = 0;
    let mx = 0;
    // 棒の中を最大 4 点サンプルする（ピーク解像度 10 ms を大きく超えるズームでは十分）
    const n = Math.max(1, Math.min(4, Math.round(step / 480)));
    for (let k = 0; k < n; k++) {
      const t = Math.floor(a + ((b - a) * (k + 0.5)) / n);
      const src = resolveSource(voice, t as never);
      if (!src) continue;
      const tp = peaksByTake.get(src.takeId);
      if (!tp) continue;
      const [lo, hi] = lookupTakePeak(tp, src.srcSmp);
      if (lo < mn) mn = lo;
      if (hi > mx) mx = hi;
    }
    out[c * 2] = mn;
    out[c * 2 + 1] = mx;
  }
  return out;
}
