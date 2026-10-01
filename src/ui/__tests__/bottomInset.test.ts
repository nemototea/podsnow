import { createFloatingInsetStore, keyboardLift } from '../BottomInset';

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

describe('createFloatingInsetStore', () => {
  it('変わったときだけ知らせる', () => {
    const store = createFloatingInsetStore();
    const listener = jest.fn();
    store.subscribe(listener);
    store.set(72);
    store.set(72);
    expect(store.get()).toBe(72);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('小数は丸め、負の値は 0 にする', () => {
    const store = createFloatingInsetStore();
    store.set(71.6);
    expect(store.get()).toBe(72);
    store.set(-4);
    expect(store.get()).toBe(0);
  });

  it('購読をやめたら知らせない', () => {
    const store = createFloatingInsetStore();
    const listener = jest.fn();
    const off = store.subscribe(listener);
    off();
    store.set(10);
    expect(listener).not.toHaveBeenCalled();
  });
});
