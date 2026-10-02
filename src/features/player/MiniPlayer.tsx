import { usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatClock } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { errorCodeText, useT } from '@/i18n';
import { floatingInset } from '@/ui/BottomInset';
import { IconButton, Text, useCompact, useGutter } from '@/ui/components';
import { Jacket, MiniCassette } from '@/ui/media';
import { useAppTheme } from '@/ui/ThemeContext';
import {
  artwork,
  buttonDepth,
  player as playerToken,
  radius,
  space,
  stroke,
  typography,
} from '@/ui/tokens';

import { usePlayback } from './usePlayback';

export function MiniPlayer() {
  const player = usePlayback();
  const services = useServices();
  const t = useT();
  const c = useAppTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const gutter = useGutter();
  // 幅の狭い端末では、題が読めなくなるので見立ての絵を省く（Issue #199）
  const compact = useCompact();
  const source = player.source?.homeKey ? player.source : null;
  const visible = !!source && pathname !== '/player';
  // 出ていない間は、画面に空けさせていた分を返す（Issue #164）
  useEffect(() => {
    if (!visible) floatingInset.set(0);
  }, [visible]);
  useEffect(() => () => floatingInset.set(0), []);
  if (!source || !visible) return null;
  // 読み込み中・失敗は位置の代わりに出す（Issue #185）
  const status = player.error
    ? errorCodeText(t, player.error)
    : player.loading
      ? source.kind === 'rss'
        ? t.player.loadingStream
        : t.player.loadingFile
      : `${formatClock(player.position)} / ${formatClock(player.duration)}`;
  return (
    <View
      // 覆っている高さ（safe area より上）を `Screen` へ知らせ、下部の操作を覆わせない（Issue #164）。
      // 硬い影は枠の外へ出るので、その分も含める
      onLayout={(e) =>
        floatingInset.set(e.nativeEvent.layout.height + buttonDepth.offset + playerToken.miniBottom)
      }
      style={[
        s.shell,
        {
          left: gutter,
          right: gutter,
          bottom: insets.bottom + playerToken.miniBottom,
          backgroundColor: c.surfaceRaised,
          borderColor: c.controlBorder,
          boxShadow: [
            {
              offsetX: buttonDepth.offset,
              offsetY: buttonDepth.offset,
              blurRadius: 0,
              color: c.controlShadow,
            },
          ],
        },
      ]}
    >
      <Pressable
        onPress={() => router.push('/player')}
        accessibilityRole="button"
        accessibilityLabel={t.player.open}
        style={({ pressed }) => [s.main, pressed ? { backgroundColor: c.surfaceHover } : null]}
      >
        {/* 再生の見立て（DESIGN_SYSTEM.md §2.6） */}
        {compact ? null : source.kind === 'timeline' ? (
          <MiniCassette size={artwork.miniPlayer} playing={player.playing} />
        ) : (
          <Jacket
            uri={services.coverArt.uri(services.show.cover_path)}
            name={services.show.name}
            size={artwork.miniPlayer}
            playing={player.playing}
          />
        )}
        <View style={s.text}>
          <Text style={[typography.label, { color: c.textPrimary }]} numberOfLines={1}>
            {source.title || t.home.untitled}
          </Text>
          <Text
            style={[
              player.error || player.loading ? typography.caption : typography.numeric,
              { color: player.error ? c.dangerText : c.textSecondary },
            ]}
            numberOfLines={player.error ? 2 : 1}
            accessibilityLiveRegion="polite"
          >
            {status}
          </Text>
        </View>
      </Pressable>
      <IconButton
        name={player.error ? 'refresh' : player.playing ? 'pause' : 'play'}
        label={player.error ? t.player.retry : player.playing ? t.a11y.pause : t.a11y.play}
        busy={player.loading}
        onPress={() => void player.toggleCurrent()}
      />
      {/* 閉じるのは一時停止中だけ。再生中に押し間違えないように（Issue #199） */}
      {player.playing ? null : (
        <IconButton name="close" label={t.player.stop} onPress={() => void player.stopHome()} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  shell: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: stroke.selected,
    borderRadius: radius.lg,
    padding: space.xs,
    paddingLeft: space.sm,
    zIndex: 10,
  },
  main: {
    flex: 1,
    // 長い題でも再生ボタンを押し出さず、題のほうを省略する
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
  },
  text: { flex: 1, minWidth: 0 },
});
