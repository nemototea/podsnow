import type { OverlayClip, VoiceSegment } from '../timeline/types';

import type { DuckingSettings, LoudnessSettings } from './types';

/** 書き出す音を決める入力（DATA_MODEL.md §4.13 `source_fingerprint`）。 */
export interface FingerprintSource {
  voice: readonly VoiceSegment[];
  overlays: readonly OverlayClip[];
  /**
   * 音の仕上げ。既定値で埋めたもの（`'{}'` と既定値を書いた JSON を同じにする）。
   * 項目が増えても（ノイズ除去など。FR-SND-3）そのまま指紋に入る。
   */
  sound: { loudness: LoudnessSettings; ducking: DuckingSettings };
}

/**
 * 書き出す音の中身の指紋（Issue #168、REQUIREMENTS.md FR-EP-7）。
 * 同じ指紋なら、同じ声の並び・素材・音の仕上げから作った音とみなす。
 *
 * - 行の `id` は入れない（中身が同じなら同じ音）。取り消しで元に戻せば同じ値に戻る。
 * - 声の並びは順に意味があるので順のまま、素材は重ねるだけなので順を問わない。
 * - ファイルのパスは入れない（iOS はアプリの更新で絶対パスが変わる）。
 * - 書き出しの形式（プリセット）は入れない。同じ編集を別の形式で書き出しても「今の編集と同じ」。
 */
export function renderFingerprint(src: FingerprintSource): string {
  const voice = src.voice.map(({ id: _id, ...rest }) => canonical(rest));
  const overlays = src.overlays.map(({ id: _id, ...rest }) => canonical(rest)).sort();
  return hash(`v1|${voice.join(',')}|${overlays.join(',')}|${canonical(src.sound)}`);
}

/** キーを並べ替えた JSON。`undefined` のキーは落とす（JSON.stringify と同じ）。 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

/** 53 bit のハッシュを種違いで 2 つ並べる（cyrb53）。暗号用途ではない。 */
function hash(text: string): string {
  return cyrb53(text, 0x5eed) + cyrb53(text, 0xc0ffee);
}

function cyrb53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}
