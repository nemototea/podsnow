import { METER, meterAngle, packRadius, PACK } from '../media/geometry';
import { sticker, stickerTilt } from '../tokens';

describe('カセットのテープ（DESIGN_SYSTEM.md §2.6）', () => {
  it('頭では左がいっぱい、終わりでは右がいっぱい', () => {
    expect(packRadius(1)).toBe(PACK.max);
    expect(packRadius(0)).toBe(PACK.min);
  });

  it('テープの量（リールを除いた面積）は左右で合計が変わらない', () => {
    const area = (r: number) => r * r - PACK.min * PACK.min;
    const total = area(PACK.max);
    for (const p of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
      expect(area(packRadius(1 - p)) + area(packRadius(p))).toBeCloseTo(total, 6);
    }
  });

  it('範囲外の割合は端に止める', () => {
    expect(packRadius(-1)).toBe(PACK.min);
    expect(packRadius(2)).toBe(PACK.max);
  });
});

describe('レベルメーターの針（DESIGN_SYSTEM.md §8）', () => {
  const right = METER.fromDeg + METER.spanDeg;

  it('録音していないときと床より小さい音は左端', () => {
    expect(meterAngle(null)).toBe(METER.fromDeg);
    expect(meterAngle(Number.NEGATIVE_INFINITY)).toBe(METER.fromDeg);
    expect(meterAngle(-80)).toBe(METER.fromDeg);
  });

  it('0 dBFS で右端、それより大きくても右端で止まる', () => {
    expect(meterAngle(0)).toBe(right);
    expect(meterAngle(6)).toBe(right);
  });

  it('大きい音ほど右へ振れる', () => {
    const angles = METER.ticks.map((db) => meterAngle(db));
    expect(angles).toEqual([...angles].sort((a, b) => a - b));
    expect(new Set(angles).size).toBe(angles.length);
  });

  it('赤い帯は今の HOT_DB（-6 dB）から始まる', () => {
    expect(METER.hotDb).toBe(-6);
    expect(METER.ticks).toContain(METER.hotDb);
  });
});

describe('ステッカーの傾き（DESIGN_SYSTEM.md §2.5）', () => {
  it('±3〜7° の範囲で、添字が同じなら同じ傾き', () => {
    for (const d of sticker.tilts) expect(Math.abs(d)).toBeGreaterThanOrEqual(2);
    for (const d of sticker.tilts) expect(Math.abs(d)).toBeLessThanOrEqual(7);
    expect(stickerTilt(1)).toBe(stickerTilt(1 + sticker.tilts.length));
    expect(stickerTilt(-1)).toBe(sticker.tilts[sticker.tilts.length - 1]);
  });
});
