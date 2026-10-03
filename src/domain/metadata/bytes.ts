/**
 * メタデータの埋め込み（Issue #56）で使うバイト列の小道具。
 * Hermes の TextEncoder / TextDecoder の有無に左右されないよう、UTF-8 は自前で変換する。
 */

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return Uint8Array.from(out);
}

/** 壊れた並びは U+FFFD にする（読み戻しの確認用）。 */
export function utf8Decode(b: Uint8Array): string {
  let s = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i]!;
    const need = c < 0x80 ? 0 : c >= 0xf0 ? 3 : c >= 0xe0 ? 2 : c >= 0xc0 ? 1 : -1;
    let cp = need === 0 ? c : c & (0x3f >> need);
    let ok = need >= 0 && i + need < b.length;
    for (let k = 1; ok && k <= need; k++) {
      const x = b[i + k]!;
      if ((x & 0xc0) !== 0x80) ok = false;
      cp = (cp << 6) | (x & 0x3f);
    }
    if (!ok) {
      s += '\ufffd';
      i++;
      continue;
    }
    s += String.fromCodePoint(cp);
    i += need + 1;
  }
  return s;
}

/** 4 文字の型（`©nam` の `©` は 0xA9 の 1 バイト）。Latin-1 として扱う。 */
export function fourcc(type: string): Uint8Array {
  if (type.length !== 4) throw new Error(`bad fourcc: ${type}`);
  return Uint8Array.from(type, (ch) => ch.charCodeAt(0) & 0xff);
}

export function readFourcc(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function u32be(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v);
  return b;
}

export function u32le(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
}

export function view(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}
