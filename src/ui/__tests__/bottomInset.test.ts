import { keyboardLift } from '../BottomInset';

describe('keyboardLift', () => {
  it('キーボードが無ければ動かさない', () => {
    expect(keyboardLift(0, 34)).toBe(0);
    expect(keyboardLift(0, 0)).toBe(0);
  });

  it('キーボードが下端より高い分だけ上げる', () => {
    // キーボード 300、safe area 34 → 266 上げると、トーストの下端はキーボードの上端 + 余白に来る。
    expect(keyboardLift(-300, 34)).toBe(-266);
    // 下部バーが無く safe area も無い画面では、キーボードの高さそのまま。
    expect(keyboardLift(-300, 0)).toBe(-300);
  });

  it('キーボードが下部バーより低ければ動かさない（バーの上に出ているまま）', () => {
    expect(keyboardLift(-40, 96)).toBe(0);
  });
});
