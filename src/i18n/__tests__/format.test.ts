import { formatDate, formatDateTime } from '../format';

describe('日時の表示（Issue #170）', () => {
  const at = new Date(2026, 8, 30, 14, 5).getTime();
  const sameYear = new Date(2026, 11, 1).getTime();
  const nextYear = new Date(2027, 0, 5).getTime();

  it('同じ年なら年を省く', () => {
    expect(formatDateTime(at, 'ja', sameYear)).toBe('9月30日 14:05');
    expect(formatDateTime(at, 'en', sameYear)).toBe('Sep 30, 2:05 PM');
  });

  it('違う年なら年を付ける', () => {
    expect(formatDateTime(at, 'ja', nextYear)).toBe('2026年9月30日 14:05');
    expect(formatDateTime(at, 'en', nextYear)).toBe('Sep 30, 2026, 2:05 PM');
  });

  it('日付は言語の慣習で並べる', () => {
    expect(formatDate(new Date(2026, 8, 30), 'ja')).toBe('2026年9月30日');
    expect(formatDate(new Date(2026, 8, 30), 'en')).toBe('September 30, 2026');
  });
});
