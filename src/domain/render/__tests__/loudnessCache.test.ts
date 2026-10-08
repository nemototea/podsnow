import {
  findCachedGain,
  interimGain,
  LOUDNESS_ALGO,
  parseLoudnessCache,
  shiftGain,
  upsertLoudnessCache,
  type LoudnessCacheEntry,
} from '../loudnessCache';
import { DEFAULT_LOUDNESS } from '../types';

const entry = (over: Partial<LoudnessCacheEntry> = {}): LoudnessCacheEntry => ({
  fingerprint: 'fp',
  channels: 1,
  algo: LOUDNESS_ALGO,
  gainDb: 4,
  targetLufs: -16,
  inputLufs: -20,
  measuredAt: 1,
  ...over,
});

describe('loudness cache (Issue #158)', () => {
  it('parses stored entries and drops broken ones', () => {
    const json = JSON.stringify([
      entry(),
      { ...entry(), channels: 3 },
      { ...entry(), gainDb: 'x' },
      { ...entry(), inputLufs: null, channels: 2 },
      null,
    ]);
    expect(parseLoudnessCache(json)).toEqual([entry(), entry({ inputLufs: null, channels: 2 })]);
    expect(parseLoudnessCache('{nope')).toEqual([]);
    expect(parseLoudnessCache('{}')).toEqual([]);
    expect(parseLoudnessCache(null)).toEqual([]);
  });

  it('hits only for the same sound, channel count and algorithm', () => {
    const entries = [entry(), entry({ channels: 2, gainDb: 1 })];
    expect(findCachedGain(entries, 'fp', 1)).toBe(4);
    expect(findCachedGain(entries, 'fp', 2)).toBe(1);
    expect(findCachedGain(entries, 'other', 1)).toBeNull();
    expect(findCachedGain([entry({ algo: LOUDNESS_ALGO + 1 })], 'fp', 1)).toBeNull();
  });

  it('holds the previous gain for this channel count, shifted by the target difference', () => {
    const entries = [
      entry({ fingerprint: 'old', measuredAt: 1, gainDb: 2 }),
      entry({ fingerprint: 'newer', measuredAt: 5, gainDb: 3 }),
      entry({ channels: 2, gainDb: 9 }),
    ];
    expect(interimGain(entries, 1, DEFAULT_LOUDNESS)).toBe(3);
    expect(interimGain(entries, 1, { ...DEFAULT_LOUDNESS, targetLufs: -14 })).toBe(5);
    // 前回が無ければ調整なし
    expect(interimGain([entry({ channels: 2 })], 1, DEFAULT_LOUDNESS)).toBeNull();
  });

  it('clamps shifted gains to the native range', () => {
    expect(shiftGain(19, -16, -10)).toBe(20);
    expect(shiftGain(-39, -16, -30)).toBe(-40);
  });

  it('keeps one entry per channel count', () => {
    let entries = upsertLoudnessCache([], entry({ channels: 2 }));
    entries = upsertLoudnessCache(entries, entry({ channels: 1, gainDb: 1 }));
    entries = upsertLoudnessCache(entries, entry({ channels: 1, gainDb: 2, fingerprint: 'b' }));
    expect(entries.map((e) => [e.channels, e.gainDb, e.fingerprint])).toEqual([
      [1, 2, 'b'],
      [2, 4, 'fp'],
    ]);
  });
});
