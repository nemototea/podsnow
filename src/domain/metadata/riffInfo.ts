/**
 * WAV の `LIST/INFO` チャンク（Issue #56）。題名などの文字だけを書き、アートワークは入れない
 * （WAV にアートワークの標準は無い。AUDIO_DESIGN.md §8.3）。
 *
 * 文字は UTF-8 の C 文字列（終端 NUL 込みの長さ）。奇数長なら 1 バイト詰める（RIFF のチャンク境界は偶数）。
 * 【仮説】古い Windows のアプリは INFO をコードページで読むため、日本語が化けることがある。
 */
import { concat, fourcc, readFourcc, u32le, utf8Decode, utf8Encode, view } from './bytes';
import type { ExportTags } from './exportTags';

function chunk(id: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2 ? [new Uint8Array(1)] : [];
  return concat([fourcc(id), u32le(data.length), data, ...pad]);
}

function cString(s: string): Uint8Array {
  return concat([utf8Encode(s), new Uint8Array(1)]);
}

/** `LIST` チャンク（ヘッダ込み）。WAV の末尾に足し、RIFF の長さを直して使う。 */
export function buildInfoList(tags: ExportTags): Uint8Array {
  const entries: [string, string | null][] = [
    ['INAM', tags.title],
    ['IART', tags.artist],
    ['IPRD', tags.album],
    ['ITRK', tags.track != null && tags.track > 0 ? String(tags.track) : null],
    ['ICRD', tags.date ? tags.date.slice(0, 10) : null],
    ['IGNR', tags.genre],
    ['ISFT', tags.encoder],
  ];
  const subs = entries.filter(([, v]) => v).map(([id, v]) => chunk(id, cString(v!)));
  return chunk('LIST', concat([fourcc('INFO'), ...subs]));
}

export interface RiffChunk {
  id: string;
  /** ファイル先頭からの位置（ヘッダの位置）。 */
  start: number;
  /** データの長さ（ヘッダ・詰め物を含まない）。 */
  size: number;
}

/** WAV 全体のバイト列からチャンクを並べる。RIFF の長さとファイルの長さが合わなければ例外。 */
export function riffChunks(b: Uint8Array): RiffChunk[] {
  const v = view(b);
  if (b.length < 12 || readFourcc(b, 0) !== 'RIFF' || readFourcc(b, 8) !== 'WAVE')
    throw new Error('wav: not a RIFF/WAVE');
  const end = 8 + v.getUint32(4, true);
  if (end > b.length) throw new Error('wav: truncated');
  const out: RiffChunk[] = [];
  let p = 12;
  while (p + 8 <= end) {
    const size = v.getUint32(p + 4, true);
    out.push({ id: readFourcc(b, p), start: p, size });
    p += 8 + size + (size % 2);
  }
  if (p !== end) throw new Error('wav: bad chunk sizes');
  return out;
}

/** `LIST/INFO` の中身を読む（ID → 文字列）。 */
export function readRiffInfo(b: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of riffChunks(b)) {
    if (c.id !== 'LIST' || readFourcc(b, c.start + 8) !== 'INFO') continue;
    const v = view(b);
    let p = c.start + 12;
    const end = c.start + 8 + c.size;
    while (p + 8 <= end) {
      const size = v.getUint32(p + 4, true);
      let data = b.subarray(p + 8, p + 8 + size);
      const nul = data.indexOf(0);
      if (nul >= 0) data = data.subarray(0, nul);
      out[readFourcc(b, p)] = utf8Decode(data);
      p += 8 + size + (size % 2);
    }
  }
  return out;
}
