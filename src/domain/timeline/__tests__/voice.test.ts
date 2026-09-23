import { smp, ZERO_SMP, type Smp } from '../../time';
import type { VoiceSegment } from '../types';
import {
  appendTake,
  keptIntervals,
  assertVoiceInvariant,
  coalesce,
  deleteRange,
  deleteRanges,
  findSourceOverlaps,
  insertAt,
  mergeRanges,
  moveSegment,
  placeVoice,
  resolveSource,
  resolveTimeline,
  sourceRangeToTimeline,
  splitAt,
  totalDuration,
} from '../voice';

const seg = (id: string, takeId: string, a: number, b: number, extra: Partial<VoiceSegment> = {}) =>
  ({
    id,
    takeId,
    srcStart: smp(a),
    srcEnd: smp(b),
    gainDb: 0,
    fadeIn: ZERO_SMP,
    fadeOut: ZERO_SMP,
    ...extra,
  }) satisfies VoiceSegment;

// Take A: 0..1000, Take B: 0..500 を並べた声トラック
const base: VoiceSegment[] = [seg('a', 'A', 0, 1000), seg('b', 'B', 0, 500)];

describe('placeVoice / totalDuration', () => {
  it('places segments cumulatively', () => {
    const p = placeVoice(base);
    expect(p.map((x) => [x.start, x.end])).toEqual([
      [0, 1000],
      [1000, 1500],
    ]);
    expect(totalDuration(base)).toBe(1500);
  });
  it('empty voice has zero duration', () => {
    expect(totalDuration([])).toBe(0);
    expect(placeVoice([])).toEqual([]);
  });
});

describe('resolveSource / resolveTimeline', () => {
  it('round-trips positions inside the timeline', () => {
    for (const t of [0, 1, 999, 1000, 1499]) {
      const src = resolveSource(base, smp(t));
      expect(src).not.toBeNull();
      expect(resolveTimeline(base, src!.takeId, src!.srcSmp)).toBe(t);
    }
  });
  it('returns null outside the timeline', () => {
    expect(resolveSource(base, smp(1500))).toBeNull();
    expect(resolveSource(base, smp(-1))).toBeNull();
    expect(resolveTimeline(base, 'A', smp(1000))).toBeNull(); // srcEnd は排他
    expect(resolveTimeline(base, 'Z', smp(0))).toBeNull();
  });
  it('maps a source position after a cut in the middle', () => {
    // A の 200..300 を消す → A:300 は tl 200 に来る
    const cut = deleteRange(base, smp(200), smp(300));
    expect(resolveTimeline(cut, 'A', smp(300))).toBe(200);
    expect(resolveTimeline(cut, 'A', smp(250))).toBeNull();
    expect(resolveTimeline(cut, 'B', smp(0))).toBe(900);
  });
});

describe('splitAt', () => {
  it('splits a segment at an interior point and keeps source continuity', () => {
    const out = splitAt(base, smp(400));
    expect(out.map((s) => [s.takeId, s.srcStart, s.srcEnd])).toEqual([
      ['A', 0, 400],
      ['A', 400, 1000],
      ['B', 0, 500],
    ]);
    expect(out[1]!.id).toBe('a:400');
    assertVoiceInvariant(out);
  });
  it('is a no-op on boundaries', () => {
    expect(splitAt(base, smp(0))).toEqual(base);
    expect(splitAt(base, smp(1000))).toEqual(base);
    expect(splitAt(base, smp(1500))).toEqual(base);
  });
  it('moves fades to the outer edges only', () => {
    const v = [seg('a', 'A', 0, 1000, { fadeIn: smp(10), fadeOut: smp(20) })];
    const out = splitAt(v, smp(500));
    expect(out[0]!.fadeIn).toBe(10);
    expect(out[0]!.fadeOut).toBe(0);
    expect(out[1]!.fadeIn).toBe(0);
    expect(out[1]!.fadeOut).toBe(20);
  });
});

describe('deleteRange', () => {
  it('removes an interior range and closes the gap', () => {
    const out = deleteRange(base, smp(200), smp(300));
    expect(out.map((s) => [s.takeId, s.srcStart, s.srcEnd])).toEqual([
      ['A', 0, 200],
      ['A', 300, 1000],
      ['B', 0, 500],
    ]);
    expect(totalDuration(out)).toBe(1400);
    assertVoiceInvariant(out);
  });
  it('removes a range spanning two segments', () => {
    const out = deleteRange(base, smp(900), smp(1100));
    expect(out.map((s) => [s.takeId, s.srcStart, s.srcEnd])).toEqual([
      ['A', 0, 900],
      ['B', 100, 500],
    ]);
  });
  it('removes whole segments', () => {
    expect(deleteRange(base, smp(0), smp(1000))).toEqual([base[1]]);
    expect(deleteRange(base, smp(0), smp(1500))).toEqual([]);
  });
  it('clamps to the timeline and ignores empty ranges', () => {
    expect(deleteRange(base, smp(-100), smp(100))[0]!.srcStart).toBe(100);
    expect(totalDuration(deleteRange(base, smp(1400), smp(9999)))).toBe(1400);
    expect(deleteRange(base, smp(500), smp(500))).toEqual(base);
    expect(deleteRange(base, smp(600), smp(500))).toEqual(base);
  });
  it('deleteRanges handles overlapping and unordered ranges', () => {
    const out = deleteRanges(base, [
      { start: smp(1200), end: smp(1300) },
      { start: smp(100), end: smp(200) },
      { start: smp(150), end: smp(250) },
    ]);
    expect(totalDuration(out)).toBe(1500 - 150 - 100);
    expect(out.map((s) => [s.takeId, s.srcStart, s.srcEnd])).toEqual([
      ['A', 0, 100],
      ['A', 250, 1000],
      ['B', 0, 200],
      ['B', 300, 500],
    ]);
  });
  it('mergeRanges merges touching ranges', () => {
    expect(
      mergeRanges([
        { start: smp(5), end: smp(10) },
        { start: smp(0), end: smp(5) },
        { start: smp(20), end: smp(20) },
      ]),
    ).toEqual([{ start: 0, end: 10 }]);
  });
});

describe('insertAt / appendTake / moveSegment', () => {
  const c = seg('c', 'C', 0, 100);
  it('inserts at start, end, boundary and interior', () => {
    expect(insertAt(base, smp(0), c)[0]).toBe(c);
    expect(insertAt(base, smp(1500), c)[2]).toBe(c);
    expect(insertAt(base, smp(1000), c).map((s) => s.id)).toEqual(['a', 'c', 'b']);
    const mid = insertAt(base, smp(400), c);
    expect(mid.map((s) => [s.id, s.srcStart, s.srcEnd])).toEqual([
      ['a', 0, 400],
      ['c', 0, 100],
      ['a:400', 400, 1000],
      ['b', 0, 500],
    ]);
    assertVoiceInvariant(mid);
  });
  it('appendTake adds the whole take at the end', () => {
    const out = appendTake(base, { id: 'd', takeId: 'D', durationSmp: smp(42) });
    expect(out[2]).toMatchObject({ takeId: 'D', srcStart: 0, srcEnd: 42 });
  });
  it('moveSegment reorders and clamps', () => {
    expect(moveSegment(base, 1, 0).map((s) => s.id)).toEqual(['b', 'a']);
    expect(moveSegment(base, 0, 99).map((s) => s.id)).toEqual(['b', 'a']);
    expect(() => moveSegment(base, 5, 0)).toThrow();
  });
});

describe('punch-in (delete + insert)', () => {
  it('replaces a range with a new take without breaking the invariant', () => {
    const cut = deleteRange(base, smp(300), smp(600));
    const out = insertAt(cut, smp(300), seg('n', 'N', 0, 250));
    expect(out.map((s) => [s.takeId, s.srcStart, s.srcEnd])).toEqual([
      ['A', 0, 300],
      ['N', 0, 250],
      ['A', 600, 1000],
      ['B', 0, 500],
    ]);
    assertVoiceInvariant(out);
  });
});

describe('sourceRangeToTimeline', () => {
  it('maps a take range that has been split by a cut into two timeline ranges', () => {
    const cut = deleteRange(base, smp(400), smp(600));
    expect(sourceRangeToTimeline(cut, 'A', smp(300), smp(700))).toEqual([
      { start: 300, end: 400 },
      { start: 400, end: 500 },
    ]);
    expect(sourceRangeToTimeline(cut, 'B', smp(0), smp(10))).toEqual([{ start: 800, end: 810 }]);
    expect(sourceRangeToTimeline(cut, 'A', smp(450), smp(550))).toEqual([]);
  });
});

describe('coalesce', () => {
  it('joins adjacent continuous segments of the same take', () => {
    const split = splitAt(splitAt(base, smp(100)), smp(200));
    expect(split).toHaveLength(4);
    expect(coalesce(split)).toEqual(base);
  });
  it('does not join across a gap or a gain change', () => {
    const v = [
      seg('a', 'A', 0, 100),
      seg('a2', 'A', 200, 300),
      seg('a3', 'A', 300, 400, { gainDb: -3 }),
    ];
    expect(coalesce(v)).toHaveLength(3);
  });
});

describe('invariant', () => {
  it('detects overlapping source ranges of the same take', () => {
    const bad = [seg('x', 'A', 0, 100), seg('y', 'A', 50, 150)];
    expect(findSourceOverlaps(bad)).toHaveLength(1);
    expect(() => assertVoiceInvariant(bad)).toThrow(/overlapping/);
    expect(findSourceOverlaps(base)).toEqual([]);
  });
  it('allows the same range from different takes', () => {
    expect(findSourceOverlaps([seg('x', 'A', 0, 100), seg('y', 'B', 0, 100)])).toEqual([]);
  });
  it('is preserved by random sequences of edits (property-style)', () => {
    let v: VoiceSegment[] = [seg('a', 'A', 0, 5000), seg('b', 'B', 0, 3000)];
    let rng = 12345;
    const rand = (n: number) => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return rng % n;
    };
    for (let i = 0; i < 300; i++) {
      const total = totalDuration(v);
      const op = rand(4);
      if (op === 0 && total > 10) {
        const a = rand(total) as Smp;
        const b = smp(a + rand(Math.max(1, total - a)) + 1);
        v = deleteRange(v, a, b);
      } else if (op === 1) {
        v = insertAt(v, smp(rand(total + 1)), seg(`n${i}`, `N${i}`, 0, 1 + rand(400)));
      } else if (op === 2 && v.length > 1) {
        v = moveSegment(v, rand(v.length), rand(v.length));
      } else if (total > 0) {
        v = splitAt(v, smp(rand(total)));
      }
      assertVoiceInvariant(v);
      // 再解決の整合: 任意の tl 位置は source に写り、戻ってくる
      const t = totalDuration(v);
      if (t > 0) {
        const p = smp(rand(t));
        const s = resolveSource(v, p)!;
        expect(resolveTimeline(v, s.takeId, s.srcSmp)).toBe(p);
      }
    }
  });
});

describe('keptIntervals', () => {
  it('捨てた範囲を除いた残りを返す', () => {
    expect(keptIntervals(smp(1000), [{ start: smp(200), end: smp(400) }])).toEqual([
      { start: 0, end: 200 },
      { start: 400, end: 1000 },
    ]);
  });

  it('捨てた範囲がなければ全体', () => {
    expect(keptIntervals(smp(1000), [])).toEqual([{ start: 0, end: 1000 }]);
  });

  it('重なった範囲はまとめる', () => {
    expect(
      keptIntervals(smp(1000), [
        { start: smp(300), end: smp(500) },
        { start: smp(400), end: smp(700) },
      ]),
    ).toEqual([
      { start: 0, end: 300 },
      { start: 700, end: 1000 },
    ]);
  });

  it('順不同でも並べ直す', () => {
    expect(
      keptIntervals(smp(1000), [
        { start: smp(800), end: smp(900) },
        { start: smp(100), end: smp(200) },
      ]),
    ).toEqual([
      { start: 0, end: 100 },
      { start: 200, end: 800 },
      { start: 900, end: 1000 },
    ]);
  });

  it('末尾まで捨てたら最後の区間は出ない', () => {
    expect(keptIntervals(smp(1000), [{ start: smp(600), end: smp(1000) }])).toEqual([
      { start: 0, end: 600 },
    ]);
  });

  it('全部捨てたら空', () => {
    expect(keptIntervals(smp(1000), [{ start: smp(0), end: smp(1000) }])).toEqual([]);
  });

  it('範囲外は総尺に丸める', () => {
    expect(keptIntervals(smp(1000), [{ start: smp(-50), end: smp(300) }])).toEqual([
      { start: 300, end: 1000 },
    ]);
    expect(keptIntervals(smp(1000), [{ start: smp(900), end: smp(5000) }])).toEqual([
      { start: 0, end: 900 },
    ]);
  });

  it('長さ 0 の範囲は無視する', () => {
    expect(keptIntervals(smp(1000), [{ start: smp(500), end: smp(500) }])).toEqual([
      { start: 0, end: 1000 },
    ]);
  });
});
