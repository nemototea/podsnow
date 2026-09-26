import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatClock, formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { useHome } from '@/features/home/useHome';
import { usePlayback } from '@/features/player/usePlayback';
import { HomeArtwork } from '@/features/home/HomeArtwork';
import { useT, type Messages } from '@/i18n';
import type { EpisodeListItem } from '@/infra/db/repositories/episodesRepo';
import type { HomeEpisodeItem } from '@/services/home/HomeService';
import { icon, space, tabularNums, typography } from '@/ui/tokens';
import {
  Button,
  Card,
  Icon,
  IconButton,
  Notice,
  Row,
  Screen,
  SectionHeader,
  Text,
  Toast,
  type IconName,
} from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';
import { confirmDestructive } from '@/ui/alerts';
import type { MenuAction } from '@/ui/menuTypes';
import { MoreMenu } from '@/ui/MoreMenu';
import { Wordmark } from '@/ui/Wordmark';

/** 状態はアイコンで示す（DESIGN_SYSTEM.md §2.3）。文字は読み上げにだけ使う。 */
function statusIcon(item: HomeEpisodeItem): IconName {
  const e = item.local;
  if (!e || item.feed) return 'check';
  if (e.audio_purged_at) return 'volume';
  if (e.take_count === 0) return 'mic';
  if (e.status === 'exported') return 'check';
  return 'edit';
}

function statusText(t: Messages, item: HomeEpisodeItem): string {
  const e = item.local;
  if (!e || item.feed) return t.home.badgePublished;
  if (e.audio_purged_at) return t.home.badgeNoAudio;
  if (e.take_count === 0) return t.home.badgeNew;
  return t.status[e.status];
}

export default function HomeScreen() {
  const c = useAppTheme();
  const t = useT();
  const router = useRouter();
  const services = useServices();
  const { show, episodes, recovered } = services;
  const { list, playable, loading, reload } = useHome();
  const player = usePlayback();
  const [onboardingDone, setOnboardingDone] = useState(services.settings.onboardingDone);
  const { toast, show: showToast, act, dismiss } = useToast();
  const [creating, setCreating] = useState(false);
  const [recoveredOpen, setRecoveredOpen] = useState(recovered.length > 0);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const ep = await episodes.create(show.id);
      router.push(`/episode/${ep.id}`);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (e: EpisodeListItem) => {
    await episodes.remove(e.id);
    await reload();
    showToast({
      text: t.home.removed(e.episode_number),
      action: t.common.undo,
      onAction: async () => {
        const r = await episodes.restore(e.id);
        await reload();
        showToast({
          text: r.renumbered
            ? t.home.restoredRenumbered(r.episodeNumber)
            : t.home.restored(r.episodeNumber),
        });
      },
    });
  };

  const purgeAudio = async (e: EpisodeListItem) => {
    await episodes.purgeAudio(e.id);
    await reload();
    showToast({ text: t.home.audioPurged(e.episode_number) });
  };

  const duplicate = async (e: EpisodeListItem) => {
    const d = await episodes.duplicate(e.id);
    await reload();
    showToast({ text: t.home.duplicated(d.episode_number) });
  };

  const episodeActions = (e: EpisodeListItem): MenuAction[] => [
    {
      key: 'duplicate',
      icon: 'copy',
      label: t.home.menu.duplicate,
      onPress: () => void duplicate(e),
    },
    ...(e.audio_purged_at
      ? []
      : [
          {
            key: 'purge',
            icon: 'volume' as const,
            label: t.home.menu.purgeAudio,
            onPress: () =>
              confirmDestructive({
                title: t.home.menu.purgeAudio,
                message: t.home.menu.purgeAudioSub,
                confirmLabel: t.common.delete,
                cancelLabel: t.common.cancel,
                onConfirm: () => void purgeAudio(e),
              }),
          },
        ]),
    {
      key: 'remove',
      icon: 'trash',
      label: t.home.menu.remove,
      destructive: true,
      onPress: () =>
        confirmDestructive({
          title: t.home.menu.remove,
          ...(e.status === 'exported'
            ? { message: t.home.menu.removeExportedNote(e.episode_number) }
            : {}),
          confirmLabel: t.common.delete,
          cancelLabel: t.common.cancel,
          onConfirm: () => void remove(e),
        }),
    },
  ];

  // エピソードを先に作っても、番組を設定するまでは入口を残す（FR-SHOW-6）。
  const showOnboarding = !loading && !onboardingDone && show.feed_imported_at === null;

  const startNew = async () => {
    setOnboardingDone(true);
    await services.updateSettings('onboardingDone', true);
    router.push('/show');
  };

  const rec = recovered[0];

  return (
    <Screen
      edgeTop
      overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}
      bottomBar={
        <Button
          label={t.home.newEpisodeCta}
          icon="plus"
          onPress={() => void create()}
          busy={creating}
        />
      }
    >
      <View style={st.top}>
        <Wordmark width={112} />
        <IconButton
          name="settings"
          label={t.a11y.settings}
          onPress={() => router.push('/settings')}
        />
      </View>

      {!showOnboarding && show.cover_path ? (
        <HomeArtwork uri={services.coverArt.uri(show.cover_path)!} />
      ) : null}

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
            <Button label={t.home.onboardingNew} kind="secondary" onPress={() => void startNew()} />
          </View>
        </Card>
      ) : (
        <Card
          onPress={() => router.push('/show')}
          accessibilityLabel={t.home.a11yOpenShow(show.name)}
          style={st.showCard}
        >
          <View style={st.showCardTop}>
            <View style={st.showCardText}>
              <Text
                style={[typography.heading, { color: c.textPrimary }]}
                accessibilityRole="header"
                numberOfLines={2}
              >
                {show.name}
              </Text>
              <Text style={[typography.caption, { color: c.textSecondary }]} numberOfLines={2}>
                {t.home.showCardMeta(show.author, list.length)}
              </Text>
            </View>
            <Icon name="arrow" color={c.textTertiary} size={icon.sm} />
          </View>
        </Card>
      )}

      {rec && recoveredOpen ? (
        <Notice
          kind="warning"
          title={t.home.recoveredTitle}
          body={t.home.recoveredBody(formatClock(rec.durationSmp))}
          action={
            <View style={st.noticeActions}>
              <Button
                label={t.home.reviewRecording}
                kind="secondary"
                compact
                onPress={() => {
                  setRecoveredOpen(false);
                  router.push(`/episode/${rec.episodeId}`);
                }}
              />
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

      {list.length > 0 ? (
        <>
          <SectionHeader
            title={t.home.sectionEpisodes}
            right={
              <Text style={[typography.numeric, tabularNums, { color: c.textSecondary }]}>
                {list.length}
              </Text>
            }
          />
          {list.map((item, i) => {
            const e = item.local;
            const number = item.episodeNumber;
            const active = player.source?.homeKey === item.key;
            return (
              <Row
                key={item.key}
                {...(number === null ? {} : { mono: String(number).padStart(3, '0') })}
                icon={statusIcon(item)}
                label={item.title || t.home.untitled}
                sub={
                  e?.audio_purged_at && !item.feed
                    ? t.home.badgeNoAudio
                    : formatSmp(smp(item.durationSmp))
                }
                accessibilityLabel={`${item.title || t.home.untitled}, ${statusText(t, item)}`}
                last={i === list.length - 1}
                {...(e
                  ? { onPress: () => router.push(`/episode/${e.id}`) }
                  : playable.has(item.key)
                    ? {
                        onPress: () =>
                          void player.toggleHome(item).then((ok) => {
                            if (ok) router.push('/player');
                          }),
                      }
                    : {})}
                right={
                  <View style={st.rowActions}>
                    {playable.has(item.key) ? (
                      <IconButton
                        name={active && player.playing ? 'pause' : 'play'}
                        label={active && player.playing ? t.a11y.pause : t.a11y.play}
                        onPress={() => void player.toggleHome(item)}
                      />
                    ) : null}
                    {e ? (
                      <MoreMenu
                        label={t.home.a11yEpisodeMenu(e.episode_number)}
                        title={`${t.home.episodeCode(e.episode_number)} ${e.title || t.home.untitled}`}
                        actions={episodeActions(e)}
                      />
                    ) : null}
                  </View>
                }
              />
            );
          })}
        </>
      ) : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: -space.md,
  },
  showCard: { marginTop: space.xl },
  showCardTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  showCardText: { flex: 1, gap: space.xs },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  noticeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  onboardingBody: { marginTop: space.xs, marginBottom: space.lg },
  onboardingActions: { gap: space.sm },
});
