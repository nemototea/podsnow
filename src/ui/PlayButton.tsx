import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { Icon, type IconName } from './Icon';
import { useAppTheme } from './ThemeContext';
import { buttonDepth, icon, motion, player, radius, space, stroke } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/**
 * プレーヤーの再生・一時停止（Issue #171 D5、#188）。前後のボタン（`IconButton`）より大きい丸に
 * 硬い影を付け、主操作と分かるようにする。形は収録の丸（`Transport`）と同じ作法（DESIGN_SYSTEM.md §6）。
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
  const down = held && !reduced;
  const travel = buttonDepth.travelLarge;
  const pressStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: reduced ? 0 : withTiming(down ? travel : 0, { duration: motion.instant }) },
      { translateY: reduced ? 0 : withTiming(down ? travel : 0, { duration: motion.instant }) },
    ],
  }));
  const offset = down ? buttonDepth.pressedOffset : buttonDepth.offsetLarge;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={busy ? { busy } : {}}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            pressStyle,
            s.circle,
            {
              borderColor: c.controlBorder,
              backgroundColor: pressed ? c.surfaceHover : c.surface,
              boxShadow:
                Platform.OS === 'android' && Number(Platform.Version) < 28
                  ? []
                  : [{ offsetX: offset, offsetY: offset, blurRadius: 0, color: c.controlShadow }],
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={c.textSecondary} />
          ) : (
            <View style={name === 'play' ? s.playNudge : null}>
              <Icon name={name} color={c.textPrimary} size={icon.lg} />
            </View>
          )}
        </Animated.View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  circle: {
    width: player.playButton,
    height: player.playButton,
    borderRadius: radius.pill,
    borderWidth: stroke.selected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 三角の重心は左に寄るので、iOS では少し右へ寄せる（収録の丸と同じ）
  playNudge: Platform.OS === 'ios' ? { transform: [{ translateX: space.hair }] } : {},
});
