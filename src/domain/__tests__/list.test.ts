import { moveItem } from '../list';

describe('moveItem', () => {
  const items = ['a', 'b', 'c'];
  it('前へ動かす', () => expect(moveItem(items, 2, 0)).toEqual(['c', 'a', 'b']));
  it('後ろへ動かす', () => expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a']));
  it('範囲外は何もしない', () => {
    expect(moveItem(items, 0, 9)).toEqual(items);
    expect(moveItem(items, -1, 0)).toEqual(items);
    expect(moveItem(items, 1, 1)).toEqual(items);
  });
  it('元の配列を変えない', () => {
    moveItem(items, 0, 2);
    expect(items).toEqual(['a', 'b', 'c']);
  });
});
