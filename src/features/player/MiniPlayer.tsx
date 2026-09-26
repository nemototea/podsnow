import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatClock } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { useT } from '@/i18n';
import { Artwork } from '@/ui/Artwork';
import { IconButton, Text, useGutter } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { artwork, player as playerToken, radius, space, stroke, typography } from '@/ui/tokens';

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
  const source = player.source?.homeKey ? player.source : null;
  if (!source || pathname === '/player') return null;
  return (
    <View
      style={[
        s.shell,
        {
          left: gutter,
          right: gutter,
          bottom: insets.bottom + playerToken.miniBottom,
          backgroundColor: c.surfaceRaised,
          borderColor: c.borderStrong,
        },
      ]}
    >
      <Pressable
        onPress={() => router.push('/player')}
        accessibilityRole="button"
        accessibilityLabel={t.player.open}
        style={({ pressed }) => [s.main, pressed ? { backgroundColor: c.surfaceHover } : null]}
      >
        <Artwork uri={services.coverArt.uri(services.show.cover_path)} size={artwork.miniPlayer} />
        <View style={s.text}>
          <Text style={[typography.label, { color: c.textPrimary }]} numberOfLines={1}>
            {source.title || t.home.untitled}
          </Text>
          <Text style={[typography.caption, { color: c.textSecondary }]}>
            {formatClock(player.position)} / {formatClock(player.duration)}
          </Text>
        </View>
      </Pressable>
      <IconButton
        name={player.playing ? 'pause' : 'play'}
        label={player.playing ? t.a11y.pause : t.a11y.play}
        onPress={() => void player.toggleCurrent()}
      />
    </View>
  );
}

const s = StyleSheet.create({
  shell: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: stroke.hairline,
    borderRadius: radius.lg,
    padding: space.xs,
    zIndex: 10,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
  },
  text: { flex: 1 },
});
