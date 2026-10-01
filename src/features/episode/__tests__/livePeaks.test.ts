import { appendLivePeak, levelAmp, liveColumns, type LivePeak } from '../livePeaks';

const ev = (frames: number, peakDb: number) => ({
  frames,
  peakDb,
  rmsDb: peakDb - 8,
  clipped: false,
});

describe('録音中の波形', () => {
  it('dBFS を .peaks と同じ線形の振幅にする', () => {
    expect(levelAmp(0)).toBe(1);
    expect(levelAmp(-6)).toBeCloseTo(0.501, 3);
    expect(levelAmp(-20)).toBeCloseTo(0.1);
    expect(levelAmp(-60)).toBeCloseTo(0.001);
    expect(levelAmp(6)).toBe(1);
    expect(levelAmp(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('溜める。一時停止で同じ位置が続けば大きい方を残し、フレームが戻れば始め直す', () => {
    let l: LivePeak[] = [];
    l = appendLivePeak(l, ev(2400, -30));
    l = appendLivePeak(l, ev(4800, -20));
    l = appendLivePeak(l, ev(4800, -40));
    expect(l.map((p) => p.frames)).toEqual([2400, 4800]);
    expect(l[1]!.amp).toBeCloseTo(0.1);
    l = appendLivePeak(l, ev(4800, 0));
    expect(l[1]!.amp).toBe(1);
    l = appendLivePeak(l, ev(2400, Number.NEGATIVE_INFINITY));
    expect(l).toEqual([{ frames: 2400, amp: 0 }]);
  });

  it('柱ごとに最大を取り、イベントより細かい柱は埋める。録った長さより先は 0', () => {
    const l: LivePeak[] = [
      { frames: 100, amp: 0.2 },
      { frames: 200, amp: 0.6 },
      { frames: 300, amp: 0.4 },
    ];
    expect(Array.from(liveColumns(l, 0, 400, 2))).toEqual([
      expect.closeTo(0.6),
      expect.closeTo(0.4),
    ]);
    // 柱 1 本 = 50 フレーム。イベントの無い柱は次のイベントの値で埋まり、300 より先は 0
    const fine = Array.from(liveColumns(l, 0, 400, 8));
    expect(fine.slice(0, 6).every((v) => v > 0)).toBe(true);
    expect(fine[0]).toBeCloseTo(0.2);
    expect(fine[1]).toBeCloseTo(0.2);
    expect(fine[2]).toBeCloseTo(0.6);
    expect(fine.slice(6)).toEqual([0, 0]);
    expect(liveColumns([], 0, 100, 4)).toEqual(new Float32Array(4));
    expect(liveColumns(l, 0, 0, 4)).toEqual(new Float32Array(4));
  });
});
