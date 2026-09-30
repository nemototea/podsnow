import {
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { space } from './tokens';

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
export const BOTTOM_GAP = space.md;

/**
 * キーボードが出ている間、画面下に置いたもの（トースト）を持ち上げる量（Issue #132）。
 *
 * - `keyboardHeight`: react-native-keyboard-controller の高さ。出ているとき負の値になる。
 * - `floor`: キーボードが無いときの下端（下部バーの実測高さか、無ければ safe area）。
 *
 * 下部バーはキーボードの裏に隠れるので、キーボードが `floor` より高い分だけ上げる。
 * 戻り値は translateY（上へ動かすので 0 以下）。
 */
export function keyboardLift(keyboardHeight: number, floor: number): number {
  'worklet';
  return Math.min(0, keyboardHeight + floor);
}

/**
 * 画面の外（ルート）に浮かぶ要素が、画面下部のどれだけを覆っているか（Issue #164）。
 *
 * ミニプレーヤーは `Screen` の外にあるので、`BottomInsetProvider` では配れない。
 * 覆っている高さ（safe area より上の分）をここに置き、`Screen` が下部バーや内容の下に同じだけ空ける。
 */
export interface FloatingInsetStore {
  subscribe: (listener: () => void) => () => void;
  get: () => number;
  set: (h: number) => void;
}

export function createFloatingInsetStore(): FloatingInsetStore {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get: () => value,
    set: (h) => {
      const next = Math.max(0, Math.round(h));
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
  };
}

export const floatingInset = createFloatingInsetStore();

export function useFloatingInset(): number {
  return useSyncExternalStore(floatingInset.subscribe, floatingInset.get);
}
