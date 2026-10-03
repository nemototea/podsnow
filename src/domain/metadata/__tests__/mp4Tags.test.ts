import { concat, fourcc, u32be } from '../bytes';
import type { ExportTags } from '../exportTags';
import { mp4Boxes, mp4ChunkOffsets, readMp4Tags, rewriteMoov } from '../mp4Tags';

const box = (type: string, ...body: Uint8Array[]) => {
  const b = concat(body);
  return concat([u32be(8 + b.length), fourcc(type), b]);
};
const zero4 = new Uint8Array(4);

function stco(offsets: number[]) {
  return box('stco', zero4, u32be(offsets.length), ...offsets.map(u32be));
}
function co64(offsets: number[]) {
  return box(
    'co64',
    zero4,
    u32be(offsets.length),
    ...offsets.map((o) => concat([u32be(Math.floor(o / 2 ** 32)), u32be(o % 2 ** 32)])),
  );
}
const trak = (chunks: Uint8Array) =>
  box('trak', box('tkhd', zero4), box('mdia', box('minf', box('stbl', chunks))));

const TAGS: ExportTags = {
  title: 'T',
  artist: 'A',
  album: 'B',
  track: 7,
  date: '2026-10-03T21:00:00+09:00',
  genre: 'Podcast',
  encoder: 'PodsNow 0.1.0',
};

describe('rewriteMoov (Issue #56)', () => {
  it('adds udta/meta/ilst and keeps the other boxes byte-for-byte', () => {
    const mvhd = box('mvhd', Uint8Array.from([1, 2, 3, 4]));
    const t = trak(stco([10, 20]));
    const moov = box('moov', mvhd, t);
    const out = rewriteMoov(moov, 1000, TAGS, null);
    const kids = mp4Boxes(out, 8).map((b) => b.type);
    expect(kids).toEqual(['mvhd', 'trak', 'udta']);
    expect(out.subarray(8, 8 + mvhd.length)).toEqual(mvhd);
    expect(readMp4Tags(out)).toMatchObject({
      title: 'T',
      artist: 'A',
      albumArtist: 'A',
      album: 'B',
      track: 7,
      metaCount: 1,
    });
    // moov より前を指すチャンクは動かさない
    expect(mp4ChunkOffsets(out)).toEqual([10, 20]);
  });

  it('shifts stco and co64 entries that point past the old moov', () => {
    const moov = box('moov', trak(stco([50, 5000, 6000])), trak(co64([2 ** 33, 40])));
    const moovOffset = 100;
    const oldEnd = moovOffset + moov.length;
    const out = rewriteMoov(moov, moovOffset, TAGS, null);
    const d = out.length - moov.length;
    expect(oldEnd).toBeLessThan(5000);
    expect(mp4ChunkOffsets(out)).toEqual([50, 5000 + d, 6000 + d, 2 ** 33 + d, 40]);
  });

  it('replaces an existing meta but keeps other udta children', () => {
    const xyz = box('©xyz', Uint8Array.from([0, 5, 0, 0, 0x2b, 0x33, 0x35]));
    const oldMeta = box('meta', zero4, box('ilst', box('©nam', box('data', u32be(1), zero4))));
    const moov = box('moov', box('udta', xyz, oldMeta));
    const out = rewriteMoov(moov, 0, TAGS, null);
    const udta = mp4Boxes(out, 8)[0]!;
    const kids = mp4Boxes(out, udta.start + 8, udta.start + udta.size);
    expect(kids.map((k) => k.type)).toEqual(['©xyz', 'meta']);
    expect(out.subarray(kids[0]!.start, kids[0]!.start + kids[0]!.size)).toEqual(xyz);
    expect(readMp4Tags(out)).toMatchObject({ title: 'T', metaCount: 1 });
  });

  it('writes the cover with the JPEG / PNG type and skips empty values', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3]);
    const out = rewriteMoov(
      box('moov'),
      0,
      { ...TAGS, title: null, track: null, date: null },
      { kind: 'png', bytes: png },
    );
    const tags = readMp4Tags(out);
    expect(tags.cover).toEqual({ kind: 'png', bytes: png });
    expect(tags.title).toBeUndefined();
    expect(tags.track).toBeUndefined();
    expect(tags.date).toBeUndefined();
  });

  it('copies 64-bit sized children unchanged', () => {
    const payload = Uint8Array.from([9, 9, 9]);
    const large = concat([u32be(1), fourcc('free'), u32be(0), u32be(16 + 3), payload]);
    const moov = box('moov', large);
    const out = rewriteMoov(moov, 0, TAGS, null);
    const kids = mp4Boxes(out, 8);
    expect(kids[0]).toMatchObject({ type: 'free', size: 19, header: 16 });
    expect(out.subarray(8, 8 + 19)).toEqual(large);
  });

  it('rejects broken input', () => {
    expect(() => rewriteMoov(box('mdat'), 0, TAGS, null)).toThrow('not a moov');
    const bad = box('moov', concat([u32be(100), fourcc('trak')]));
    expect(() => rewriteMoov(bad, 0, TAGS, null)).toThrow('bad box size');
    const shortStco = box('moov', trak(box('stco', zero4, u32be(5), u32be(1))));
    expect(() => rewriteMoov(shortStco, 0, TAGS, null)).toThrow('bad stco');
  });

  it('refuses to push a 32-bit chunk offset past 4 GiB', () => {
    const moov = box('moov', trak(stco([0xffffffff - 4])));
    expect(() => rewriteMoov(moov, 0, TAGS, null)).toThrow('stco overflow');
  });
});
