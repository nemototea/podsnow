import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * 画面下部に何があるかを、その画面自身が実測して配る（Issue #89）。
 *
 * トーストの位置を定数で持つと、画面ごとの下部要素（エディタのトランスポート、
 * Home の FAB、何も無い設定画面）と必ずどこかでずれる。`Screen` が実測した高さを
 * ここへ流し、`Toast` と FAB がそれを読む。
 */
export interface BottomInsetValue {
  /** 画面下部に固定された操作バーの実測高さ（safe area を含む）。無ければ 0。 */
  barHeight: number;
  setBarHeight: (h: number) => void;
  /** 表示中のトーストの実測高さ。非表示なら 0。FAB が上へ退避するのに使う。 */
  toastHeight: number;
  setToastHeight: (h: number) => void;
}

const FALLBACK: BottomInsetValue = {
  barHeight: 0,
  setBarHeight: () => {},
  toastHeight: 0,
  setToastHeight: () => {},
};

const BottomInsetContext = createContext<BottomInsetValue | null>(null);

export function BottomInsetProvider({ children }: { children: ReactNode }) {
  const [barHeight, setBarHeight] = useState(0);
  const [toastHeight, setToastHeight] = useState(0);
  const value = useMemo(
    () => ({ barHeight, setBarHeight, toastHeight, setToastHeight }),
    [barHeight, toastHeight],
  );
  return <BottomInsetContext.Provider value={value}>{children}</BottomInsetContext.Provider>;
}

/** `Screen` の外で使われても落ちないように、既定値を返す。 */
export function useBottomInset(): BottomInsetValue {
  return useContext(BottomInsetContext) ?? FALLBACK;
}

/** トーストと下部要素のあいだの余白（M3 の Snackbar と FAB の間隔に相当）。 */
export const BOTTOM_GAP = 12;
