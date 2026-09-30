import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';

import { useT } from '@/i18n';
import { Text } from '@/ui/components';
import { useFontFamily } from '@/ui/Text';
import { Halftone, METER, meterAngle, onArc } from '@/ui/media';
import { useAppTheme } from '@/ui/ThemeContext';
import { radius, space, stroke, typography } from '@/ui/tokens';
import { useReducedMotion } from '@/ui/useReducedMotion';

import type { LevelEvent } from '../../../modules/podsnow-recorder/src/PodsnowRecorder.types';

/** 文字盤の原寸（viewBox）。針の支点は下辺の中央。 */
const VB_W = 300;
const VB_H = 150;
const PIVOT = { x: VB_W / 2, y: VB_H };
const ARC_R = 118;
const TICK_IN = 112;
const TICK_OUT = 125;
const LABEL_R = 99;
const NEEDLE_R = 120;
const HUB_R = 14;
/** VU 相当の立ち上がり（約 300 ms）。 */
const BALLISTICS_MS = 300;

function arc(fromDb: number, toDb: number): string {
  const a = onArc(PIVOT.x, PIVOT.y, ARC_R, meterAngle(fromDb));
  const b = onArc(PIVOT.x, PIVOT.y, ARC_R, meterAngle(toDb));
  return `M${a.x} ${a.y} A${ARC_R} ${ARC_R} 0 0 1 ${b.x} ${b.y}`;
}

/**
 * 針のレベルメーター（DESIGN_SYSTEM.md §8、#190）。針は rmsDb を VU 相当の立ち上がりで
 * ならして振る。目盛りは dBFS（-40〜0）で、赤い帯は -6 dB から。音割れ（clipped）でランプが点き、
 * 今の文言も出す。録音していないときは針を左端に置く。
 */
export function LevelMeter({ level }: { level: LevelEvent | null }) {
  const c = useAppTheme();
  const t = useT();
  const reduced = useReducedMotion();
  // SVG の文字は Text を通らないので、書体を名前で渡す（読み込めていなければ OS の書体）
  const numericFamily = useFontFamily('numeric');
  const [w, setW] = useState(0);
  const k = w / VB_W;
  const angle = useSharedValue(meterAngle(null));
  const target = meterAngle(level?.rmsDb ?? null);
  useEffect(() => {
    angle.set(
      reduced
        ? target
        : withTiming(target, { duration: BALLISTICS_MS, easing: Easing.out(Easing.quad) }),
    );
  }, [target, reduced, angle]);
  const needleStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.get()}deg` }] }));
  const clipped = !!level?.clipped;
  return (
    <View style={st.root}>
      <View
        style={[st.face, { borderColor: c.controlBorder, backgroundColor: c.surface }]}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="image"
        accessibilityLabel={
          level ? t.record.a11yLevel(Math.round(level.peakDb)) : t.record.a11yLevelIdle
        }
      >
        <Halftone color={c.halftone} />
        <Svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`}>
          <Path
            d={arc(METER.floorDb, METER.hotDb)}
            fill="none"
            stroke={c.controlBorder}
            strokeWidth={2.5}
          />
          <Path d={arc(METER.hotDb, 0)} fill="none" stroke={c.recSolid} strokeWidth={10} />
          <Path d={arc(METER.hotDb, 0)} fill="none" stroke={c.controlBorder} strokeWidth={2} />
          {METER.ticks.map((db) => {
            const deg = meterAngle(db);
            const a = onArc(PIVOT.x, PIVOT.y, TICK_IN, deg);
            const b = onArc(PIVOT.x, PIVOT.y, TICK_OUT, deg);
            const l = onArc(PIVOT.x, PIVOT.y, LABEL_R, deg);
            return [
              <Line
                key={`t${db}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={c.controlBorder}
                strokeWidth={2.2}
                strokeLinecap="round"
              />,
              <SvgText
                key={`l${db}`}
                x={l.x}
                y={l.y + 4}
                textAnchor="middle"
                fontSize={typography.tick.fontSize}
                fontWeight="700"
                {...(numericFamily ? { fontFamily: numericFamily } : {})}
                fill={c.textPrimary}
              >
                {String(db)}
              </SvgText>,
            ];
          })}
          <SvgText
            x={PIVOT.x}
            y={112}
            textAnchor="middle"
            fontSize={typography.heading.fontSize}
            fontWeight="700"
            {...(numericFamily ? { fontFamily: numericFamily } : {})}
            fill={c.textPrimary}
          >
            dB
          </SvgText>
        </Svg>
        {w > 0 ? (
          <>
            <Reanimated.View
              pointerEvents="none"
              style={[
                st.needle,
                {
                  left: PIVOT.x * k - NEEDLE_W / 2,
                  top: (PIVOT.y - NEEDLE_R) * k,
                  height: NEEDLE_R * k,
                  backgroundColor: c.controlBorder,
                },
                needleStyle,
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                st.hub,
                {
                  left: (PIVOT.x - HUB_R) * k,
                  top: (PIVOT.y - HUB_R) * k,
                  width: HUB_R * 2 * k,
                  height: HUB_R * 2 * k,
                  borderRadius: HUB_R * k,
                  backgroundColor: c.brandAccent,
                  borderColor: c.controlBorder,
                },
              ]}
            />
          </>
        ) : null}
        <View
          style={[
            st.clip,
            { borderColor: c.controlBorder, backgroundColor: clipped ? c.recSolid : c.surface },
          ]}
        >
          <View
            style={[
              st.clipDot,
              {
                borderColor: c.controlBorder,
                backgroundColor: clipped ? c.recOnSolid : 'transparent',
              },
            ]}
          />
          <Text style={[typography.overline, { color: clipped ? c.recOnSolid : c.textPrimary }]}>
            {t.record.clipLamp}
          </Text>
        </View>
      </View>
      {clipped ? (
        <Text style={[typography.caption, { color: c.recText }]}>{t.record.clipped}</Text>
      ) : null}
    </View>
  );
}

const NEEDLE_W = 3;

const st = StyleSheet.create({
  root: { marginTop: space.lg, gap: space.xs },
  face: {
    aspectRatio: VB_W / VB_H,
    borderWidth: stroke.selected,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  needle: {
    position: 'absolute',
    width: NEEDLE_W,
    borderRadius: NEEDLE_W / 2,
    transformOrigin: 'bottom',
  },
  hub: { position: 'absolute', borderWidth: stroke.selected },
  clip: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: stroke.selected,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
  },
  clipDot: {
    width: space.sm,
    height: space.sm,
    borderRadius: space.xs,
    borderWidth: stroke.hairline,
  },
});
