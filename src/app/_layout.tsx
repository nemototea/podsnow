import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ServicesProvider, useServices } from '@/features/app/ServicesProvider';
import { Loading } from '@/ui/components';
import { ThemeProvider, useAppTheme } from '@/ui/ThemeContext';

function Navigation() {
  const c = useAppTheme();
  const nav = c.isDark ? DarkTheme : DefaultTheme;
  return (
    <NavThemeProvider
      value={{
        ...nav,
        colors: {
          ...nav.colors,
          background: c.bg,
          card: c.panel,
          text: c.ink,
          border: c.line,
          primary: c.accent,
        },
      }}
    >
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />
      <StatusBar style={c.isDark ? 'light' : 'dark'} />
    </NavThemeProvider>
  );
}

function Themed() {
  const services = useServices();
  const [pref, setPref] = useState(services.settings.theme);
  useEffect(() => services.onSettingsChange((s) => setPref(s.theme)).remove, [services]);
  return (
    <ThemeProvider pref={pref}>
      <Navigation />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ServicesProvider
        fallback={
          <ThemeProvider pref="system">
            <Loading label="準備しています" />
          </ThemeProvider>
        }
      >
        <Themed />
      </ServicesProvider>
    </GestureHandlerRootView>
  );
}
