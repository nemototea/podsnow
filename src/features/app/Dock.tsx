import { usePathname, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useServices } from '@/features/app/ServicesProvider';
import { MiniPlayer, useMiniPlayerVisible } from '@/features/player/MiniPlayer';
import { useT } from '@/i18n';
import { floatingInset } from '@/ui/BottomInset';
import { Icon, Text, type IconName } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { dock, icon, space, typography } from '@/ui/tokens';

type TabKey = 'home' | 'search' | 'library' | 'create';

/** タブを出す画面と、そのとき選んでいるタブ（見本 1・2 は Home と番組の画面にタブを出す）。 */
export function activeTab(pathname: string): TabKey | null {
  if (pathname === '/' || pathname === '/show' || pathname === '/show/assets') return 'home';
  if (pathname === '/search') return 'search';
  if (pathname === '/library') return 'library';
  return null;
}

const TABS: readonly { key: TabKey; icon: IconName }[] = [
  { key: 'home', icon: 'home' },
  { key: 'search', icon: 'search' },
  { key: 'library', icon: 'library' },
  { key: 'create', icon: 'plus' },
];

/**
 * 下部（見本 `.dock`）。内容の上に地の色を溶け込ませ、ミニプレーヤー（下書きバー）と下部タブを重ねる。
 * 覆っている高さ（safe area より上）を `Screen` へ知らせ、内容と下部の操作を覆わせない（Issue #135 / #164）。
 */
export function Dock() {
  const c = useAppTheme();
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const services = useServices();
  const tab = activeTab(pathname);
  const mini = useMiniPlayerVisible();
  const visible = tab !== null || mini;
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!visible) floatingInset.set(0);
  }, [visible]);
  useEffect(() => () => floatingInset.set(0), []);
  if (!visible) return null;

  const go = (key: TabKey) => {
    if (key === 'create') {
      // 作成: 新しいエピソードを作って開く（Home から 2 タップで録音。PRODUCT §5.1）
      if (creating) return;
      setCreating(true);
      void services.episodes
        .create(services.show.id)
        .then((ep) => router.push(`/episode/${ep.id}`))
        .finally(() => setCreating(false));
      return;
    }
    if (key === tab) return;
    services.haptics.play('selection');
    if (key === 'home') {
      router.dismissTo('/');
      return;
    }
    const path = key === 'search' ? '/search' : '/library';
    // タブの間の移動は積み重ねない（戻るで前のタブへ戻らない）
    if (tab === 'search' || tab === 'library') router.replace(path);
    else router.push(path);
  };

  return (
    <View
      pointerEvents="box-none"
      onLayout={(e) => floatingInset.set(Math.max(0, e.nativeEvent.layout.height - insets.bottom))}
      style={[s.dock, tab ? null : { paddingBottom: insets.bottom + space.sm }]}
    >
      {/* 見本 `.dock` の溶け込み: 地の色の 0% → 92%（30px）→ 100%（60px） */}
      <LinearGradient
        pointerEvents="none"
        colors={[c.dockFade, c.dockFadeMid, c.bg]}
        locations={[0, dock.fadeMid / dock.fadeEnd, 1]}
        style={[s.fade, { height: dock.fadeEnd }]}
      />
      <View pointerEvents="none" style={[s.fill, { top: dock.fadeEnd, backgroundColor: c.bg }]} />
      <MiniPlayer />
      {tab ? (
        <View
          accessibilityRole="tablist"
          style={[s.tabs, { paddingBottom: Math.max(dock.tabsBottom, insets.bottom) }]}
        >
          {TABS.map(({ key, icon: name }) => {
            const on = key === tab;
            const fg = on ? c.textPrimary : c.textSecondary;
            return (
              <Pressable
                key={key}
                onPress={() => go(key)}
                accessibilityRole="tab"
                accessibilityLabel={t.tabs[key]}
                accessibilityState={{ selected: on, busy: key === 'create' && creating }}
                style={s.tab}
              >
                <Icon name={name} color={fg} size={icon.md} />
                <Text style={[on ? typography.tabActive : typography.tab, { color: fg }]}>
                  {t.tabs[key]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  // 見本 `.dock`: 上 18 の溶け込みの上にミニプレーヤーとタブ
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: dock.fadeTop,
    zIndex: 10,
  },
  fade: { position: 'absolute', left: 0, right: 0, top: 0 },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // 見本 `.tabs`: 4 等分、上 10・下 22
  tabs: { flexDirection: 'row', paddingTop: dock.tabsTop },
  tab: { flex: 1, alignItems: 'center', gap: dock.tabGap },
});
