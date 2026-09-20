import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ServicesProvider, useServices } from '@/features/app/ServicesProvider';
import { LocaleProvider, useT } from '@/i18n';
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
  const [theme, setTheme] = useState(services.settings.theme);
  const [language, setLanguage] = useState(services.settings.language);
  useEffect(
    () =>
      services.onSettingsChange((s) => {
        setTheme(s.theme);
        setLanguage(s.language);
      }).remove,
    [services],
  );
  return (
    <LocaleProvider pref={language}>
      <ThemeProvider pref={theme}>
        <Navigation />
      </ThemeProvider>
    </LocaleProvider>
  );
}

/** 設定がまだ読めていない起動直後。言語は端末ロケールに従う。 */
function Booting() {
  const t = useT();
  return <Loading label={t.common.preparing} />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LocaleProvider>
        <ServicesProvider
          fallback={
            <ThemeProvider pref="system">
              <Booting />
            </ThemeProvider>
          }
        >
          <Themed />
        </ServicesProvider>
      </LocaleProvider>
    </GestureHandlerRootView>
  );
}
