/**
 * M4A への iTunes 形式メタデータ（`moov/udta/meta/ilst`）の書き込みと読み戻し（Issue #56）。
 *
 * - Android の MediaMuxer にはこれを書く API が無い【確認済み】ので、両 OS とも書き出しの後で
 *   `moov` を組み直す（AUDIO_DESIGN.md §8.3）。ここはバイト列だけを扱い、ファイルには触らない。
 * - 値の型は QuickTime の well-known types（UTF-8 = 1、JPEG = 13、PNG = 14、暗黙 = 0）。
 *   https://developer.apple.com/documentation/quicktime-file-format/well-known_types
 * - `moov` が `mdat` より前にあると、`moov` が大きくなった分だけ音声データが後ろへずれる。
 *   そのときは `stco` / `co64`（チャンクの位置）を同じだけずらす。
 */
import { concat, fourcc, readFourcc, u32be, utf8Decode, utf8Encode, view } from './bytes';
import type { CoverImage, ExportTags } from './exportTags';

export interface Mp4Box {
  type: string;
  /** 親（または渡したバイト列）の先頭からの位置。 */
  start: number;
  /** ヘッダを含む大きさ。 */
  size: number;
  /** ヘッダの大きさ（8、64 bit 長なら 16）。 */
  header: number;
}

/** `b[from, to)` に並んでいる箱を読む。壊れていれば例外。 */
export function mp4Boxes(b: Uint8Array, from = 0, to = b.length): Mp4Box[] {
  const v = view(b);
  const out: Mp4Box[] = [];
  let p = from;
  while (p < to) {
    if (p + 8 > to) throw new Error(`mp4: truncated box header at ${p}`);
    let size = v.getUint32(p);
    const type = readFourcc(b, p + 4);
    let header = 8;
    if (size === 1) {
      if (p + 16 > to) throw new Error(`mp4: truncated largesize at ${p}`);
      size = getU64(v, p + 8);
      header = 16;
    } else if (size === 0) {
      size = to - p;
    }
    if (size < header || p + size > to) throw new Error(`mp4: bad box size ${type} at ${p}`);
    out.push({ type, start: p, size, header });
    p += size;
  }
  return out;
}

/** 64 bit の符号なし整数（2^53 まで）。BigInt を使わない。 */
function getU64(v: DataView, at: number): number {
  return v.getUint32(at) * 0x1_0000_0000 + v.getUint32(at + 4);
}

function setU64(v: DataView, at: number, n: number): void {
  v.setUint32(at, Math.floor(n / 0x1_0000_0000));
  v.setUint32(at + 4, n % 0x1_0000_0000);
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  return concat([u32be(8 + body.length), fourcc(type), body]);
}

const FULL_BOX_ZERO = new Uint8Array(4);

/** ilst の 1 項目（`data` 箱 1 つ）。 */
function item(type: string, dataType: number, payload: Uint8Array): Uint8Array {
  return box(type, box('data', u32be(dataType), u32be(0), payload));
}

const text = (type: string, value: string | null) =>
  value ? [item(type, 1, utf8Encode(value))] : [];

/** `trkn`: 予約 2 バイト・番号 2 バイト・総数 2 バイト・予約 2 バイト。 */
function trackItem(track: number | null): Uint8Array[] {
  if (track == null || track <= 0) return [];
  const p = new Uint8Array(8);
  view(p).setUint16(2, Math.min(track, 0xffff));
  return [item('trkn', 0, p)];
}

/** `moov/udta/meta`。ハンドラは iTunes の `mdir`（ffmpeg・AtomicParsley と同じ形）。 */
export function buildMetaBox(tags: ExportTags, cover: CoverImage | null): Uint8Array {
  const hdlr = box(
    'hdlr',
    FULL_BOX_ZERO,
    u32be(0), // pre_defined
    fourcc('mdir'),
    fourcc('appl'),
    u32be(0),
    u32be(0),
    new Uint8Array(1), // 名前（空の C 文字列）
  );
  const ilst = box(
    'ilst',
    ...text('©nam', tags.title),
    ...text('©ART', tags.artist),
    ...text('aART', tags.artist),
    ...text('©alb', tags.album),
    ...trackItem(tags.track),
    ...text('©day', tags.date),
    ...text('©gen', tags.genre),
    ...text('©too', tags.encoder),
    ...(cover ? [item('covr', cover.kind === 'jpeg' ? 13 : 14, cover.bytes)] : []),
  );
  return box('meta', FULL_BOX_ZERO, hdlr, ilst);
}

/**
 * `moov` 箱（ヘッダ込み）にメタデータを入れたものを返す。
 * 既存の `udta/meta` は置き換え、`udta` のほかの子（位置情報など）は残す。
 *
 * @param moovOffset ファイル内での `moov` の位置。これより後ろを指すチャンク位置をずらす。
 */
export function rewriteMoov(
  moov: Uint8Array,
  moovOffset: number,
  tags: ExportTags,
  cover: CoverImage | null,
): Uint8Array {
  const [top] = mp4Boxes(moov);
  if (!top || top.type !== 'moov' || top.size !== moov.length) throw new Error('mp4: not a moov');
  const meta = buildMetaBox(tags, cover);
  const parts: Uint8Array[] = [];
  let hasUdta = false;
  for (const c of mp4Boxes(moov, top.header, top.size)) {
    const bytes = moov.subarray(c.start, c.start + c.size);
    if (c.type !== 'udta') {
      parts.push(bytes);
      continue;
    }
    hasUdta = true;
    const keep = mp4Boxes(moov, c.start + c.header, c.start + c.size)
      .filter((k) => k.type !== 'meta')
      .map((k) => moov.subarray(k.start, k.start + k.size));
    parts.push(box('udta', ...keep, meta));
  }
  if (!hasUdta) parts.push(box('udta', meta));
  const out = box('moov', ...parts);
  shiftChunkOffsets(out, moovOffset + moov.length, out.length - moov.length);
  return out;
}

/** `moov` の中の `stco` / `co64` を探す。 */
function chunkOffsetBoxes(moov: Uint8Array): Mp4Box[] {
  const found: Mp4Box[] = [];
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts']);
  const walk = (from: number, to: number) => {
    for (const c of mp4Boxes(moov, from, to)) {
      if (c.type === 'stco' || c.type === 'co64') found.push(c);
      else if (containers.has(c.type)) walk(c.start + c.header, c.start + c.size);
    }
  };
  walk(0, moov.length);
  return found;
}

/** ファイル内で `oldEnd` 以降を指すチャンク位置に `delta` を足す（その場で書き換える）。 */
function shiftChunkOffsets(moov: Uint8Array, oldEnd: number, delta: number): void {
  if (delta === 0) return;
  const v = view(moov);
  for (const b of chunkOffsetBoxes(moov)) {
    const p = b.start + b.header + 4; // version / flags の後
    const n = v.getUint32(p);
    const wide = b.type === 'co64';
    if (8 + 4 + 4 + n * (wide ? 8 : 4) > b.size) throw new Error(`mp4: bad ${b.type}`);
    for (let i = 0; i < n; i++) {
      const at = p + 4 + i * (wide ? 8 : 4);
      const off = wide ? getU64(v, at) : v.getUint32(at);
      if (off < oldEnd) continue;
      if (wide) setU64(v, at, off + delta);
      else {
        if (off + delta > 0xffffffff) throw new Error('mp4: stco overflow');
        v.setUint32(at, off + delta);
      }
    }
  }
}

/** `moov` の中のチャンク位置をすべて返す（確かめる用）。 */
export function mp4ChunkOffsets(moov: Uint8Array): number[] {
  const v = view(moov);
  const out: number[] = [];
  for (const b of chunkOffsetBoxes(moov)) {
    const p = b.start + b.header + 4;
    const n = v.getUint32(p);
    for (let i = 0; i < n; i++) {
      out.push(b.type === 'co64' ? getU64(v, p + 4 + i * 8) : v.getUint32(p + 4 + i * 4));
    }
  }
  return out;
}

/** 読み戻したメタデータ。 */
export interface Mp4Tags {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  track?: number;
  date?: string;
  genre?: string;
  encoder?: string;
  cover?: CoverImage;
  /** `moov/udta/meta` の数（置き換えで重複していないかを見る）。 */
  metaCount: number;
}

/** `moov` 箱（ヘッダ込み）から iTunes 形式のメタデータを読む。 */
export function readMp4Tags(moov: Uint8Array): Mp4Tags {
  const out: Mp4Tags = { metaCount: 0 };
  const [top] = mp4Boxes(moov);
  if (!top || top.type !== 'moov') throw new Error('mp4: not a moov');
  for (const u of mp4Boxes(moov, top.header, top.size).filter((c) => c.type === 'udta')) {
    for (const m of mp4Boxes(moov, u.start + u.header, u.start + u.size)) {
      if (m.type !== 'meta') continue;
      out.metaCount++;
      const ilst = mp4Boxes(moov, m.start + m.header + 4, m.start + m.size).find(
        (c) => c.type === 'ilst',
      );
      if (ilst) readIlst(moov, ilst, out);
    }
  }
  return out;
}

function readIlst(b: Uint8Array, ilst: Mp4Box, out: Mp4Tags): void {
  const v = view(b);
  for (const it of mp4Boxes(b, ilst.start + ilst.header, ilst.start + ilst.size)) {
    const data = mp4Boxes(b, it.start + it.header, it.start + it.size).find(
      (c) => c.type === 'data',
    );
    if (!data) continue;
    const dataType = v.getUint32(data.start + data.header) & 0xffffff;
    const payload = b.slice(data.start + data.header + 8, data.start + data.size);
    const s = () => utf8Decode(payload);
    switch (it.type) {
      case '©nam':
        out.title = s();
        break;
      case '©ART':
        out.artist = s();
        break;
      case 'aART':
        out.albumArtist = s();
        break;
      case '©alb':
        out.album = s();
        break;
      case '©day':
        out.date = s();
        break;
      case '©gen':
        out.genre = s();
        break;
      case '©too':
        out.encoder = s();
        break;
      case 'trkn':
        if (payload.length >= 4) out.track = view(payload).getUint16(2);
        break;
      case 'covr':
        if (dataType === 13 || dataType === 14)
          out.cover = { kind: dataType === 13 ? 'jpeg' : 'png', bytes: payload };
        break;
    }
  }
}
