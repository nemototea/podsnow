import { Pressable, StyleSheet, View } from 'react-native';

import { formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { useT, type Messages } from '@/i18n';
import type { HomeEpisodeItem } from '@/services/home/HomeService';
import { Artwork } from '@/ui/Artwork';
import { Pill, Text } from '@/ui/components';
import type { MenuAction } from '@/ui/menuTypes';
import { MoreMenu } from '@/ui/MoreMenu';
import { useAppTheme } from '@/ui/ThemeContext';
import { artwork, pressedOpacity, space, typography } from '@/ui/tokens';

import { episodeStatusKind, type EpisodeStatusKind } from './statusIcon';

/** 状態の札の文字（FR-EP-3）。 */
export function statusText(t: Messages, kind: EpisodeStatusKind): string {
  switch (kind) {
    case 'published':
      return t.home.badgePublished;
    case 'noAudio':
      return t.home.badgeNoAudio;
    case 'new':
      return t.home.badgeNew;
    default:
      return t.status[kind];
  }
}

/** 一覧とタイルの題（見本「#43 寝る前に読む本」）。題が無ければ「タイトル未設定」。 */
export function itemLabel(t: Messages, item: HomeEpisodeItem): string {
  const title = item.title || t.home.untitled;
  return item.episodeNumber === null ? title : `${t.episode.number(item.episodeNumber)} ${title}`;
}

/**
 * エピソードの行（見本 `.ep`）。アートワーク 52、題、状態の札と時間、右端に「…」。
 * 行を押すとその回を開く（配信だけの回は再生してプレーヤーを開く。DESIGN_SYSTEM.md §8 E3）。
 */
export function EpisodeRow({
  item,
  onOpen,
  actions,
}: {
  item: HomeEpisodeItem;
  /** 開けない行（手元の回でも再生できる音声も無い）は undefined。 */
  onOpen: (() => void) | undefined;
  /** 「…」の項目。手元の回だけ。 */
  actions: MenuAction[] | null;
}) {
  const c = useAppTheme();
  const t = useT();
  const { show, coverArt } = useServices();
  const e = item.local;
  const kind = episodeStatusKind(item);
  const label = itemLabel(t, item);
  const duration = e?.audio_purged_at && !item.feed ? null : formatSmp(smp(item.durationSmp));
  return (
    <View style={s.ep}>
      <Pressable
        onPress={onOpen}
        disabled={!onOpen}
        accessibilityRole="button"
        accessibilityLabel={[label, statusText(t, kind), duration].filter(Boolean).join(', ')}
        style={({ pressed }) => [s.main, pressed ? { opacity: pressedOpacity } : null]}
      >
        {/* 見本 `.ep .art`: 画像が無いときは話数（「#43」）の表紙 */}
        <Artwork
          uri={coverArt.uri(show.cover_path)}
          name={item.episodeNumber === null ? show.name : t.episode.number(item.episodeNumber)}
          size={artwork.row}
        />
        <View style={s.text}>
          <Text
            style={[typography.rowTitle, { color: item.title ? c.textPrimary : c.textSecondary }]}
            numberOfLines={1}
          >
            {label}
          </Text>
          <View style={s.meta}>
            <Pill
              label={statusText(t, kind)}
              kind={kind === 'exported' || kind === 'published' ? 'strong' : 'default'}
            />
            {duration ? (
              <Text style={[typography.caption, { color: c.textSecondary }]}>{duration}</Text>
            ) : null}
          </View>
        </View>
      </Pressable>
      {e && actions ? (
        <MoreMenu
          label={t.home.a11yEpisodeMenu(e.episode_number)}
          title={`${t.episode.number(e.episode_number)} ${e.title || t.home.untitled}`}
          actions={actions}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  // 見本 `.ep`: 間 12。題と札の行の間 3、札と時間の間 6。
  ep: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  text: { flex: 1, minWidth: 0, gap: space.hair + 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.x6 },
});
