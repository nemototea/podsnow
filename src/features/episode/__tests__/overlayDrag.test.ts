import { fadePxToSmp, pxToSmp, snapPx, SNAP_PX } from '../overlayDrag';

describe('素材の帯を動かす計算（Issue #254）', () => {
  it('近くの境目に吸い付き、遠ければそのまま', () => {
    expect(snapPx(105, [100, 300])).toBe(100);
    expect(snapPx(100 + SNAP_PX, [100])).toBe(100 + SNAP_PX);
  });
  it('いちばん近い境目を選ぶ', () => {
    expect(snapPx(296, [290, 300])).toBe(300);
    expect(snapPx(50, [])).toBe(50);
  });
  it('px をサンプル数に直す', () => {
    expect(pxToSmp(24, 24)).toBe(48000);
    expect(pxToSmp(-12, 24)).toBe(-24000);
  });
  it('フェードは 0.1 秒に丸め、負にしない', () => {
    expect(fadePxToSmp(25, 24)).toBe(48000);
    expect(fadePxToSmp(-5, 24)).toBe(0);
    expect(fadePxToSmp(37, 24)).toBe(72000);
  });
});
