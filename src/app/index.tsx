import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatClock, formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { useHome } from '@/features/home/useHome';
import { usePlaybackStatus } from '@/features/player/usePlayback';
import { HomeArtwork } from '@/features/home/HomeArtwork';
import { settleHandoffs } from '@/features/home/handToHome';
import { episodeStatusKind, STATUS_ICON, type EpisodeStatusKind } from '@/features/home/statusIcon';
import { errorText, useT, type Messages } from '@/i18n';
import type { EpisodeListItem } from '@/infra/db/repositories/episodesRepo';
import { icon, space, stickerTilt, typography, type Colors } from '@/ui/tokens';
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
} from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';
import { confirmDestructive } from '@/ui/alerts';
import type { MenuAction } from '@/ui/menuTypes';
import { MoreMenu } from '@/ui/MoreMenu';
import { Wordmark } from '@/ui/Wordmark';
import { Sticker } from '@/ui/media';

/**
 * エピソードの状態のステッカーの色（DESIGN_SYSTEM.md §2.5、#190）。文字は必ず出し、
 * 色は淡い地と同じ系統の文字（tone）の組でコントラストを保つ。
 */
function statusTone(c: Colors, kind: EpisodeStatusKind): { fill: string; ink: string } {
  switch (kind) {
    case 'published':
      return { fill: c.successSubtle, ink: c.successText };
    case 'noAudio':
      return { fill: c.surfaceRaised, ink: c.textSecondary };
    case 'new':
      return { fill: c.surface, ink: c.textPrimary };
    case 'exported':
      return { fill: c.accentSubtle, ink: c.accentText };
    default:
      return { fill: c.mistakeSubtle, ink: c.mistakeText };
  }
}

function statusText(t: Messages, kind: EpisodeStatusKind): string {
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

export default function HomeScreen() {
  const c = useAppTheme();
  const t = useT();
  const router = useRouter();
  const services = useServices();
  const { show, episodes, recovered } = services;
  const { list, playable, loading, reload } = useHome();
  const player = usePlaybackStatus();
  const [onboardingDone, setOnboardingDone] = useState(services.settings.onboardingDone);
  const { toast, show: showToast, act, dismiss } = useToast();
  const [creating, setCreating] = useState(false);
  const [recoveredOpen, setRecoveredOpen] = useState(recovered.length > 0);

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

  /** 録音と書き出しのファイルもすぐ消えるので、取り消しは出さない（Issue #152）。 */
  const remove = async (e: EpisodeListItem) => {
    try {
      await episodes.remove(e.id);
      showToast({ text: t.home.removed(t.episode.number(e.episode_number)) });
    } catch (err) {
      showToast({ text: errorText(t, err) });
    }
    await reload();
  };

  const purgeAudio = async (e: EpisodeListItem) => {
    try {
      await episodes.purgeAudio(e.id);
      showToast({ text: t.home.audioPurged(t.episode.number(e.episode_number)) });
    } catch (err) {
      showToast({ text: errorText(t, err) });
    }
    await reload();
  };

  const duplicate = async (e: EpisodeListItem) => {
    const d = await episodes.duplicate(e.id);
    await reload();
    showToast({ text: t.episode.duplicated(t.episode.number(d.episode_number)) });
  };

  const episodeActions = (e: EpisodeListItem): MenuAction[] => [
    {
      key: 'duplicate',
      icon: 'copy',
      label: t.episode.menu.duplicate,
      onPress: () => void duplicate(e),
    },
    ...(e.audio_purged_at
      ? []
      : [
          {
            key: 'purge',
            icon: 'noAudio' as const,
            label: t.episode.menu.purgeAudio,
            onPress: () =>
              confirmDestructive({
                title: t.episode.menu.purgeAudio,
                message: t.episode.menu.purgeAudioSub,
                confirmLabel: t.common.delete,
                cancelLabel: t.common.cancel,
                onConfirm: () => void purgeAudio(e),
              }),
          },
        ]),
    {
      key: 'remove',
      icon: 'trash',
      label: t.episode.menu.remove,
      destructive: true,
      onPress: () =>
        confirmDestructive({
          title: t.episode.menu.remove,
          message: t.episode.menu.removeMessage,
          confirmLabel: t.common.delete,
          cancelLabel: t.common.cancel,
          onConfirm: () => void remove(e),
        }),
    },
  ];

  // 番組を設定していなくても、エピソードが 1 本でもあれば番組カードを出す（FR-SHOW-6、Issue #168 E1）
  const showSetUp = onboardingDone || show.feed_imported_at !== null;
  const showOnboarding = !loading && !showSetUp && !list.some((item) => item.local);

  const startNew = async () => {
    setOnboardingDone(true);
    await services.updateSettings('onboardingDone', true);
    router.push('/show');
  };

  // 復元した録音は、回ごとに確認できるようにする（Issue #168 E8）
  const rec = recovered[0];
  const recoveredEpisodes = [...new Set(recovered.map((r) => r.episodeId))];

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
        <HomeArtwork
          uri={services.coverArt.uri(show.cover_path)!}
          playing={player.playing && player.source?.kind !== 'timeline'}
        />
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
                style={[typography.display, { color: c.textPrimary }]}
                accessibilityRole="header"
                numberOfLines={2}
              >
                {show.name}
              </Text>
              <Text style={[typography.caption, { color: c.textSecondary }]} numberOfLines={2}>
                {showSetUp
                  ? t.home.showCardMeta(show.author, list.length)
                  : t.home.showCardUnsetMeta(list.length)}
              </Text>
            </View>
            <Icon name="arrow" color={c.textTertiary} size={icon.sm} />
          </View>
        </Card>
      )}

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
                  const number = list.find((i) => i.local?.id === episodeId)?.episodeNumber;
                  return (
                    <Button
                      key={episodeId}
                      label={
                        number === null || number === undefined
                          ? t.home.reviewRecording
                          : t.home.reviewRecordingOf(t.episode.number(number))
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

      {list.length > 0 ? (
        <>
          {/* 本数は番組カードにだけ出す（DESIGN_SYSTEM.md §8、Issue #168 E6） */}
          <SectionHeader title={t.home.sectionEpisodes} />
          {list.map((item, i) => {
            const e = item.local;
            const number = item.episodeNumber;
            const active = player.source?.homeKey === item.key;
            const kind = episodeStatusKind(item);
            const tone = statusTone(c, kind);
            return (
              <Row
                key={item.key}
                {...(number === null ? {} : { mono: t.episode.number(number) })}
                label={item.title || t.home.untitled}
                labelMuted={!item.title}
                below={
                  <Sticker
                    label={statusText(t, kind)}
                    icon={STATUS_ICON[kind]}
                    fill={tone.fill}
                    ink={tone.ink}
                    tilt={stickerTilt(i)}
                  />
                }
                sub={
                  e?.audio_purged_at && !item.feed
                    ? t.home.badgeNoAudio
                    : formatSmp(smp(item.durationSmp))
                }
                accessibilityLabel={`${item.title || t.home.untitled}, ${statusText(t, kind)}`}
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
                        name={
                          active && player.error
                            ? 'refresh'
                            : active && player.playing
                              ? 'pause'
                              : 'play'
                        }
                        label={
                          active && player.error
                            ? t.player.retry
                            : active && player.playing
                              ? t.a11y.pause
                              : t.a11y.play
                        }
                        busy={active && player.loading}
                        onPress={() => void player.toggleHome(item)}
                      />
                    ) : null}
                    {e ? (
                      <MoreMenu
                        label={t.home.a11yEpisodeMenu(e.episode_number)}
                        title={`${t.episode.number(e.episode_number)} ${e.title || t.home.untitled}`}
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
