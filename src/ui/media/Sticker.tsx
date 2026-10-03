import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';
import { useAppTheme } from '../ThemeContext';
import { icon as iconSize, radius, space, stroke, typography } from '../tokens';

/**
 * 傾けた丸い端のラベル（DESIGN_SYSTEM.md §2.5）。エピソードの状態、CUE など。
 * 傾きは呼び出し側で項目ごとに固定する（`stickerTilt(i)`）。文字は読み上げにもそのまま渡る。
 * `icon` は文字の前に置く印（エピソードの状態。§6.4）。飾りなので読み上げには出ない。
 */
export function Sticker({
  label,
  fill,
  ink,
  tilt = 0,
  numeric,
  icon,
  style,
}: {
  label: string;
  fill: string;
  ink: string;
  tilt?: number;
  /** 時刻など数字の入ったステッカー（等幅数字）。 */
  numeric?: boolean;
  icon?: IconName;
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
      {icon ? <Icon name={icon} color={ink} size={iconSize.sm} /> : null}
      <Text style={[numeric ? typography.numeric : typography.label, { color: ink }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  sticker: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: stroke.selected,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.hair,
  },
});
