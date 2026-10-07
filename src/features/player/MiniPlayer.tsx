import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { compositeHex } from '@/domain/color/showColors';
import { formatClock, formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { useDraftBar } from '@/features/home/draftBar';
import { episodeStatusKind } from '@/features/home/statusIcon';
import { useShowColors } from '@/features/show/useShowColors';
import { errorCodeText, useT } from '@/i18n';
import { Artwork } from '@/ui/Artwork';
import { IconButton, Text } from '@/ui/components';
import { progressRatio } from '@/ui/seek';
import { ShowGradient } from '@/ui/ShowGradient';
import { useAppTheme } from '@/ui/ThemeContext';
import { artwork, player as playerToken, radius, space, typography } from '@/ui/tokens';

import { usePlayback } from './usePlayback';

/** 補助文字の白の濃さ（見本 `.mini .t small` 72%）と、進み具合の地（`.mini .bar` 25%）。 */
const SUB_ALPHA = 0.72;
const TRACK_ALPHA = 0.25;

/** ミニプレーヤーを出すか（下部の `Dock` が自分の高さを決めるのにも使う）。 */
export function useMiniPlayerVisible(): boolean {
  const player = usePlayback();
  const pathname = usePathname();
  const draft = useDraftBar();
  const source = player.source?.homeKey ? player.source : null;
  return (!!source && pathname !== '/player') || (!source && pathname === '/' && !!draft);
}

/**
 * 下書きバー兼ミニプレーヤー（見本 `.mini`、DESIGN_SYSTEM.md §8）。地は番組の色（`miniPlayer`）。
 * 再生中・一時停止中はその回を、何も再生していなければ Home にだけ途中の下書きを出す。
 * 置き場所（タブの上、下部の溶け込みの中）は `Dock` が決める。
 */
export function MiniPlayer() {
  const player = usePlayback();
  const services = useServices();
  const t = useT();
  const c = useAppTheme();
  const router = useRouter();
  const pathname = usePathname();
  const colors = useShowColors();
  const draft = useDraftBar();
  const source = player.source?.homeKey ? player.source : null;
  const draftItem = !source && pathname === '/' ? draft : null;
  const visible = (!!source && pathname !== '/player') || !!draftItem;
  if (!visible) return null;

  const bg = colors.miniPlayer;
  const sub = compositeHex(c.textPrimary, SUB_ALPHA, bg);
  const episodeId = source ? source.episodeId : draftItem?.local?.id;
  const rawTitle = (source ? source.title : draftItem?.title) || t.home.untitled;
  const number = source ? (source.episodeNumber ?? null) : (draftItem?.episodeNumber ?? null);
  // 見本 `.mini .t b`「#43 寝る前に読む本」
  const title = number === null ? rawTitle : `${t.episode.number(number)} ${rawTitle}`;

  let status: string;
  if (draftItem) {
    const kind = episodeStatusKind(draftItem);
    status = t.home.miniDraft(
      kind === 'ready' ? t.status.ready : t.status.draft,
      formatSmp(smp(draftItem.durationSmp)),
    );
  } else if (player.error) {
    status = errorCodeText(t, player.error);
  } else if (player.loading) {
    status = source?.kind === 'rss' ? t.player.loadingStream : t.player.loadingFile;
  } else {
    status = `${formatClock(player.position)} / ${formatClock(player.duration)}`;
  }

  return (
    <View style={s.shell}>
      <ShowGradient stops={[[bg, 0]]} />
      <Pressable
        onPress={() =>
          draftItem && episodeId ? router.push(`/episode/${episodeId}`) : router.push('/player')
        }
        accessibilityRole="button"
        accessibilityLabel={draftItem ? t.home.miniOpenDraft(title) : t.player.open}
        style={s.main}
      >
        <Artwork
          uri={services.coverArt.uri(services.show.cover_path)}
          name={number === null ? services.show.name : t.episode.number(number)}
          size={artwork.miniPlayer}
        />
        <View style={s.text}>
          <Text style={[typography.chipStrong, { color: c.textPrimary }]} numberOfLines={1}>
            {title}
          </Text>
          <Text
            style={[typography.small, { color: player.error && !draftItem ? c.textPrimary : sub }]}
            numberOfLines={player.error ? 2 : 1}
            accessibilityLiveRegion="polite"
          >
            {status}
          </Text>
        </View>
      </Pressable>
      {episodeId ? (
        <IconButton
          name="mic"
          color={c.textPrimary}
          label={t.home.miniRecord}
          onPress={() => router.push(`/episode/${episodeId}`)}
        />
      ) : null}
      <IconButton
        name={player.error && !draftItem ? 'refresh' : player.playing ? 'pause' : 'play'}
        color={c.textPrimary}
        label={
          player.error && !draftItem ? t.player.retry : player.playing ? t.a11y.pause : t.a11y.play
        }
        busy={!draftItem && player.loading}
        onPress={() => void (draftItem ? player.toggleHome(draftItem) : player.toggleCurrent())}
      />
      {/* 閉じるのは一時停止中だけ。再生中に押し間違えないように（Issue #199） */}
      {source && !player.playing ? (
        <IconButton
          name="close"
          color={c.textPrimary}
          label={t.player.stop}
          onPress={() => void player.stopHome()}
        />
      ) : null}
      {/* 進み具合（Issue #188）。時刻は文字でも出しているので、読み上げには出さない */}
      {source || draftItem ? (
        <View
          style={[s.progress, { backgroundColor: compositeHex(c.textPrimary, TRACK_ALPHA, bg) }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View
            style={[
              s.progressFill,
              {
                // 下書きは編集の再生位置（見本 `.mini .bar` は下書きにも出す）
                width: `${
                  (draftItem
                    ? progressRatio(draftItem.local?.playhead_smp ?? 0, draftItem.durationSmp)
                    : progressRatio(player.position, player.duration)) * 100
                }%`,
                backgroundColor: c.textPrimary,
              },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  // 見本 `.mini`: 左右 8、角丸 8、内側 8、間 10。
  shell: {
    marginHorizontal: space.sm,
    borderRadius: radius.sm,
    padding: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.x10,
    overflow: 'hidden',
  },
  main: {
    flex: 1,
    // 長い題でも再生ボタンを押し出さず、題のほうを省略する
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.x10,
  },
  text: { flex: 1, minWidth: 0 },
  // 見本 `.mini .bar`: 左右 8、下端、太さ 2。
  progress: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    bottom: 0,
    height: playerToken.miniProgress,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: radius.pill },
});
