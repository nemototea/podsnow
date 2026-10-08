import { parseSeconds, validateRange } from '../selectionInput';

describe('選択範囲の数値入力', () => {
  it('秒を小数で読む。カンマ小数も受ける', () => {
    expect(parseSeconds('138')).toBe(138);
    expect(parseSeconds(' 140.4 ')).toBe(140.4);
    expect(parseSeconds('140,4')).toBe(140.4);
  });

  it('数値でないもの・負の値は受けない', () => {
    expect(parseSeconds('')).toBeNull();
    expect(parseSeconds('-1')).toBeNull();
    expect(parseSeconds('1:20')).toBeNull();
    expect(parseSeconds('abc')).toBeNull();
  });

  it('終了は開始より後で、全体の長さ以内', () => {
    expect(validateRange(10, 12, 758)).toBeNull();
    expect(validateRange(12, 12, 758)).toBe('order');
    expect(validateRange(12, 10, 758)).toBe('order');
    expect(validateRange(10, 758.1, 758)).toBe('beyond');
    expect(validateRange(null, 10, 758)).toBe('invalid');
  });
});
