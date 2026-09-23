import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatClock, formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { useHome } from '@/features/home/useHome';
import { useT, type Messages } from '@/i18n';
import type { EpisodeListItem } from '@/infra/db/repositories/episodesRepo';
import { space, tabularNums, typography } from '@/ui/tokens';
import {
  Button,
  Card,
  IconButton,
  Notice,
  Row,
  Screen,
  SectionHeader,
  Sheet,
  Text,
  Toast,
} from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';
import { Wordmark } from '@/ui/Wordmark';

function nextActionLabel(t: Messages, e: EpisodeListItem): string {
  if (e.take_count === 0) return t.home.startRecording;
  if (e.status === 'exported') return t.home.share;
  return t.home.continueEditing;
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
  const { list, cont, loading, reload } = useHome();
  const { toast, show: showToast, act, dismiss } = useToast();
  const [menu, setMenu] = useState<EpisodeListItem | null>(null);
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
    setMenu(null);
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
    setMenu(null);
    await episodes.purgeAudio(e.id);
    await reload();
    showToast({ text: t.home.audioPurged(e.episode_number) });
  };

  const duplicate = async (e: EpisodeListItem) => {
    setMenu(null);
    const d = await episodes.duplicate(e.id);
    await reload();
    showToast({ text: t.home.duplicated(d.episode_number) });
  };

  const rec = recovered[0];
  const others = cont ? list.filter((e) => e.id !== cont.id) : list;

  return (
    <Screen
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
        <Card>
          <Text style={[typography.heading, { color: c.textPrimary }]} numberOfLines={2}>
            {cont.title || t.home.untitled}
          </Text>
          <View style={st.contMeta}>
            <Text style={[typography.mono, tabularNums, { color: c.textSecondary }]}>
              {t.home.episodeCode(cont.episode_number)} · {formatClock(smp(cont.duration_smp))}
            </Text>
            <Text style={[typography.caption, { color: c.textSecondary }]}>
              {statusText(t, cont)} · {t.home.takes(cont.take_count)}
            </Text>
          </View>
          <Button
            label={nextActionLabel(t, cont)}
            kind="secondary"
            onPress={() => router.push(`/episode/${cont.id}`)}
          />
        </Card>
      ) : !loading && list.length === 0 ? (
        <Card>
          <Text style={[typography.heading, { color: c.textPrimary }]}>{t.home.firstTitle}</Text>
          <Text style={[typography.body, { color: c.textSecondary, marginTop: space.xs }]}>
            {t.home.firstLead}
          </Text>
        </Card>
      ) : null}

      {others.length > 0 ? (
        <>
          <SectionHeader
            title={t.home.sectionEpisodes}
            right={
              <Text style={[typography.mono, tabularNums, { color: c.textSecondary }]}>
                {list.length}
              </Text>
            }
          />
          {others.map((e, i) => (
            <Row
              key={e.id}
              mono={String(e.episode_number).padStart(3, '0')}
              label={e.title || t.home.untitled}
              sub={
                e.audio_purged_at
                  ? t.home.badgeNoAudio
                  : `${formatSmp(smp(e.duration_smp))} · ${statusText(t, e)}`
              }
              last={i === others.length - 1}
              onPress={() => router.push(`/episode/${e.id}`)}
              right={
                <IconButton
                  name="more"
                  label={t.home.a11yEpisodeMenu(e.episode_number)}
                  onPress={() => setMenu(e)}
                />
              }
            />
          ))}
        </>
      ) : null}

      <SectionHeader title={t.home.moreSection} />
      <Card style={st.linkCard}>
        <Row
          icon="show"
          label={t.home.showAndAssets}
          sub={t.home.showAndAssetsSub}
          onPress={() => router.push('/show')}
        />
        <Row
          icon="download"
          label={t.home.restore}
          sub={t.home.restoreSub}
          onPress={() => router.push('/restore')}
          last
        />
      </Card>

      <Sheet
        visible={!!menu}
        onClose={() => setMenu(null)}
        title={
          menu ? `${t.home.episodeCode(menu.episode_number)} ${menu.title || t.home.untitled}` : ''
        }
      >
        {menu ? (
          <>
            <Row icon="copy" label={t.home.menu.duplicate} onPress={() => void duplicate(menu)} />
            <Row
              icon="archive"
              label={t.home.menu.backup}
              sub={t.home.menu.backupSub}
              onPress={() => {
                setMenu(null);
                router.push(`/episode/${menu.id}/backup`);
              }}
            />
            {menu.audio_purged_at ? null : (
              <Row
                icon="volume"
                label={t.home.menu.purgeAudio}
                sub={t.home.menu.purgeAudioSub}
                onPress={() => void purgeAudio(menu)}
              />
            )}
            <Row
              icon="trash"
              label={t.home.menu.remove}
              sub={
                menu.status === 'exported'
                  ? t.home.menu.removeExportedNote(menu.episode_number)
                  : t.home.menu.removeSub
              }
              danger
              last
              onPress={() => void remove(menu)}
            />
          </>
        ) : null}
      </Sheet>
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
  contMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
    marginTop: space.xs,
    marginBottom: space.lg,
  },
  linkCard: { paddingVertical: space.xs },
});
