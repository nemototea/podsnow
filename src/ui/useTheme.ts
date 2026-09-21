import { useColorScheme } from 'react-native';

import { colors, type Colors } from './tokens';

/** 設定（Dark / Light / System）と OS の配色から実際のテーマを決める。 */
export function useTheme(
  pref: 'dark' | 'light' | 'system' = 'system',
): Colors & { isDark: boolean } {
  const scheme = useColorScheme();
  const isDark = pref === 'system' ? scheme !== 'light' : pref === 'dark';
  return { ...(isDark ? colors.dark : colors.light), isDark };
}
