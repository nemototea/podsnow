import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatClock, formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { useHome } from '@/features/home/useHome';
import { useT, type Messages } from '@/i18n';
import type { EpisodeListItem } from '@/infra/db/repositories/episodesRepo';
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
import { Display, DisplayCells } from '@/ui/device';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';
import { confirmDestructive } from '@/ui/alerts';
import type { MenuAction } from '@/ui/menuTypes';
import { MoreMenu } from '@/ui/MoreMenu';
import { Wordmark } from '@/ui/Wordmark';

function nextActionLabel(t: Messages, e: EpisodeListItem): string {
  if (e.take_count === 0) return t.home.startRecording;
  if (e.status === 'exported') return t.home.share;
  return t.home.continueEditing;
}

/** 状態はアイコンで示す（DESIGN_SYSTEM.md §2.3）。文字は読み上げにだけ使う。 */
function statusIcon(e: EpisodeListItem): IconName {
  if (e.audio_purged_at) return 'volume';
  if (e.take_count === 0) return 'mic';
  if (e.status === 'exported') return 'check';
  return 'edit';
}

function statusText(t: Messages, e: EpisodeListItem): string {
  if (e.audio_purged_at) return t.home.badgeNoAudio;
  if (e.take_count === 0) return t.home.badgeNew;
  return t.status[e.status];
}

export default function HomeScreen() {
  const c = useAppTheme();
  const t = useT();
  const router = useRouter();
  const { show, episodes, recovered } = useServices();
  const { list, cont, reload } = useHome();
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
    {
      key: 'backup',
      icon: 'archive',
      label: t.home.menu.backup,
      onPress: () => router.push(`/episode/${e.id}/backup`),
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
        e.status === 'exported'
          ? confirmDestructive({
              title: t.home.menu.remove,
              message: t.home.menu.removeExportedNote(e.episode_number),
              confirmLabel: t.common.delete,
              cancelLabel: t.common.cancel,
              onConfirm: () => void remove(e),
            })
          : void remove(e),
    },
  ];

  const rec = recovered[0];
  const others = cont ? list.filter((e) => e.id !== cont.id) : list;

  return (
    <Screen
      edgeTop
      overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}
      bottomBar={
        <Button
          label={t.home.newEpisodeCta}
          icon="record"
          kind="rec"
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

      <View style={st.showBlock}>
        <Text
          style={[typography.display, { color: c.textPrimary }]}
          accessibilityRole="header"
          numberOfLines={2}
        >
          {show.name}
        </Text>
        <Text style={[typography.caption, { color: c.textSecondary }]}>
          {t.home.showMeta(show.default_season, list.length)}
        </Text>
      </View>

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

      {cont ? (
        <View style={st.cont}>
          {/* 制作中の回は表示窓で見せる（PN-01、#115） */}
          <Display innerStyle={st.contInner}>
            <View style={st.contMeta} accessibilityLabel={statusText(t, cont)}>
              <Text style={[typography.numeric, tabularNums, { color: c.dispDim }]}>
                {t.home.episodeCode(cont.episode_number)}
              </Text>
              <Icon name={statusIcon(cont)} color={c.dispMistake} size={icon.sm} />
              <Text style={[typography.overline, { color: c.dispMistake }]}>
                {statusText(t, cont)}
              </Text>
            </View>
            <Text
              style={[typography.heading, st.contTitle, { color: c.dispInk }]}
              numberOfLines={2}
            >
              {cont.title || t.home.untitled}
            </Text>
            <DisplayCells
              cells={[
                { label: t.home.cellLength, value: formatClock(smp(cont.duration_smp)) },
                { label: t.home.cellTakes, value: t.home.takesValue(cont.take_count) },
              ]}
            />
          </Display>
          <Button
            label={nextActionLabel(t, cont)}
            icon={cont.take_count === 0 ? 'mic' : cont.status === 'exported' ? 'share' : 'edit'}
            onPress={() => router.push(`/episode/${cont.id}`)}
          />
        </View>
      ) : null}

      {others.length > 0 ? (
        <>
          <SectionHeader
            title={t.home.sectionEpisodes}
            right={
              <Text style={[typography.numeric, tabularNums, { color: c.textSecondary }]}>
                {list.length}
              </Text>
            }
          />
          {others.map((e, i) => (
            <Row
              key={e.id}
              mono={String(e.episode_number).padStart(3, '0')}
              icon={statusIcon(e)}
              label={e.title || t.home.untitled}
              sub={e.audio_purged_at ? t.home.badgeNoAudio : formatSmp(smp(e.duration_smp))}
              accessibilityLabel={`${e.title || t.home.untitled}, ${statusText(t, e)}`}
              last={i === others.length - 1}
              onPress={() => router.push(`/episode/${e.id}`)}
              right={
                <MoreMenu
                  label={t.home.a11yEpisodeMenu(e.episode_number)}
                  title={`${t.home.episodeCode(e.episode_number)} ${e.title || t.home.untitled}`}
                  actions={episodeActions(e)}
                />
              }
            />
          ))}
        </>
      ) : null}

      <SectionHeader title={t.home.moreSection} />
      <Card style={st.linkCard}>
        <Row icon="show" label={t.home.showAndAssets} onPress={() => router.push('/show')} />
        <Row icon="download" label={t.home.restore} onPress={() => router.push('/restore')} last />
      </Card>
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
  showBlock: { marginTop: space.xl, marginBottom: space.xl, gap: space.xs },
  noticeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  cont: { gap: space.md, marginBottom: space.md },
  contInner: { paddingTop: space.md },
  contMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.xs,
    paddingHorizontal: space.md,
  },
  contTitle: { paddingHorizontal: space.md, marginTop: space.xs, marginBottom: space.md },
  linkCard: { paddingVertical: space.xs },
});
