import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { useServices } from '@/features/app/ServicesProvider';
import { playerDetails } from '@/features/player/playerDetails';
import { usePlayback } from '@/features/player/usePlayback';
import { usePlayerItem } from '@/features/player/usePlayerItem';
import { errorCodeText, formatDate, useLocale, useT, type Messages } from '@/i18n';
import type { PlaybackSource } from '@/services/audio/PlaybackService';
import { compositeHex } from '@/domain/color/showColors';
import { useShowColors } from '@/features/show/useShowColors';
import { Artwork } from '@/ui/Artwork';
import { IconButton, Screen, Text, useGutter } from '@/ui/components';
import { PlayerControls, SeekBlock } from '@/ui/SeekBar';
import { ShowGradient } from '@/ui/ShowGradient';
import { useAppTheme } from '@/ui/ThemeContext';
import { artwork, radius, space, typography } from '@/ui/tokens';

/** 番組の色の上の補助文字の白の濃さ（見本 `.np .title span` の 72%）。 */
const SUB_ALPHA = 0.72;

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
  const colors = useShowColors();
  const sub = compositeHex(c.textPrimary, SUB_ALPHA, colors.nowPlaying);

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
    <Screen padded={false} overlay={null}>
      {/* 地は収録画面と同じ番組の色のグラデーション（DESIGN_SYSTEM.md §8） */}
      <ShowGradient
        stops={[
          [colors.nowPlaying, 0],
          [colors.nowPlayingMid, 0.55],
          [c.bg, 1],
        ]}
      />
      <View style={[st.body, { paddingHorizontal: gutter }]}>
        <View style={st.top}>
          <IconButton name="chevron" color={c.textPrimary} label={t.player.close} onPress={close} />
        </View>
        <View style={st.media}>
          <Artwork
            uri={services.coverArt.uri(services.show.cover_path)}
            name={services.show.name}
            size={Math.min(artwork.playerSheet, room)}
            label={t.player.artwork}
            shadow="large"
          />
        </View>
        <View style={st.titleBlock}>
          <Text
            style={[typography.nowPlaying, { color: title ? c.textPrimary : sub }]}
            accessibilityRole="header"
            numberOfLines={2}
          >
            {code === null ? title || t.home.untitled : `${code} ${title || t.home.untitled}`}
          </Text>
          <Text style={[typography.body, { color: sub }]} numberOfLines={1}>
            {services.show.name}
          </Text>
          <Text style={[typography.small, { color: sub }]}>{meta}</Text>
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
          <View style={[st.about, { backgroundColor: c.surface }]}>
            <Text
              style={[typography.subheading, { color: c.textPrimary }]}
              accessibilityRole="header"
            >
              {t.player.description}
            </Text>
            <Text style={[typography.body, { color: c.textSecondary }]}>{details.description}</Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  body: { paddingTop: space.sm, paddingBottom: space.xxxl, gap: space.lg },
  top: { flexDirection: 'row', justifyContent: 'flex-start' },
  media: { alignItems: 'center', marginVertical: space.sm },
  titleBlock: { gap: space.xs },
  controls: { alignItems: 'center' },
  // 歌詞カードの置き方（番組の色の下の地に、`surface` の角丸の面）
  about: { borderRadius: radius.sm, padding: space.lg, gap: space.sm, marginTop: space.lg },
});
