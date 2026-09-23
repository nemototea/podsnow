import { StyleSheet, View } from 'react-native';

import { useT } from '@/i18n';
import { radius, space, tabularNums, typography } from '@/ui/tokens';
import { Text } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';

import type { LevelEvent } from '../../../modules/podsnow-recorder/src/PodsnowRecorder.types';

const FLOOR_DB = -60;
const SEGMENTS = 30;
const HOT_DB = -6;
const SCALE = [-60, -36, -12, 0] as const;

export function meterSegments(peakDb: number | null): number {
  if (peakDb === null || !Number.isFinite(peakDb)) return 0;
  const f = (Math.max(FLOOR_DB, Math.min(0, peakDb)) - FLOOR_DB) / -FLOOR_DB;
  return Math.round(f * SEGMENTS);
}

export function LevelMeter({ level }: { level: LevelEvent | null }) {
  const c = useAppTheme();
  const t = useT();
  const lit = meterSegments(level?.peakDb ?? null);
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
            ? c.surfaceHover
            : level?.clipped && i === lit - 1
              ? c.recSolid
              : i >= hotFrom
                ? c.mistakeSolid
                : c.voiceSolid;
          return <View key={i} style={[st.bar, { backgroundColor: color }]} />;
        })}
      </View>
      <View style={st.scale}>
        {SCALE.map((db) => (
          <Text key={db} style={[typography.tick, tabularNums, { color: c.textTertiary }]}>
            {db === 0 ? '0 dB' : String(db)}
          </Text>
        ))}
      </View>
      {level?.clipped ? (
        <Text style={[typography.caption, { color: c.recText }]}>{t.record.clipped}</Text>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: { marginTop: space.lg, gap: space.xs },
  bars: { flexDirection: 'row', gap: space.hair, height: space.xl },
  bar: { flex: 1, borderRadius: radius.xs / 2 },
  scale: { flexDirection: 'row', justifyContent: 'space-between' },
});
