import { DarkTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { Dock } from '@/features/app/Dock';
import { ServiceLabelsSync, ServicesProvider, useServices } from '@/features/app/ServicesProvider';
import { LocaleProvider, useT } from '@/i18n';
import { Loading } from '@/ui/components';
import { DialogHost } from '@/ui/Dialog';
import { FontProvider, useFontFamily } from '@/ui/Text';
import { radius, typography } from '@/ui/tokens';
import { ThemeProvider, useAppTheme } from '@/ui/ThemeContext';

function Navigation() {
  const c = useAppTheme();
  const t = useT();
  const fontFamily = useFontFamily();
  const nav = DarkTheme;
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
          headerTintColor: c.textPrimary,
          headerTitleStyle: {
            color: c.textPrimary,
            fontSize: typography.screenTitle.fontSize,
            fontWeight: typography.screenTitle.fontWeight,
            ...(fontFamily ? { fontFamily } : {}),
          },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false, title: t.app.name }} />
        {/* 下部タブの画面（見本 `.tabs`）。タブの間は動きを付けずに切り替える */}
        <Stack.Screen
          name="search"
          options={{ headerShown: false, title: t.tabs.search, animation: 'none' }}
        />
        <Stack.Screen
          name="library"
          options={{ headerShown: false, title: t.tabs.library, animation: 'none' }}
        />
        {/*
          プレーヤーは下から出るシート。下へ引いて閉じる（Issue #188）。formSheet は iOS では
          UISheetPresentationController、Android では BottomSheet で、どちらも引いて閉じられる
          （modal は Android で引いて閉じられない）。高さは画面いっぱい（detent 1.0）
        */}
        <Stack.Screen
          name="player"
          options={{
            title: t.player.title,
            headerShown: false,
            presentation: 'formSheet',
            sheetAllowedDetents: [1],
            sheetGrabberVisible: true,
            sheetCornerRadius: radius.xl,
          }}
        />
      </Stack>
      <Dock />
      <DialogHost />
      <StatusBar style="light" />
    </NavThemeProvider>
  );
}

function Themed() {
  const services = useServices();
  const [language, setLanguage] = useState(services.settings.language);
  useEffect(
    () =>
      services.onSettingsChange((s) => {
        setLanguage(s.language);
      }).remove,
    [services],
  );
  return (
    <LocaleProvider pref={language}>
      {/* 設定で選んだ言語を、DB に書き込む既定文言にも反映する（FR-I18N-6）。 */}
      <ServiceLabelsSync />
      <ThemeProvider>
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
      {/* キーボードの位置を `Screen` / `Sheet` / `Toast` へ配る（Issue #132）。 */}
      <KeyboardProvider>
        <FontProvider>
          <LocaleProvider>
            <ServicesProvider
              fallback={
                <ThemeProvider>
                  <Booting />
                </ThemeProvider>
              }
            >
              <Themed />
            </ServicesProvider>
          </LocaleProvider>
        </FontProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
