import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '../Text';
import { useAppTheme } from '../ThemeContext';
import { buttonDepth, radius, space, stroke, typography } from '../tokens';
import { useReducedMotion } from '../useReducedMotion';

/**
 * 素材を入れる丸いステッカー（DESIGN_SYSTEM.md §2.5、§8）。色は素材の種類
 * （差し込み = insert、BGM = music）。傾きは項目ごとに固定し、押すと影の分だけ沈む。
 */
export function AssetSticker({
  label,
  kind,
  tilt,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  kind: 'insert' | 'music';
  tilt: number;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const c = useAppTheme();
  const reduced = useReducedMotion();
  const [held, setHeld] = useState(false);
  const down = held && !reduced;
  const fill = kind === 'music' ? c.musicSolid : c.insertSolid;
  const ink = kind === 'music' ? c.musicOnSolid : c.insertOnSolid;
  const shift = down ? buttonDepth.travel : 0;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        s.sticker,
        {
          backgroundColor: fill,
          borderColor: c.controlBorder,
          transform: [{ translateX: shift }, { translateY: shift }, { rotate: `${tilt}deg` }],
          boxShadow: [
            {
              offsetX: down ? buttonDepth.pressedOffset : buttonDepth.offset,
              offsetY: down ? buttonDepth.pressedOffset : buttonDepth.offset,
              blurRadius: 0,
              color: c.controlShadow,
            },
          ],
        },
      ]}
    >
      <Text style={[typography.label, s.center, { color: ink }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  sticker: {
    flex: 1,
    aspectRatio: 1,
    borderWidth: stroke.selected,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xs,
  },
  center: { textAlign: 'center' },
});
