import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { useServices } from '@/features/app/ServicesProvider';
import { playerDetails } from '@/features/player/playerDetails';
import { usePlayback } from '@/features/player/usePlayback';
import { usePlayerItem } from '@/features/player/usePlayerItem';
import { errorCodeText, formatDate, useLocale, useT, type Messages } from '@/i18n';
import type { PlaybackSource } from '@/services/audio/PlaybackService';
import { IconButton, Screen, SectionHeader, Text, useGutter } from '@/ui/components';
import { CASSETTE_MAX, PlayerControls, SeekBlock } from '@/ui/EpisodePlayer';
import { Cassette, Jacket, jacketWidth } from '@/ui/media';
import { progressRatio } from '@/ui/seek';
import { useAppTheme } from '@/ui/ThemeContext';
import { artwork, space, typography } from '@/ui/tokens';

function sourceLabel(t: Messages, source: PlaybackSource): string {
  if (source.kind === 'rss') return t.player.sourceRss;
  if (source.kind === 'export') return t.player.sourceExport;
  return t.player.sourceTimeline;
}

/**
 * プレーヤー画面（Issue #188）。ミニプレーヤーから下から出るシートで開き、下へ引くか閉じるボタンで閉じる
 * （`_layout.tsx` の `presentation: 'formSheet'`）。再生の状態は読むだけで、操作は PlaybackService に任せる。
 */
export default function PlayerScreen() {
  const services = useServices();
  const player = usePlayback();
  const t = useT();
  const locale = useLocale();
  const c = useAppTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const gutter = useGutter();
  const source = player.source?.homeKey ? player.source : null;
  const item = usePlayerItem(source?.homeKey ?? null);

  // 再生を止めた・再生元が消えたら、空の画面を残さずに閉じる
  const closed = useRef(false);
  const close = () => {
    if (closed.current) return;
    closed.current = true;
    if (router.canGoBack()) router.back();
  };
  useEffect(() => {
    if (!source) close();
    // close only reads refs and the router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  if (!source) return <Screen>{null}</Screen>;

  const details = playerDetails(source, item);
  const room = width - gutter * 2;
  const title = source.title ?? '';
  const number = source.episodeNumber ?? null;
  const code = number === null ? null : t.episode.number(number);
  const date = details.date
    ? (details.date.kind === 'published' ? t.player.publishedOn : t.player.recordedOn)(
        formatDate(new Date(details.date.at), locale),
      )
    : null;
  const meta = [date, sourceLabel(t, source)].filter(Boolean).join(' · ');

  return (
    <Screen>
      <View style={st.top}>
        <IconButton name="close" label={t.player.close} onPress={close} />
      </View>
      <View style={st.media}>
        {/* 再生の見立て（DESIGN_SYSTEM.md §2.6） */}
        {source.kind === 'timeline' ? (
          <Cassette
            width={Math.min(room, CASSETTE_MAX)}
            progress={progressRatio(player.position, player.duration)}
            playing={player.playing}
            title={title || t.home.untitled}
            code={code}
          />
        ) : (
          <Jacket
            uri={services.coverArt.uri(services.show.cover_path)}
            name={services.show.name}
            size={Math.min(artwork.playerSheet, room / jacketWidth(1))}
            playing={player.playing}
            label={t.player.artwork}
          />
        )}
      </View>
      <View style={st.titleBlock}>
        <Text style={[typography.label, { color: c.textSecondary }]} numberOfLines={1}>
          {services.show.name}
        </Text>
        {code === null ? null : (
          <Text style={[typography.numeric, { color: c.accentText }]}>{code}</Text>
        )}
        <Text
          style={[typography.title, { color: title ? c.textPrimary : c.textSecondary }]}
          accessibilityRole="header"
          numberOfLines={3}
        >
          {title || t.home.untitled}
        </Text>
        <Text style={[typography.caption, { color: c.textSecondary }]}>{meta}</Text>
      </View>
      <SeekBlock
        position={player.position}
        duration={player.duration}
        loading={player.loading}
        loadingLabel={source.kind === 'rss' ? t.player.loadingStream : t.player.loadingFile}
        errorMessage={player.error ? errorCodeText(t, player.error) : null}
        onSeek={(to) => void player.seek(to)}
      />
      <View style={st.controls}>
        <PlayerControls
          position={player.position}
          duration={player.duration}
          playing={player.playing}
          loading={player.loading}
          failed={!!player.error}
          onToggle={() => void player.toggleCurrent()}
          onSeek={(to) => void player.seek(to)}
        />
      </View>
      {details.description ? (
        <>
          <SectionHeader title={t.player.description} />
          <Text style={[typography.body, { color: c.textSecondary }]}>{details.description}</Text>
        </>
      ) : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'flex-end', marginRight: -space.md },
  media: { alignItems: 'center', marginBottom: space.xl },
  titleBlock: { gap: space.xs, marginBottom: space.lg },
  controls: { alignItems: 'center', marginTop: space.lg },
});
