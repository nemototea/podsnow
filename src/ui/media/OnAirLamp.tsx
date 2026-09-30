import { StyleSheet, View } from 'react-native';

import { useT } from '@/i18n';

import { Text } from '../Text';
import { useAppTheme } from '../ThemeContext';
import { buttonDepth, radius, space, sticker, stroke, typography } from '../tokens';

/**
 * 看板の ON AIR（DESIGN_SYSTEM.md §2.4）。点灯は録音中（`SessionState === 'recording'`）だけ。
 * ほかの状態では同じ形・同じ位置で消灯する。読み上げは横の状態の文言が担うので、ここは読ませない。
 */
export function OnAirLamp({ lit }: { lit: boolean }) {
  const c = useAppTheme();
  const t = useT();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        s.lamp,
        lit
          ? {
              backgroundColor: c.recSolid,
              borderColor: c.controlBorder,
              boxShadow: [
                {
                  offsetX: buttonDepth.offset,
                  offsetY: buttonDepth.offset,
                  blurRadius: 0,
                  color: c.controlShadow,
                },
              ],
            }
          : { backgroundColor: c.surfaceHover, borderColor: c.textDisabled },
      ]}
    >
      <Text style={[typography.sign, { color: lit ? c.recOnSolid : c.textDisabled }]}>
        {t.record.onAir}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  lamp: {
    alignSelf: 'flex-start',
    borderWidth: stroke.selected,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    transform: [{ rotate: `${sticker.lamp}deg` }],
  },
});
