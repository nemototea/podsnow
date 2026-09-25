import { StyleSheet, View } from 'react-native';

import { useT } from '@/i18n';
import { Text } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { radius, space, stroke, tabularNums, typography } from '@/ui/tokens';

import type { LevelEvent } from '../../../modules/podsnow-recorder/src/PodsnowRecorder.types';

const FLOOR_DB = -60;
const SEGMENTS = 40;
/** ここから上は注意（アンバー）。 */
const WARM_DB = -12;
/** ここから上は割れる手前（コーラル）。 */
const HOT_DB = -3;
const SCALE = [-60, -48, -36, -24, -12, -6, 0] as const;

export function meterSegments(peakDb: number | null): number {
  if (peakDb === null || !Number.isFinite(peakDb)) return 0;
  const f = (Math.max(FLOOR_DB, Math.min(0, peakDb)) - FLOOR_DB) / -FLOOR_DB;
  return Math.round(f * SEGMENTS);
}

/** 目盛りの位置（左端からの割合）。セグメントと同じ尺度で置く。 */
export function scalePosition(db: number): number {
  return (Math.max(FLOOR_DB, Math.min(0, db)) - FLOOR_DB) / -FLOOR_DB;
}

/**
 * 表示窓の中のレベルメーター（PN-01、#115）。色は表示窓のトークンだけを使う。
 * −12 dB まではミネラル（声）、−3 dB まではアンバー（注意）、その上はコーラル（録音・割れ）。
 */
export function LevelMeter({ level }: { level: LevelEvent | null }) {
  const c = useAppTheme();
  const t = useT();
  const lit = meterSegments(level?.peakDb ?? null);
  const warmFrom = meterSegments(WARM_DB);
  const hotFrom = meterSegments(HOT_DB);
  return (
    <View
      style={st.root}
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        level ? t.record.a11yLevel(Math.round(level.peakDb)) : t.record.a11yLevelIdle
      }
    >
      <View style={st.bars}>
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const on = i < lit;
          const color = !on
            ? c.dispLine
            : (level?.clipped && i === lit - 1) || i >= hotFrom
              ? c.dispRec
              : i >= warmFrom
                ? c.dispMistake
                : c.dispVoice;
          return <View key={i} style={[st.bar, { backgroundColor: color }]} />;
        })}
      </View>
      <View style={st.scale}>
        {SCALE.map((db, i) => (
          <Text
            key={db}
            style={[
              typography.tick,
              tabularNums,
              st.tick,
              i === 0
                ? { left: 0 }
                : i === SCALE.length - 1
                  ? { right: 0 }
                  : { left: `${scalePosition(db) * 100}%`, transform: [{ translateX: -space.sm }] },
              { color: c.dispDim },
            ]}
          >
            {db}
          </Text>
        ))}
      </View>
      {level?.clipped ? (
        <Text style={[typography.caption, { color: c.dispRecText }]}>{t.record.clipped}</Text>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: { paddingHorizontal: space.md, paddingTop: space.md, gap: space.xs },
  bars: { flexDirection: 'row', gap: stroke.selected, height: space.md },
  bar: { flex: 1, borderRadius: radius.xs / 4 },
  scale: { height: typography.tick.lineHeight, position: 'relative' },
  tick: { position: 'absolute', top: 0 },
});
