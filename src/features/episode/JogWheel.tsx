import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient, Stop } from 'react-native-svg';

import { canShadow } from '@/ui/device';
import { useAppTheme } from '@/ui/ThemeContext';
import { stroke } from '@/ui/tokens';

/** ジョグダイヤルの直径（PN-01、#115）。親指で回せる大きさ。 */
export const JOG_SIZE = 148;
const R = JOG_SIZE / 2;
const KNURL = 72;
/** 触覚を返す角度の刻み。 */
const TICK_DEG = 30;
/** 読み上げの増減 1 回ぶんの角度。 */
const STEP_DEG = 36;

/**
 * 再生位置を送るジョグダイヤル。回した角度（度、時計回りが正）を `onTurn` に返す。
 * 角度から秒への換算は呼び出し側が決める。読み上げでは増減の操作として使える。
 */
export function JogWheel({
  label,
  hint,
  onStart,
  onTurn,
  onEnd,
  onTick,
  disabled,
}: {
  label: string;
  hint: string;
  onStart: () => void;
  onTurn: (degrees: number) => void;
  onEnd?: () => void;
  onTick?: () => void;
  disabled?: boolean;
}) {
  const c = useAppTheme();
  const angle = useSharedValue(0);
  const last = useSharedValue(0);
  const total = useSharedValue(0);
  const sent = useSharedValue(0);
  const ticks = useSharedValue(0);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        .minDistance(0)
        .onBegin((e) => {
          last.set(Math.atan2(e.y - R, e.x - R));
          total.set(0);
          sent.set(0);
          ticks.set(0);
          runOnJS(onStart)();
        })
        .onUpdate((e) => {
          const a = Math.atan2(e.y - R, e.x - R);
          let d = a - last.get();
          if (d > Math.PI) d -= 2 * Math.PI;
          if (d < -Math.PI) d += 2 * Math.PI;
          last.set(a);
          total.set(total.get() + d);
          angle.set(angle.get() + d);
          const deg = (total.get() * 180) / Math.PI;
          if (Math.abs(deg - sent.get()) >= 2) {
            sent.set(deg);
            runOnJS(onTurn)(deg);
          }
          const n = Math.trunc(deg / TICK_DEG);
          if (n !== ticks.get()) {
            ticks.set(n);
            if (onTick) runOnJS(onTick)();
          }
        })
        .onFinalize(() => {
          if (onEnd) runOnJS(onEnd)();
        }),
    [angle, disabled, last, onEnd, onStart, onTick, onTurn, sent, ticks, total],
  );

  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.get()}rad` }] }));

  const knurl = useMemo(
    () =>
      Array.from({ length: KNURL }, (_, i) => {
        const t = (i / KNURL) * 2 * Math.PI;
        const r1 = R - 2;
        const r2 = R - 9;
        return {
          key: i,
          x1: R + Math.cos(t) * r1,
          y1: R + Math.sin(t) * r1,
          x2: R + Math.cos(t) * r2,
          y2: R + Math.sin(t) * r2,
          light: i % 2 === 0,
        };
      }),
    [],
  );

  return (
    <GestureDetector gesture={pan}>
      <View
        style={[
          st.wheel,
          {
            boxShadow: canShadow
              ? [
                  { offsetX: 0, offsetY: 5, blurRadius: 0, color: c.keySide },
                  {
                    offsetX: 0,
                    offsetY: 14,
                    blurRadius: 22,
                    spreadDistance: -6,
                    color: c.keyShadow,
                  },
                ]
              : [],
          },
        ]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          onStart();
          onTurn(e.nativeEvent.actionName === 'increment' ? STEP_DEG : -STEP_DEG);
          onEnd?.();
        }}
      >
        {/* 光は動かない（上から当たる）。回るのはローレットと指のくぼみだけ */}
        <Svg width={JOG_SIZE} height={JOG_SIZE} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="jog-rim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={c.keyHi} />
              <Stop offset="1" stopColor={c.keySide} />
            </LinearGradient>
            <LinearGradient id="jog-plate" x1="0.2" y1="0" x2="0.8" y2="1">
              <Stop offset="0" stopColor={c.keyHi} />
              <Stop offset="0.5" stopColor={c.key} />
              <Stop offset="1" stopColor={c.keySide} />
            </LinearGradient>
          </Defs>
          <Circle cx={R} cy={R} r={R} fill="url(#jog-rim)" />
          <Circle cx={R} cy={R} r={R - 11} fill="url(#jog-plate)" />
          {[0.3, 0.5, 0.7, 0.9].map((k) => (
            <Circle
              key={k}
              cx={R}
              cy={R}
              r={(R - 11) * k}
              fill="none"
              stroke={c.keyHi}
              strokeOpacity={0.35}
              strokeWidth={stroke.hairline}
            />
          ))}
          <Circle
            cx={R}
            cy={R}
            r={R - 11}
            fill="none"
            stroke={c.keySide}
            strokeWidth={stroke.hairline}
          />
        </Svg>
        <Animated.View style={[StyleSheet.absoluteFill, spin]} pointerEvents="none">
          <Svg width={JOG_SIZE} height={JOG_SIZE}>
            {knurl.map((k) => (
              <Line
                key={k.key}
                x1={k.x1}
                y1={k.y1}
                x2={k.x2}
                y2={k.y2}
                stroke={k.light ? c.keyHi : c.keyShadow}
                strokeWidth={stroke.selected}
              />
            ))}
            <Circle cx={R + (R - 34) * 0.6} cy={R - (R - 34) * 0.8} r={13} fill={c.well} />
            <Circle
              cx={R + (R - 34) * 0.6}
              cy={R - (R - 34) * 0.8}
              r={13}
              fill="none"
              stroke={c.keyShadow}
              strokeWidth={stroke.selected}
            />
          </Svg>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const st = StyleSheet.create({
  wheel: { width: JOG_SIZE, height: JOG_SIZE, borderRadius: R },
});
