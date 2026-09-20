import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatSmp, smp } from '@/domain/time';
import { deleteRange, placeVoice } from '@/domain/timeline/voice';
import { useServices } from '@/features/app/ServicesProvider';
import { useEpisode, voiceDurationSmp } from '@/features/episode/useEpisode';
import { listExports } from '@/infra/db/repositories/exportsRepo';
import type { TakeRow } from '@/infra/db/repositories/takesRepo';
import { parseSoundSettings } from '@/services/audio/renderDocumentFromDb';
import { Button, Card, Eyebrow, Header, Loading, Row, Screen, Sheet, Toast } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

const STATUS_LABEL = { draft: 'DRAFT', ready: 'READY', exported: 'EXPORTED' } as const;

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
  const router = useRouter();
  const services = useServices();
  const { episode, reload } = useEpisode(episodeId);
  const { toast, show: showToast, act } = useToast();
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
      soundLabel: sound.loudness.enabled ? `${sound.loudness.targetLufs} LUFS` : '正規化なし',
      detailsDone: !!ep && ep.title.trim().length > 0 && ep.description.trim().length > 0,
    });
  }, [episodeId, services]);

  useFocusEffect(
    useCallback(() => {
      void reload();
      void loadSummary();
    }, [reload, loadSummary]),
  );

  if (!episode || !summary) return <Loading label="読み込んでいます" />;

  const go = (path: string) => router.push(path as never);
  const statusTone =
    episode.status === 'draft' ? c.accent : episode.status === 'ready' ? c.voice : c.ink2;
  const hasVoice = summary.durationSmp > 0;

  const steps = [
    {
      label: '録音',
      meta: `${summary.takes.length} テイク`,
      done: summary.takes.length > 0,
      path: `/episode/${episodeId}/editor`,
    },
    {
      label: '編集',
      meta: hasVoice ? formatSmp(smp(summary.durationSmp)) : '未',
      done: hasVoice,
      path: `/episode/${episodeId}/editor`,
    },
    {
      label: '詳細（タイトル・概要）',
      meta: summary.detailsDone ? '入力済み' : '未入力',
      done: summary.detailsDone,
      path: `/episode/${episodeId}/details`,
    },
    {
      label: '音の仕上げ',
      meta: summary.soundLabel,
      done: true,
      path: `/episode/${episodeId}/sound`,
    },
    {
      label: '書き出し',
      meta: summary.exportCount > 0 ? `${summary.exportCount} 件` : '未',
      done: summary.exportCount > 0,
      path: `/episode/${episodeId}/export`,
    },
  ];

  const removeTakeFromTimeline = async (take: TakeRow) => {
    setTakeMenu(null);
    const editing = await services.openEditing(episodeId);
    const placed = placeVoice(editing.current.voice).filter((p) => p.segment.takeId === take.id);
    if (!placed.length) {
      showToast({ text: 'このテイクはタイムラインに含まれていません' });
      return;
    }
    await editing.apply(`${take.name} をタイムラインから削除`, (d) => {
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
      text: `${take.name} をタイムラインから削除しました（元データは残ります）`,
      action: '取り消す',
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
      text: `#${d.episode_number} として複製しました`,
      action: '開く',
      onAction: () => go(`/episode/${d.id}`),
    });
  };

  const remove = async () => {
    setMenu(false);
    await services.episodes.remove(episodeId);
    router.back();
  };

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} />}>
      <Header
        title={`Episode #${episode.episode_number}`}
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={() => setMenu(true)}
            hitSlop={10}
            accessibilityLabel="メニュー"
            accessibilityRole="button"
          >
            <Text style={{ color: c.ink2, fontSize: 22 }}>⋮</Text>
          </Pressable>
        }
      />
      <Text style={[st.title, { color: c.ink }]}>{episode.title}</Text>
      <View style={st.metaRow}>
        <Text style={[st.badge, { color: statusTone, borderColor: statusTone }]}>
          {STATUS_LABEL[episode.status]}
        </Text>
        <Text style={[st.meta, { color: c.ink2 }]}>{formatSmp(smp(summary.durationSmp))}</Text>
        <Text style={[st.meta, { color: c.ink2 }]}>SEASON {episode.season}</Text>
      </View>

      <Eyebrow>制作状況</Eyebrow>
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
        <Eyebrow>RECORDINGS</Eyebrow>
        <Text style={{ color: c.ink2, fontSize: 12, marginTop: 18 }}>
          {summary.takes.length} 件
        </Text>
      </View>
      <Card style={{ paddingVertical: 4 }}>
        {summary.takes.length === 0 ? (
          <Text style={{ color: c.ink3, paddingVertical: 12 }}>まだ録音がありません</Text>
        ) : null}
        {summary.takes.map((t) => (
          <Row
            key={t.id}
            label={t.name}
            sub={`${formatSmp(smp(t.duration_smp))}${t.input_label ? ` · ${t.input_label}` : ''}${t.status === 'recovered' ? ' · 復元' : ''}`}
            onPress={() => go(`/episode/${episodeId}/editor`)}
            right={
              <Pressable
                onPress={() => setTakeMenu(t)}
                hitSlop={10}
                accessibilityLabel={`${t.name} のメニュー`}
                accessibilityRole="button"
              >
                <Text style={{ color: c.ink2, fontSize: 18 }}>⋮</Text>
              </Pressable>
            }
          />
        ))}
      </Card>

      <Button
        label={summary.takes.length ? '収録・編集を続ける' : '録音を始める'}
        onPress={() => go(`/episode/${episodeId}/editor`)}
        style={{ marginTop: 8 }}
      />

      <Sheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={`Episode #${episode.episode_number}`}
        subtitle={episode.title}
      >
        <Row
          label="収録・編集を続ける"
          onPress={() => {
            setMenu(false);
            go(`/episode/${episodeId}/editor`);
          }}
        />
        <Row
          label="エピソードの詳細"
          onPress={() => {
            setMenu(false);
            go(`/episode/${episodeId}/details`);
          }}
        />
        <Row
          label="音の仕上げ"
          sub={summary.soundLabel}
          onPress={() => {
            setMenu(false);
            go(`/episode/${episodeId}/sound`);
          }}
        />
        <Row
          label="書き出し"
          onPress={() => {
            setMenu(false);
            go(`/episode/${episodeId}/export`);
          }}
        />
        <Row label="複製して新しい回にする" onPress={duplicate} />
        <Row
          label="バックアップ（.podsnow）"
          onPress={() => {
            setMenu(false);
            router.push(`/episode/${id}/backup`);
          }}
        />
        <Row
          label="エピソードを削除"
          sub="元の録音は残ります・Home で取り消せます"
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
              label="編集画面で開く"
              onPress={() => {
                setTakeMenu(null);
                go(`/episode/${episodeId}/editor`);
              }}
            />
            <Row
              label="タイムラインから削除"
              sub="元データは残ります・取り消し可"
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
