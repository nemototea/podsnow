import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { avatar as SIZES, hitSlop, radius, typography } from './tokens';

/**
 * 頭文字の丸（見本 `.avatar`）。地は `avatar` の灰、白の極太。`onPress` があれば押せる（Home の設定への入口）。
 */
export function Avatar({
  name,
  size = 'md',
  onPress,
  accessibilityLabel,
}: {
  name: string;
  size?: keyof typeof SIZES;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const c = useAppTheme();
  const d = SIZES[size];
  const initial = [...name.trim()][0]?.toUpperCase() ?? '';
  const body = (
    <View style={[s.circle, { width: d, height: d, backgroundColor: c.avatar }]}>
      <Text
        style={[
          size === 'md' ? typography.label : typography.avatarSmall,
          { color: c.textPrimary },
        ]}
      >
        {initial}
      </Text>
    </View>
  );
  if (!onPress) {
    return (
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={hitSlop(d)}
    >
      {body}
    </Pressable>
  );
}

const s = StyleSheet.create({
  circle: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
