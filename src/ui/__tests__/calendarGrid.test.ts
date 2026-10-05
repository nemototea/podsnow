import { monthGrid, sameDay, shiftMonth, toCalendarDay } from '../calendarGrid';

describe('monthGrid', () => {
  it('2026年10月は木曜はじまり・土曜おわりで 5 週', () => {
    const g = monthGrid(2026, 9);
    expect(g).toHaveLength(5);
    expect(g[0]!.slice(0, 4)).toEqual([null, null, null, null]);
    expect(g[0]![4]).toEqual({ year: 2026, month: 9, day: 1 });
    expect(g[4]![6]).toEqual({ year: 2026, month: 9, day: 31 });
    expect(g.flat().filter(Boolean)).toHaveLength(31);
  });

  it('日曜はじまりで 28 日の月は 4 週に収まる（2026年2月）', () => {
    const g = monthGrid(2026, 1);
    expect(g).toHaveLength(4);
    expect(g[0]![0]).toEqual({ year: 2026, month: 1, day: 1 });
    expect(g[3]![6]).toEqual({ year: 2026, month: 1, day: 28 });
  });

  it('うるう年の 2 月は 29 日まで', () => {
    expect(monthGrid(2028, 1).flat().filter(Boolean)).toHaveLength(29);
  });

  it('6 週になる月（2026年8月は土曜はじまりで 31 日）', () => {
    const g = monthGrid(2026, 7);
    expect(g).toHaveLength(6);
    for (const w of g) expect(w).toHaveLength(7);
  });
});

describe('shiftMonth', () => {
  it('年をまたいで進む・戻る', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 9, 0)).toEqual({ year: 2026, month: 9 });
  });
});

describe('sameDay / toCalendarDay', () => {
  it('年月日が同じなら同じ日。null は一致しない', () => {
    const a = toCalendarDay(new Date(2026, 9, 5, 23, 59));
    expect(sameDay(a, { year: 2026, month: 9, day: 5 })).toBe(true);
    expect(sameDay(a, { year: 2026, month: 9, day: 6 })).toBe(false);
    expect(sameDay(a, null)).toBe(false);
  });
});
