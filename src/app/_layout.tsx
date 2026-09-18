import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { palette } from '@/ui/theme';

export default function RootLayout() {
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';
  const navTheme = isDark ? DarkTheme : DefaultTheme;
  const colors = isDark ? palette.dark : palette.light;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider
        value={{
          ...navTheme,
          colors: {
            ...navTheme.colors,
            background: colors.bg,
            card: colors.panel,
            text: colors.ink,
            border: colors.line,
            primary: colors.accent,
          },
        }}
      >
        <Stack screenOptions={{ headerShown: false }} />
        <StatusBar style={isDark ? 'light' : 'dark'} />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
