import { smp } from '@/domain/time';

import { progressRatio, seekSettled, seekTarget } from '../seek';

describe('シークバーの位置（Issue #188）', () => {
  const max = smp(60 * 48000);

  it('x を長さの中の位置にする', () => {
    expect(seekTarget(0, 200, max)).toBe(0);
    expect(seekTarget(100, 200, max)).toBe(30 * 48000);
    expect(seekTarget(200, 200, max)).toBe(max);
  });

  it('端の外は端に止める', () => {
    expect(seekTarget(-20, 200, max)).toBe(0);
    expect(seekTarget(260, 200, max)).toBe(max);
  });

  it('幅や長さが分からないときは先頭', () => {
    expect(seekTarget(50, 0, max)).toBe(0);
    expect(seekTarget(50, 200, smp(0))).toBe(0);
  });

  it('進み具合の割合', () => {
    expect(progressRatio(24000, 48000)).toBe(0.5);
    expect(progressRatio(10, 0)).toBe(0);
    expect(progressRatio(-1, 10)).toBe(0);
    expect(progressRatio(20, 10)).toBe(1);
  });

  it('実際の位置が離した位置に追いついたら、離した位置に留めない', () => {
    expect(seekSettled(48000 * 9.5, 48000 * 10)).toBe(true);
    // 追いついたあと再生で少し進んでも、離した位置へ戻さない
    expect(seekSettled(48000 * 11.5, 48000 * 10)).toBe(true);
    // まだ前の位置にいる
    expect(seekSettled(48000 * 2, 48000 * 10)).toBe(false);
    expect(seekSettled(48000 * 20, 48000 * 10)).toBe(false);
  });
});
