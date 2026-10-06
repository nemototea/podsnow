import { barState, LEVEL_BARS, LEVEL_HOT_FROM, litBars } from '../levelBars';

describe('横に並ぶ棒のレベル（見本 .meter）', () => {
  it('-40〜0 dBFS を 24 本に等分する', () => {
    expect(litBars(-40)).toBe(0);
    expect(litBars(0)).toBe(LEVEL_BARS);
    expect(litBars(-20)).toBe(12);
  });

  it('範囲の外は端に寄せ、値が無いときは 1 本も点けない', () => {
    expect(litBars(-90)).toBe(0);
    expect(litBars(6)).toBe(LEVEL_BARS);
    expect(litBars(null)).toBe(0);
    expect(litBars(Number.NaN)).toBe(0);
  });

  it('見本と同じく 20 本目（添字 19）から先を琥珀にする', () => {
    expect(LEVEL_HOT_FROM).toBe(19);
    expect(barState(18, 24)).toBe('on');
    expect(barState(19, 24)).toBe('hot');
    expect(barState(19, 19)).toBe('off');
  });
});
