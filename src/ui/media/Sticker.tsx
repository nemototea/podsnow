import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '../Text';
import { useAppTheme } from '../ThemeContext';
import { radius, space, stroke, typography } from '../tokens';

/**
 * 傾けた丸い端のラベル（DESIGN_SYSTEM.md §2.5）。エピソードの状態、CUE など。
 * 傾きは呼び出し側で項目ごとに固定する（`stickerTilt(i)`）。文字は読み上げにもそのまま渡る。
 */
export function Sticker({
  label,
  fill,
  ink,
  tilt = 0,
  numeric,
  style,
}: {
  label: string;
  fill: string;
  ink: string;
  tilt?: number;
  /** 時刻など数字の入ったステッカー（等幅数字）。 */
  numeric?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useAppTheme();
  return (
    <View
      style={[
        s.sticker,
        {
          backgroundColor: fill,
          borderColor: c.controlBorder,
          transform: [{ rotate: `${tilt}deg` }],
        },
        style,
      ]}
    >
      <Text style={[numeric ? typography.numeric : typography.label, { color: ink }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  sticker: {
    alignSelf: 'flex-start',
    borderWidth: stroke.selected,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.hair,
  },
});
