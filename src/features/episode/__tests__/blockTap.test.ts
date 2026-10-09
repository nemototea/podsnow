import { smp } from '@/domain/time';

import { tapBlock } from '../blockTap';

const A = { start: smp(0), end: smp(48000) };
const B = { start: smp(60000), end: smp(120000) };
const blocks = [A, B];

describe('波形のタップと塊の選択（Issue #177）', () => {
  it('1 回目のタップは選ばない（位置を移すだけ）', () => {
    expect(tapBlock({ at: smp(24000), blocks, selection: null, last: null })).toEqual({
      selection: null,
      last: A,
    });
  });

  it('同じ塊への 2 回目のタップで、その塊を選ぶ', () => {
    expect(tapBlock({ at: smp(30000), blocks, selection: null, last: A })).toEqual({
      selection: A,
      last: A,
    });
  });

  it('直前と別の塊へのタップは、1 回目として扱う', () => {
    expect(tapBlock({ at: smp(70000), blocks, selection: null, last: A })).toEqual({
      selection: null,
      last: B,
    });
  });

  it('選択中の塊をもう一度押すと、選択を外す。次のタップはまた 1 回目', () => {
    const r = tapBlock({ at: smp(10000), blocks, selection: A, last: A });
    expect(r).toEqual({ selection: null, last: null });
    expect(
      tapBlock({ at: smp(10000), blocks, selection: null, last: r.last }).selection,
    ).toBeNull();
  });

  it('選択の外を押すと、選択を外して位置を移す', () => {
    expect(tapBlock({ at: smp(70000), blocks, selection: A, last: A })).toEqual({
      selection: null,
      last: B,
    });
  });

  it('ハンドルで広げた選択の中（無音の所）を押しても外す', () => {
    const wide = { start: smp(0), end: smp(120000) };
    expect(tapBlock({ at: smp(54000), blocks, selection: wide, last: A }).selection).toBeNull();
  });

  it('無音の所は選ばない', () => {
    expect(tapBlock({ at: smp(54000), blocks, selection: null, last: null })).toEqual({
      selection: null,
      last: null,
    });
  });

  it('長押しは、その塊をすぐ選ぶ。選択中でも別の塊へ移る', () => {
    expect(
      tapBlock({ at: smp(70000), blocks, selection: null, last: null, longPress: true }),
    ).toEqual({
      selection: B,
      last: B,
    });
    expect(
      tapBlock({ at: smp(70000), blocks, selection: A, last: A, longPress: true }).selection,
    ).toEqual(B);
  });

  it('無音の所の長押しは選択を外す', () => {
    expect(
      tapBlock({ at: smp(54000), blocks, selection: A, last: A, longPress: true }).selection,
    ).toBeNull();
  });
});
