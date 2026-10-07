import { LinearGradient } from 'expo-linear-gradient';
import { useLayoutEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { motion } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/** 上から下へのグラデーションの色と位置（0〜1）。1 色だけなら塗り。 */
export type GradientStops = readonly (readonly [color: string, at: number])[];

function key(stops: GradientStops): string {
  return stops.map(([color, at]) => `${color}@${at}`).join(',');
}

function Layer({ stops, style }: { stops: GradientStops; style?: StyleProp<ViewStyle> }) {
  const list = stops.length > 1 ? stops : [stops[0]!, [stops[0]![0], 1] as const];
  const colors = list.map(([color]) => color) as unknown as readonly [string, string, ...string[]];
  const locations = list.map(([, at]) => at) as unknown as readonly [number, number, ...number[]];
  return <LinearGradient colors={colors} locations={locations} style={style} />;
}

/**
 * 番組の色の面（DESIGN_SYSTEM.md §2.6）。番組の色が替わったら、前の色の上に新しい色を
 * `motion.colorFade` かけて重ねる（見本 `.phone *` の background-color .45s）。動きを減らす設定では切り替えるだけ。
 * 中身の後ろに敷く飾りなので、読み上げには出さない。
 */
export function ShowGradient({
  stops,
  style,
}: {
  stops: GradientStops;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(stops);
  const [prev, setPrev] = useState<GradientStops | null>(null);
  const fade = useSharedValue(1);
  // 色が替わったら、描いている色を前の色として残す（描画中に状態を合わせる React の作法）
  if (key(stops) !== key(shown)) {
    setPrev(reduced ? null : shown);
    setShown(stops);
  }
  const shownKey = key(shown);

  useLayoutEffect(() => {
    if (!prev) return;
    fade.set(0);
    fade.set(
      withTiming(1, { duration: motion.colorFade }, (finished) => {
        if (finished) runOnJS(setPrev)(null);
      }),
    );
    // 新しい色になったときだけ動かす
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);

  const top = useAnimatedStyle(() => ({ opacity: fade.get() }));

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, style]}
    >
      {prev ? <Layer stops={prev} style={StyleSheet.absoluteFill} /> : null}
      <Reanimated.View style={[StyleSheet.absoluteFill, prev ? top : null]}>
        <Layer stops={shown} style={StyleSheet.absoluteFill} />
      </Reanimated.View>
    </View>
  );
}
