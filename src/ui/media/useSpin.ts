import { useEffect } from 'react';
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '../useReducedMotion';

/**
 * 再生中だけ回す（DESIGN_SYSTEM.md §2.6）。止めたらその角度で止まる。
 * 「動きを減らす」では回さない。状態は再生ボタンの形と文字で分かる。
 */
export function useSpin(playing: boolean, period: number) {
  const reduced = useReducedMotion();
  const deg = useSharedValue(0);
  useEffect(() => {
    if (!playing || reduced) {
      cancelAnimation(deg);
      return;
    }
    const from = deg.get() % 360;
    deg.set(from);
    deg.set(
      withRepeat(withTiming(from + 360, { duration: period, easing: Easing.linear }), -1, false),
    );
    return () => cancelAnimation(deg);
  }, [playing, reduced, period, deg]);
  return useAnimatedStyle(() => ({ transform: [{ rotate: `${deg.get()}deg` }] }));
}

export const SpinView = Reanimated.View;
