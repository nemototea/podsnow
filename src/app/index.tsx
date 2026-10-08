import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { formatClock } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { draftBar, pickDraft, useDraftBar } from '@/features/home/draftBar';
import { EpisodeRow, itemLabel } from '@/features/home/EpisodeRow';
import { settleHandoffs } from '@/features/home/handToHome';
import { episodeStatusKind, type EpisodeStatusKind } from '@/features/home/statusIcon';
import { useEpisodeActions } from '@/features/home/useEpisodeActions';
import { useHome } from '@/features/home/useHome';
import { usePlaybackStatus } from '@/features/player/usePlayback';
import { episodeRef, useT, type Messages } from '@/i18n';
import type { AssetKind } from '@/infra/db/repositories/assetsRepo';
import type { HomeEpisodeItem } from '@/services/home/HomeService';
import { Artwork } from '@/ui/Artwork';
import { Avatar } from '@/ui/Avatar';
import { Button, Card, Chip, Icon, Notice, Screen, Text, Toast } from '@/ui/components';
import type { IconName } from '@/ui/IconSvg';
import { useAppTheme } from '@/ui/ThemeContext';
import {
  artwork,
  pressedOpacity,
  quickTile,
  radius,
  space,
  typography,
  wordmarkSize,
} from '@/ui/tokens';
import { useToast } from '@/ui/useToast';
import { Wordmark } from '@/ui/Wordmark';

type Filter = 'all' | 'draft' | 'exported';

/** 絞り込み（見本の「すべて / 下書き / 書き出し済み」）。 */
function matches(filter: Filter, kind: EpisodeStatusKind): boolean {
  if (filter === 'all') return true;
  const done = kind === 'exported' || kind === 'published';
  return filter === 'exported' ? done : !done;
}

/** 続きからの素材のタイル（見本 `.quick .mat`）。行き先は番組画面の素材・ひな形。 */
const SHORTCUTS: readonly { key: string; icon: IconName; kind?: AssetKind }[] = [
  { key: 'openingEnding', icon: 'music', kind: 'opening' },
  { key: 'bgmJingle', icon: 'music', kind: 'bgm' },
  { key: 'notesTemplate', icon: 'edit' },
];

export default function HomeScreen() {
  const c = useAppTheme();
  const t = useT();
  const router = useRouter();
  const services = useServices();
  const { show, recovered } = services;
  const { list, playable, loading, reload } = useHome();
  const player = usePlaybackStatus();
  const draft = useDraftBar();
  const [onboardingDone, setOnboardingDone] = useState(services.settings.onboardingDone);
  const { toast, show: showToast, act, dismiss } = useToast();
  const [recoveredOpen, setRecoveredOpen] = useState(recovered.length > 0);
  const [filter, setFilter] = useState<Filter>('all');
  const notify = useCallback((text: string) => showToast({ text }), [showToast]);
  const episodeActions = useEpisodeActions(reload, notify);

  // エピソード画面から戻ったら、引き継いだ削除・空の回の片付け（Issue #168）を待ってから読み直す
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      void settleHandoffs().then(async (texts) => {
        await reload();
        const text = texts.at(-1);
        if (focused && text) showToast({ text });
      });
      return () => {
        focused = false;
      };
    }, [reload, showToast]),
  );

  // 下書きバー（ミニプレーヤー）に出す回を一覧から決める
  useEffect(() => {
    if (!loading) draftBar.set(pickDraft(list));
  }, [list, loading]);

  // 番組を設定していなくても、エピソードが 1 本でもあれば番組カードを出す（FR-SHOW-6、Issue #168 E1）
  const showSetUp = onboardingDone || show.feed_imported_at !== null;
  const showOnboarding = !loading && !showSetUp && !list.some((item) => item.local);

  const startNew = async () => {
    setOnboardingDone(true);
    await services.updateSettings('onboardingDone', true);
    router.push('/show');
  };

  const cover = services.coverArt.uri(show.cover_path);
  const open = (item: HomeEpisodeItem) => {
    const e = item.local;
    if (e) router.push(`/episode/${e.id}`);
    else if (playable.has(item.key))
      void player.toggleHome(item).then((ok) => {
        if (ok) router.push('/player');
      });
  };

  // 続きから: 途中の回（左）と、よく使う素材（右）を交互に並べる（見本 `.quick`）
  const inProgress = list
    .filter((item) => {
      const kind = episodeStatusKind(item);
      return kind === 'new' || kind === 'draft' || kind === 'ready';
    })
    .slice(0, SHORTCUTS.length);
  const tiles: (
    { type: 'episode'; item: HomeEpisodeItem } | { type: 'shortcut'; index: number }
  )[] = [];
  for (let i = 0; i < SHORTCUTS.length; i++) {
    const item = inProgress[i];
    if (item) tiles.push({ type: 'episode', item });
    tiles.push({ type: 'shortcut', index: i });
  }

  const visible = list.filter((item) => matches(filter, episodeStatusKind(item)));

  // 復元した録音は、回ごとに確認できるようにする（Issue #168 E8）
  const rec = recovered[0];
  const recoveredEpisodes = [...new Set(recovered.map((r) => r.episodeId))];

  return (
    <Screen edgeTop overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}>
      <View style={st.home}>
        {/* 見本 `.wmrow`: ロゴと右端のアバター（設定への入口） */}
        <View style={st.top}>
          <Wordmark size={wordmarkSize.home} />
          <View style={st.topRight}>
            <Avatar
              name={show.author || show.name}
              accessibilityLabel={t.a11y.settings}
              onPress={() => router.push('/settings')}
            />
          </View>
        </View>

        {showOnboarding ? (
          <Card>
            <Text style={[typography.heading, { color: c.textPrimary }]} accessibilityRole="header">
              {t.home.onboardingTitle}
            </Text>
            <Text style={[typography.body, st.onboardingBody, { color: c.textSecondary }]}>
              {t.home.onboardingBody}
            </Text>
            <View style={st.onboardingActions}>
              <Button
                label={t.home.onboardingImport}
                icon="download"
                onPress={() => router.push('/import')}
              />
              <Button
                label={t.home.onboardingNew}
                kind="secondary"
                onPress={() => void startNew()}
              />
            </View>
          </Card>
        ) : null}

        {list.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={st.chips}
          >
            {(['all', 'draft', 'exported'] as const).map((f) => (
              <Chip
                key={f}
                label={t.home.filters[f]}
                active={filter === f}
                onPress={() => setFilter(f)}
              />
            ))}
          </ScrollView>
        ) : null}

        {rec && recoveredOpen ? (
          <Notice
            kind="warning"
            title={
              recovered.length > 1
                ? t.home.recoveredTitleMany(recovered.length)
                : t.home.recoveredTitle
            }
            body={
              recovered.length > 1
                ? t.home.recoveredBodyMany
                : t.home.recoveredBody(formatClock(rec.durationSmp))
            }
            action={
              <View style={st.noticeActions}>
                {recoveredEpisodes.length > 1 ? (
                  // 複数の回にまたがるときは回ごとのボタン。開いても通知は閉じない（ほかの回も見られるように）
                  recoveredEpisodes.map((episodeId) => {
                    const item = list.find((i) => i.local?.id === episodeId);
                    return (
                      <Button
                        key={episodeId}
                        label={
                          item
                            ? t.home.reviewRecordingOf(episodeRef(t, item.title))
                            : t.home.reviewRecording
                        }
                        kind="secondary"
                        compact
                        onPress={() => router.push(`/episode/${episodeId}`)}
                      />
                    );
                  })
                ) : (
                  <Button
                    label={t.home.reviewRecording}
                    kind="secondary"
                    compact
                    onPress={() => {
                      setRecoveredOpen(false);
                      router.push(`/episode/${rec.episodeId}`);
                    }}
                  />
                )}
                <Button
                  label={t.common.close}
                  kind="ghost"
                  compact
                  onPress={() => setRecoveredOpen(false)}
                />
              </View>
            }
          />
        ) : null}

        {showOnboarding ? null : (
          <View style={st.quick}>
            {tiles.map((tile) => {
              if (tile.type === 'episode') {
                const { item } = tile;
                const label = itemLabel(t, item);
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => open(item)}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    style={({ pressed }) => [
                      st.tile,
                      { backgroundColor: pressed ? c.surfaceHover : c.surfaceRaised },
                    ]}
                  >
                    <Artwork uri={cover} name={show.name} size={quickTile} frameless />
                    <Text
                      style={[typography.captionStrong, st.tileText, { color: c.textPrimary }]}
                      numberOfLines={2}
                    >
                      {label}
                    </Text>
                    {draft?.key === item.key ? (
                      <View style={[st.live, { backgroundColor: c.accentSolid }]} />
                    ) : null}
                  </Pressable>
                );
              }
              const sc = SHORTCUTS[tile.index]!;
              const label = t.home.shortcuts[sc.key as keyof Messages['home']['shortcuts']];
              return (
                <Pressable
                  key={sc.key}
                  onPress={() =>
                    router.push(
                      sc.kind
                        ? { pathname: '/show/assets', params: { kind: sc.kind } }
                        : { pathname: '/show', params: { section: 'templates' } },
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  style={({ pressed }) => [
                    st.tile,
                    { backgroundColor: pressed ? c.surfaceHover : c.surfaceRaised },
                  ]}
                >
                  <View style={[st.mat, { backgroundColor: c.surfaceHover }]}>
                    <Icon name={sc.icon} color={c.textSecondary} size={artwork.matIcon} />
                  </View>
                  <Text
                    style={[typography.captionStrong, st.tileText, { color: c.textPrimary }]}
                    numberOfLines={2}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {showOnboarding ? null : (
          <View style={st.section}>
            <Text style={[typography.title, { color: c.textPrimary }]} accessibilityRole="header">
              {t.home.sectionShows}
            </Text>
            <Pressable
              onPress={() => router.push('/show')}
              accessibilityRole="button"
              accessibilityLabel={t.home.a11yOpenShow(show.name)}
              style={({ pressed }) => [st.showCard, pressed ? st.pressed : null]}
            >
              <Artwork uri={cover} name={show.name} size={artwork.showCard} shadow="card" />
              <View style={st.showCardText}>
                {/* 見本 `.showcard[aria-pressed=true] b`: 今の番組の名前はアクセント */}
                <Text style={[typography.chipStrong, { color: c.accentText }]} numberOfLines={1}>
                  {show.name}
                </Text>
                {/* 本数は番組カードにだけ出す（DESIGN_SYSTEM.md §8、Issue #168 E6） */}
                <Text style={[typography.small, { color: c.textSecondary }]} numberOfLines={1}>
                  {showSetUp ? t.home.showCardCount(list.length) : t.home.showCardUnset}
                </Text>
              </View>
            </Pressable>
          </View>
        )}

        {visible.length > 0 ? (
          <View style={st.section}>
            <Text style={[typography.title, { color: c.textPrimary }]} accessibilityRole="header">
              {t.home.sectionRecent}
            </Text>
            <View style={st.list}>
              {visible.map((item) => (
                <EpisodeRow
                  key={item.key}
                  item={item}
                  onOpen={item.local || playable.has(item.key) ? () => open(item) : undefined}
                  actions={item.local ? episodeActions(item.local) : null}
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  // 見本 `.home`: 上 6、左右 16（Screen の gutter）、まとまりの間 22。
  home: { marginTop: space.x6 - space.sm, gap: space.x22 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chips: { gap: space.sm },
  // 見本 `.quick`: 2 列、間 8。タイルは高さ 52、角丸 4、右の余白 8、間 8。
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '45%',
    flexGrow: 1,
    height: quickTile,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.xs,
    overflow: 'hidden',
    paddingRight: space.sm,
  },
  tileText: { flex: 1 },
  mat: { width: quickTile, height: quickTile, alignItems: 'center', justifyContent: 'center' },
  live: { width: space.sm, height: space.sm, borderRadius: radius.pill },
  section: { gap: space.md },
  // 見本 `.showcard`: 幅 128、間 8（番組名と本数の間は 2）。
  showCard: { width: artwork.showCard, gap: space.sm },
  showCardText: { gap: space.hair },
  list: { gap: space.x14 },
  ep: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  epMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  epText: { flex: 1, minWidth: 0, gap: space.hair + 1 },
  epMeta: { flexDirection: 'row', alignItems: 'center', gap: space.x6 },
  pressed: { opacity: pressedOpacity },
  noticeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  onboardingBody: { marginTop: space.xs, marginBottom: space.lg },
  onboardingActions: { gap: space.sm },
});
