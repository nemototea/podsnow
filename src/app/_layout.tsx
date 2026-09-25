import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ServiceLabelsSync, ServicesProvider, useServices } from '@/features/app/ServicesProvider';
import { LocaleProvider, useT } from '@/i18n';
import { Loading } from '@/ui/components';
import { DialogHost } from '@/ui/Dialog';
import { FontProvider, useFontFamily } from '@/ui/Text';
import { typography } from '@/ui/tokens';
import { ThemeProvider, useAppTheme } from '@/ui/ThemeContext';

function Navigation() {
  const c = useAppTheme();
  const t = useT();
  const fontFamily = useFontFamily();
  const nav = c.isDark ? DarkTheme : DefaultTheme;
  return (
    <NavThemeProvider
      value={{
        ...nav,
        colors: {
          ...nav.colors,
          background: c.bg,
          card: c.surface,
          text: c.textPrimary,
          border: c.border,
          primary: c.accentSolid,
        },
      }}
    >
      <Stack
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: c.bg },
          headerShadowVisible: false,
          headerTintColor: c.accentText,
          headerTitleStyle: {
            color: c.textPrimary,
            fontSize: typography.bodyStrong.fontSize,
            fontWeight: typography.bodyStrong.fontWeight,
            ...(fontFamily ? { fontFamily } : {}),
          },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false, title: t.app.name }} />
      </Stack>
      <DialogHost />
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
      {/* 設定で選んだ言語を、DB に書き込む既定文言にも反映する（FR-I18N-6）。 */}
      <ServiceLabelsSync />
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
      <FontProvider>
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
      </FontProvider>
    </GestureHandlerRootView>
  );
}
