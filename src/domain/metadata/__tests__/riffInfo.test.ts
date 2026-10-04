import { concat, fourcc, u32le } from '../bytes';
import type { ExportTags } from '../exportTags';
import { buildInfoList, readRiffInfo, riffChunks } from '../riffInfo';

const TAGS: ExportTags = {
  title: 'ab',
  artist: '日本',
  album: null,
  track: 5,
  date: '2026-10-03T21:00:00+09:00',
  genre: 'Podcast',
  encoder: 'PodsNow 0.1.0',
};

function wav(extra: Uint8Array = new Uint8Array(0)) {
  const fmt = concat([fourcc('fmt '), u32le(16), new Uint8Array(16)]);
  const data = concat([fourcc('data'), u32le(4), new Uint8Array(4)]);
  const body = concat([fourcc('WAVE'), fmt, data, extra]);
  return concat([fourcc('RIFF'), u32le(body.length), body]);
}

describe('LIST/INFO (Issue #56)', () => {
  it('round-trips text fields and omits empty ones', () => {
    expect(readRiffInfo(wav(buildInfoList(TAGS)))).toEqual({
      INAM: 'ab',
      IART: '日本',
      ITRK: '5',
      ICRD: '2026-10-03',
      IGNR: 'Podcast',
      ISFT: 'PodsNow 0.1.0',
    });
  });

  it('pads odd-length values to an even boundary and counts the NUL', () => {
    // 'ab' + NUL = 3 バイト → 1 バイト詰める
    const list = buildInfoList({ ...TAGS, artist: null, track: null, date: null });
    expect(list.length % 2).toBe(0);
    const inam = list.subarray(12, 12 + 12);
    expect(String.fromCharCode(...inam.subarray(0, 4))).toBe('INAM');
    expect(inam[4]).toBe(3);
    expect(Array.from(inam.subarray(8, 12))).toEqual([0x61, 0x62, 0, 0]);
    expect(riffChunks(wav(list)).map((c) => c.id)).toEqual(['fmt ', 'data', 'LIST']);
  });

  it('rejects files whose chunk sizes do not add up', () => {
    const b = wav();
    b[4] = (b[4] ?? 0) + 2;
    expect(() => riffChunks(b)).toThrow('truncated');
    expect(() => riffChunks(fourcc('RIFF'))).toThrow('not a RIFF/WAVE');
  });
});
