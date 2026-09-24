import { Stack } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { typography } from './tokens';

/**
 * 画面のナビゲーションバー（DESIGN_SYSTEM.md §6.2）。見た目は `_layout.tsx` の既定で当てる。
 *
 * `lockBack` の間は戻るボタン・スワイプ・Android の戻るキーを止め、`onLockedBack` で理由を伝える
 * （収録中に画面を離れない、FR-EP-5）。
 */
export function ScreenHeader({
  title,
  subtitle,
  right,
  lockBack,
  onLockedBack,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  lockBack?: boolean;
  onLockedBack?: () => void;
}) {
  const c = useAppTheme();
  usePreventRemove(!!lockBack, () => onLockedBack?.());
  return (
    <Stack.Screen
      options={{
        title,
        gestureEnabled: !lockBack,
        ...(subtitle
          ? {
              headerTitle: () => (
                <View style={st.title} accessibilityRole="header">
                  <Text style={[typography.label, { color: c.textPrimary }]} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={[typography.caption, { color: c.textSecondary }]} numberOfLines={1}>
                    {subtitle}
                  </Text>
                </View>
              ),
            }
          : {}),
        ...(right ? { headerRight: () => right } : {}),
      }}
    />
  );
}

const st = StyleSheet.create({
  title: { alignItems: Platform.OS === 'ios' ? 'center' : 'flex-start' },
});
