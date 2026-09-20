import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatSmp, smp } from '@/domain/time';
import { deleteRange, placeVoice } from '@/domain/timeline/voice';
import { useServices } from '@/features/app/ServicesProvider';
import { useEpisode, voiceDurationSmp } from '@/features/episode/useEpisode';
import { useT } from '@/i18n';
import { listExports } from '@/infra/db/repositories/exportsRepo';
import type { TakeRow } from '@/infra/db/repositories/takesRepo';
import { parseSoundSettings } from '@/services/audio/renderDocumentFromDb';
import { Button, Card, Eyebrow, Header, Loading, Row, Screen, Sheet, Toast } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

interface Summary {
  durationSmp: number;
  takes: TakeRow[];
  exportCount: number;
  soundLabel: string;
  detailsDone: boolean;
}

/** Episode トップ: 5 工程の唯一の入口とテイク一覧（REQUIREMENTS.md FR-EP-5）。 */
export default function EpisodeTopScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const episodeId = id ?? '';
  const c = useAppTheme();
  const t = useT();
  const router = useRouter();
  const services = useServices();
  const { episode, reload } = useEpisode(episodeId);
  const { toast, show: showToast, act, dismiss } = useToast();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [menu, setMenu] = useState(false);
  const [takeMenu, setTakeMenu] = useState<TakeRow | null>(null);

  const loadSummary = useCallback(async () => {
    const ep = await services.episodes.get(episodeId);
    const [durationSmp, takes, exports] = await Promise.all([
      voiceDurationSmp(services.db, episodeId),
      services.episodes.listTakes(episodeId),
      listExports(services.db, episodeId),
    ]);
    const sound = parseSoundSettings(ep?.sound_settings);
    setSummary({
      durationSmp,
      takes: takes.filter((t) => t.status === 'ready' || t.status === 'recovered'),
      exportCount: exports.filter((e) => e.status === 'done').length,
      soundLabel: sound.loudness.enabled
        ? `${sound.loudness.targetLufs} LUFS`
        : t.episode.noNormalization,
      detailsDone: !!ep && ep.title.trim().length > 0 && ep.description.trim().length > 0,
    });
  }, [episodeId, services, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
      void loadSummary();
    }, [reload, loadSummary]),
  );

  if (!episode || !summary) return <Loading label={t.common.loading} />;

  const go = (path: string) => router.push(path as never);
  const statusTone =
    episode.status === 'draft' ? c.accent : episode.status === 'ready' ? c.voice : c.ink2;
  const hasVoice = summary.durationSmp > 0;

  const steps = [
    {
      label: t.episode.steps.record,
      meta: t.episode.steps.recordMeta(summary.takes.length),
      done: summary.takes.length > 0,
      path: `/episode/${episodeId}/editor`,
    },
    {
      label: t.episode.steps.edit,
      meta: hasVoice ? formatSmp(smp(summary.durationSmp)) : t.episode.steps.todo,
      done: hasVoice,
      path: `/episode/${episodeId}/editor`,
    },
    {
      label: t.episode.steps.details,
      meta: summary.detailsDone ? t.episode.steps.detailsDone : t.episode.steps.detailsTodo,
      done: summary.detailsDone,
      path: `/episode/${episodeId}/details`,
    },
    {
      label: t.episode.steps.sound,
      meta: summary.soundLabel,
      done: true,
      path: `/episode/${episodeId}/sound`,
    },
    {
      label: t.episode.steps.export,
      meta:
        summary.exportCount > 0
          ? t.episode.steps.exportMeta(summary.exportCount)
          : t.episode.steps.todo,
      done: summary.exportCount > 0,
      path: `/episode/${episodeId}/export`,
    },
  ];

  const removeTakeFromTimeline = async (take: TakeRow) => {
    setTakeMenu(null);
    const editing = await services.openEditing(episodeId);
    const placed = placeVoice(editing.current.voice).filter((p) => p.segment.takeId === take.id);
    if (!placed.length) {
      showToast({ text: t.episode.takeNotOnTimeline });
      return;
    }
    await editing.apply(t.undo.removeTakeFromTimeline(take.name), (d) => {
      let voice = d.voice;
      // 後ろから消せば前の座標がずれない
      for (const p of [...placeVoice(voice)]
        .filter((x) => x.segment.takeId === take.id)
        .reverse()) {
        voice = deleteRange(voice, p.start, p.end);
      }
      return { ...d, voice };
    });
    await services.episodes.refreshStatus(episodeId);
    await loadSummary();
    showToast({
      text: t.episode.takeRemoved(take.name),
      action: t.common.undo,
      onAction: async () => {
        await editing.undo();
        await loadSummary();
      },
    });
  };

  const duplicate = async () => {
    setMenu(false);
    const d = await services.episodes.duplicate(episodeId);
    showToast({
      text: t.episode.duplicated(d.episode_number),
      action: t.common.open,
      onAction: () => go(`/episode/${d.id}`),
    });
  };

  const remove = async () => {
    setMenu(false);
    await services.episodes.remove(episodeId);
    router.back();
  };

  /** 音声だけ削除（FR-EP-4）。話数・詳細・書き出し履歴は残る。取り消せない。 */
  const purgeAudio = async () => {
    setMenu(false);
    await services.episodes.purgeAudio(episodeId);
    await loadSummary();
    showToast({ text: t.episode.audioPurged });
  };

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}>
      <Header
        title={t.episode.headerTitle(episode.episode_number)}
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={() => setMenu(true)}
            hitSlop={10}
            accessibilityLabel={t.a11y.menu}
            accessibilityRole="button"
          >
            <Text style={{ color: c.ink2, fontSize: 22 }}>⋮</Text>
          </Pressable>
        }
      />
      <Text style={[st.title, { color: c.ink }]}>{episode.title || t.episode.untitled}</Text>
      <View style={st.metaRow}>
        <Text style={[st.badge, { color: statusTone, borderColor: statusTone }]}>
          {t.status[episode.status]}
        </Text>
        <Text style={[st.meta, { color: c.ink2 }]}>{formatSmp(smp(summary.durationSmp))}</Text>
        <Text style={[st.meta, { color: c.ink2 }]}>{t.episode.seasonLabel(episode.season)}</Text>
      </View>

      <Eyebrow>{t.episode.progress}</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        {steps.map((s) => (
          <Row
            key={s.label}
            label={`${s.done ? '✓' : '○'}  ${s.label}`}
            sub={s.meta}
            onPress={() => go(s.path)}
          />
        ))}
      </Card>

      <View style={st.sectionHead}>
        <Eyebrow>{t.episode.sectionRecordings}</Eyebrow>
        <Text style={{ color: c.ink2, fontSize: 12, marginTop: 18 }}>
          {t.common.countItems(summary.takes.length)}
        </Text>
      </View>
      <Card style={{ paddingVertical: 4 }}>
        {summary.takes.length === 0 ? (
          <Text style={{ color: c.ink3, paddingVertical: 12 }}>{t.episode.noRecordings}</Text>
        ) : null}
        {summary.takes.map((take) => (
          <Row
            key={take.id}
            label={take.name}
            sub={`${formatSmp(smp(take.duration_smp))}${take.input_label ? ` · ${take.input_label}` : ''}${take.status === 'recovered' ? ` · ${t.episode.recovered}` : ''}`}
            onPress={() => go(`/episode/${episodeId}/editor`)}
            right={
              <Pressable
                onPress={() => setTakeMenu(take)}
                hitSlop={10}
                accessibilityLabel={t.a11y.menuFor(take.name)}
                accessibilityRole="button"
              >
                <Text style={{ color: c.ink2, fontSize: 18 }}>⋮</Text>
              </Pressable>
            }
          />
        ))}
      </Card>

      <Button
        label={summary.takes.length ? t.episode.continueEditing : t.episode.startRecording}
        onPress={() => go(`/episode/${episodeId}/editor`)}
        style={{ marginTop: 8 }}
      />

      <Sheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={t.episode.headerTitle(episode.episode_number)}
        subtitle={episode.title || t.episode.untitled}
      >
        <Row
          label={t.episode.continueEditing}
          onPress={() => {
            setMenu(false);
            go(`/episode/${episodeId}/editor`);
          }}
        />
        <Row
          label={t.episode.menu.details}
          onPress={() => {
            setMenu(false);
            go(`/episode/${episodeId}/details`);
          }}
        />
        <Row
          label={t.episode.menu.sound}
          sub={summary.soundLabel}
          onPress={() => {
            setMenu(false);
            go(`/episode/${episodeId}/sound`);
          }}
        />
        <Row
          label={t.episode.menu.export}
          onPress={() => {
            setMenu(false);
            go(`/episode/${episodeId}/export`);
          }}
        />
        <Row label={t.episode.menu.duplicate} onPress={duplicate} />
        <Row
          label={t.episode.menu.backup}
          onPress={() => {
            setMenu(false);
            router.push(`/episode/${id}/backup`);
          }}
        />
        {episode.audio_purged_at ? null : (
          <Row
            label={t.episode.menu.purgeAudio}
            sub={t.episode.menu.purgeAudioSub}
            onPress={purgeAudio}
          />
        )}
        <Row
          label={t.episode.menu.remove}
          sub={
            episode.status === 'exported'
              ? t.episode.menu.removeExportedNote(episode.episode_number)
              : t.episode.menu.removeSub
          }
          danger
          onPress={remove}
        />
      </Sheet>

      <Sheet
        visible={!!takeMenu}
        onClose={() => setTakeMenu(null)}
        title={takeMenu?.name ?? ''}
        subtitle={takeMenu ? formatSmp(smp(takeMenu.duration_smp)) : ''}
      >
        {takeMenu ? (
          <>
            <Row
              label={t.episode.takeMenu.openInEditor}
              onPress={() => {
                setTakeMenu(null);
                go(`/episode/${episodeId}/editor`);
              }}
            />
            <Row
              label={t.episode.takeMenu.removeFromTimeline}
              sub={t.episode.takeMenu.removeFromTimelineSub}
              danger
              onPress={() => removeTakeFromTimeline(takeMenu)}
            />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', marginTop: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  badge: {
    fontSize: 10,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
    letterSpacing: 1,
  },
  meta: { fontSize: 12, letterSpacing: 1 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
