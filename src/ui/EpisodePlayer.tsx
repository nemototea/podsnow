import { runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useMemo, useState } from 'react';
import type { AccessibilityActionEvent } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { formatClock, smp, type Smp } from '@/domain/time';
import { useT } from '@/i18n';

import { Artwork } from './Artwork';
import { IconButton, Text } from './components';
import { useAppTheme } from './ThemeContext';
import { artwork, hit, player, radius, space, tabularNums, typography } from './tokens';

function SeekBar({
  value,
  max,
  onChange,
}: {
  value: Smp;
  max: Smp;
  onChange: (value: Smp) => void;
}) {
  const c = useAppTheme();
  const t = useT();
  const [width, setWidth] = useState(1);
  const seekX = (x: number) =>
    onChange(smp(Math.round((Math.max(0, Math.min(width, x)) / width) * max)));
  const gesture = useMemo(
    () =>
      Gesture.Race(
        Gesture.Tap().onEnd((e) => runOnJS(seekX)(e.x)),
        Gesture.Pan().onUpdate((e) => runOnJS(seekX)(e.x)),
      ),
    // seekX intentionally follows the current width and duration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, max, onChange],
  );
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    const step = 5 * 48000;
    if (e.nativeEvent.actionName === 'increment') onChange(smp(Math.min(max, value + step)));
    if (e.nativeEvent.actionName === 'decrement') onChange(smp(Math.max(0, value - step)));
  };
  return (
    <GestureDetector gesture={gesture}>
      <View
        style={s.seekHit}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t.player.seek}
        accessibilityValue={{ min: 0, max, now: value, text: formatClock(value) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
      >
        <View style={[s.track, { backgroundColor: c.borderStrong }]}>
          <View style={[s.fill, { width: `${ratio * 100}%`, backgroundColor: c.accentSolid }]} />
          <View
            style={[
              s.thumb,
              { left: `${ratio * 100}%`, backgroundColor: c.accentSolid, borderColor: c.surface },
            ]}
          />
        </View>
      </View>
    </GestureDetector>
  );
}

export function EpisodePlayer({
  artworkUri,
  title,
  episodeNumber,
  position,
  duration,
  playing,
  onToggle,
  onSeek,
}: {
  artworkUri: string | null;
  title: string;
  episodeNumber: number | null;
  position: Smp;
  duration: Smp;
  playing: boolean;
  onToggle: () => void;
  onSeek: (to: Smp) => void;
}) {
  const c = useAppTheme();
  const t = useT();
  return (
    <View style={s.player}>
      <Artwork uri={artworkUri} size={artwork.player} label={t.player.artwork} />
      <View style={s.titleBlock}>
        <Text style={[typography.heading, { color: c.textPrimary }]} numberOfLines={2}>
          {title || t.home.untitled}
        </Text>
        {episodeNumber === null ? null : (
          <Text style={[typography.caption, { color: c.textSecondary }]}>
            {t.home.episodeCode(episodeNumber)}
          </Text>
        )}
      </View>
      <View style={s.seekBlock}>
        <SeekBar value={position} max={duration} onChange={onSeek} />
        <View style={s.times}>
          <Text style={[typography.numeric, tabularNums, { color: c.textSecondary }]}>
            {formatClock(position)}
          </Text>
          <Text style={[typography.numeric, tabularNums, { color: c.textSecondary }]}>
            −{formatClock(smp(Math.max(0, duration - position)))}
          </Text>
        </View>
      </View>
      <View style={s.controls}>
        <IconButton
          name="back"
          label={t.player.rewind}
          onPress={() => onSeek(smp(Math.max(0, position - 15 * 48000)))}
        />
        <IconButton
          name={playing ? 'pause' : 'play'}
          label={playing ? t.a11y.pause : t.a11y.play}
          onPress={onToggle}
        />
        <IconButton
          name="arrow"
          label={t.player.forward}
          onPress={() => onSeek(smp(Math.min(duration, position + 30 * 48000)))}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  player: { alignItems: 'center', gap: space.lg },
  titleBlock: { alignItems: 'center', gap: space.xs },
  seekBlock: { width: '100%' },
  seekHit: { minHeight: hit.min, justifyContent: 'center' },
  track: { height: player.seekTrack, borderRadius: radius.pill },
  fill: { height: '100%', borderRadius: radius.pill },
  thumb: {
    position: 'absolute',
    width: player.seekThumb,
    height: player.seekThumb,
    marginLeft: -player.seekThumb / 2,
    marginTop: -(player.seekThumb - player.seekTrack) / 2,
    borderRadius: radius.pill,
    borderWidth: player.seekTrack / 2,
  },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
});
