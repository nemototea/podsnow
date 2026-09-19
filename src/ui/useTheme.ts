import { useColorScheme } from 'react-native';

import { palette, type Theme } from './theme';

/** 設定（Dark / Light / System）と OS の配色から実際のテーマを決める。 */
export function useTheme(
  pref: 'dark' | 'light' | 'system' = 'system',
): Theme & { isDark: boolean } {
  const scheme = useColorScheme();
  const isDark = pref === 'system' ? scheme !== 'light' : pref === 'dark';
  return { ...(isDark ? palette.dark : palette.light), isDark };
}
