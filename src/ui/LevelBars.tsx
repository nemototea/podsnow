import { StyleSheet, View } from 'react-native';

import { barState, LEVEL_BARS, litBars } from './levelBars';
import { compositeHex } from './showColors';
import { useAppTheme } from './ThemeContext';
import { radius, space } from './tokens';

/** 消灯の棒の濃さ（見本 `.meter i` の白 18%）。 */
const OFF_ALPHA = 0.18;
/** 棒の高さ（見本 `.meter` の 6）。 */
const BAR_HEIGHT = space.x6;
/** 棒の間（見本 `.meter` の 3）。 */
const BAR_GAP = 3;

/**
 * 入力レベル（見本 `.meter`、DESIGN_SYSTEM.md §6）。24 本の短い棒を左から点け、20 本目から先は
 * `mistakeSolid`（琥珀）。消灯の棒は、置く面（`background`。収録画面では番組の色）に白 18% を重ねた色。
 * 読み上げの文言は呼び出し側が渡す（`ui/` は文言を持たない）。
 */
export function LevelBars({
  db,
  background,
  accessibilityLabel,
}: {
  /** 入力の dBFS。録音していなければ null（全部消灯）。 */
  db: number | null;
  /** 棒を置く面の色（不透明）。 */
  background: string;
  accessibilityLabel: string;
}) {
  const c = useAppTheme();
  const lit = litBars(db);
  const off = compositeHex(c.textPrimary, OFF_ALPHA, background);
  return (
    <View
      style={s.row}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {Array.from({ length: LEVEL_BARS }, (_, i) => {
        const state = barState(i, lit);
        return (
          <View
            key={i}
            style={[
              s.bar,
              {
                backgroundColor:
                  state === 'hot' ? c.mistakeSolid : state === 'on' ? c.textPrimary : off,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: BAR_GAP, height: BAR_HEIGHT },
  bar: { flex: 1, borderRadius: radius.xs / 2 },
});
