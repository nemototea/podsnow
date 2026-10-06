import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { Icon, type IconName } from './Icon';
import { useAppTheme } from './ThemeContext';
import { icon, motion, player, radius, space } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/** 主操作の丸を押したときの縮み（見本 `.recbtn:active`）。 */
const PRESSED_SCALE = 0.95;

/**
 * プレーヤーの再生・一時停止（Issue #171 D5、#188）。前後のボタン（`IconButton`）より大きい白い丸に
 * 黒の記号（見本 `.recbtn` / `.minicircle` と同じ作法。DESIGN_SYSTEM.md §6）。線と影は持たず、押すと縮む。
 */
export function PlayButton({
  name,
  label,
  onPress,
  busy = false,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  const c = useAppTheme();
  const reduced = useReducedMotion();
  const [held, setHeld] = useState(false);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: reduced ? 1 : withTiming(held ? PRESSED_SCALE : 1, { duration: motion.instant }),
      },
    ],
  }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={busy ? { busy } : {}}
    >
      <Animated.View style={[pressStyle, s.circle, { backgroundColor: c.inverseSurface }]}>
        {busy ? (
          <ActivityIndicator color={c.inverseText} />
        ) : (
          <View style={name === 'play' ? s.playNudge : null}>
            <Icon name={name} color={c.inverseText} size={icon.lg} />
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  circle: {
    width: player.playButton,
    height: player.playButton,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 三角の重心は左に寄るので、iOS では少し右へ寄せる（収録の丸と同じ）
  playNudge: Platform.OS === 'ios' ? { transform: [{ translateX: space.hair }] } : {},
});
