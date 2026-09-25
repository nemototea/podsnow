import { dropIndex, shiftFor, slotOffset } from '../reorder';

describe('ドラッグで離した位置', () => {
  const even = [60, 60, 60, 60];

  it('動かさなければその場', () => {
    expect(dropIndex(even, 1, 0)).toBe(1);
  });

  it('隣の行の半分を越えたら入れ替わる。ちょうど半分では入れ替わらない', () => {
    expect(dropIndex(even, 1, 30)).toBe(1);
    expect(dropIndex(even, 1, 31)).toBe(2);
    expect(dropIndex(even, 1, -30)).toBe(1);
    expect(dropIndex(even, 1, -31)).toBe(0);
  });

  it('複数行を越える', () => {
    expect(dropIndex(even, 0, 91)).toBe(2);
    expect(dropIndex(even, 3, -151)).toBe(0);
  });

  it('先頭より上・末尾より下へ出ても端に留まる', () => {
    expect(dropIndex(even, 1, -1000)).toBe(0);
    expect(dropIndex(even, 1, 1000)).toBe(3);
    expect(dropIndex(even, 0, -1000)).toBe(0);
    expect(dropIndex(even, 3, 1000)).toBe(3);
  });

  it('行の高さが揃っていなくても、越えた行の高さで数える', () => {
    // 台本が長い行（120）と見出しだけの行（48）が混ざる
    const mixed = [48, 120, 48, 48];
    expect(dropIndex(mixed, 0, 60)).toBe(0);
    expect(dropIndex(mixed, 0, 61)).toBe(1);
    expect(dropIndex(mixed, 0, 120 + 24 + 1)).toBe(2);
    expect(dropIndex(mixed, 3, -(48 + 60))).toBe(2);
    expect(dropIndex(mixed, 3, -(48 + 61))).toBe(1);
  });

  it('範囲外の行や空の列では動かさない', () => {
    expect(dropIndex(even, -1, 100)).toBe(-1);
    expect(dropIndex(even, 4, -100)).toBe(4);
    expect(dropIndex([], 0, 100)).toBe(0);
    expect(dropIndex([60], 0, 100)).toBe(0);
  });
});

describe('ドラッグ中に避ける行', () => {
  it('下へ動かすと、間の行が掴んだ行の高さぶん上へずれる', () => {
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 1, 3, 50))).toEqual([0, 0, -50, -50]);
  });

  it('上へ動かすと、間の行が下へずれる', () => {
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 3, 1, 50))).toEqual([0, 50, 50, 0]);
  });

  it('掴んでいない・動いていないときは誰もずれない', () => {
    expect([0, 1, 2].map((i) => shiftFor(i, -1, -1, 50))).toEqual([0, 0, 0]);
    expect([0, 1, 2].map((i) => shiftFor(i, 1, 1, 50))).toEqual([0, 0, 0]);
  });
});

describe('離したあとに吸い付く位置', () => {
  const mixed = [48, 120, 48, 60];

  it('下へは越えた行の高さの合計、上へはその負', () => {
    expect(slotOffset(mixed, 0, 2)).toBe(120 + 48);
    expect(slotOffset(mixed, 3, 1)).toBe(-(120 + 48));
  });

  it('動いていなければ 0', () => {
    expect(slotOffset(mixed, 2, 2)).toBe(0);
  });

  it('吸い付く位置は、そこで離しても同じ行に入る', () => {
    for (let from = 0; from < mixed.length; from++)
      for (let to = 0; to < mixed.length; to++)
        expect(dropIndex(mixed, from, slotOffset(mixed, from, to))).toBe(to);
  });
});
