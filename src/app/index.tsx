import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { useHome } from '@/features/home/useHome';
import type { EpisodeListItem } from '@/infra/db/repositories/episodesRepo';
import { Button, Card, Eyebrow, Row, Screen, Sheet, Toast } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

const STATUS_LABEL = { draft: 'Draft', ready: 'Ready', exported: 'Exported' } as const;

export default function HomeScreen() {
  const c = useAppTheme();
  const router = useRouter();
  const { show, episodes, recovered } = useServices();
  const { list, cont, reload } = useHome();
  const { toast, show: showToast, act } = useToast();
  const [menu, setMenu] = useState<EpisodeListItem | null>(null);
  const [creating, setCreating] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const [recoveredShown, setRecoveredShown] = useState(false);
  if (recovered.length && !recoveredShown) {
    setRecoveredShown(true);
    const r = recovered[0]!;
    showToast({
      text: `未確定の録音を復元しました（${formatSmp(r.durationSmp)}）`,
      action: '開く',
      onAction: () => router.push(`/episode/${r.episodeId}/editor`),
    });
  }

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const ep = await episodes.create(show.id);
      router.push(`/episode/${ep.id}/editor`);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (e: EpisodeListItem) => {
    setMenu(null);
    await episodes.remove(e.id);
    await reload();
    showToast({
      text: `#${e.episode_number} を削除しました（元の録音は残ります）`,
      action: '取り消す',
      onAction: async () => {
        await episodes.restore(e.id);
        await reload();
      },
    });
  };

  const duplicate = async (e: EpisodeListItem) => {
    setMenu(null);
    const d = await episodes.duplicate(e.id);
    await reload();
    showToast({ text: `#${d.episode_number} として複製しました` });
  };

  return (
    <Screen
      overlay={
        <>
          <Pressable
            onPress={create}
            accessibilityLabel="新しいエピソード"
            style={[st.fab, { backgroundColor: c.accent }]}
          >
            <Text style={st.fabText}>＋</Text>
          </Pressable>
          <Toast toast={toast} onAction={act} />
        </>
      }
    >
      <View style={st.top}>
        <View style={{ flex: 1 }}>
          <Text style={[st.hello, { color: c.ink2 }]}>こんにちは</Text>
          <Text style={[st.showName, { color: c.ink }]} numberOfLines={1}>
            {show.name}
          </Text>
          <Text style={[st.meta, { color: c.ink2 }]}>
            SEASON {show.default_season} · {list.length} EPISODES
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/settings')}
          hitSlop={10}
          accessibilityLabel="設定"
          style={st.gear}
        >
          <Text style={{ color: c.ink2, fontSize: 22 }}>⚙</Text>
        </Pressable>
      </View>

      {cont ? (
        <Card style={{ borderColor: c.accent }}>
          <Text style={[st.eyebrowInline, { color: c.accent }]}>
            ● {cont.status === 'draft' && cont.take_count === 0 ? 'NEW' : 'EDITING'}
          </Text>
          <Text style={[st.contNum, { color: c.ink2 }]}>#{cont.episode_number}</Text>
          <Text style={[st.contTitle, { color: c.ink }]} numberOfLines={2}>
            {cont.title}
          </Text>
          <Text style={[st.meta, { color: c.ink2, marginBottom: 12 }]}>
            {formatSmp(smp(cont.duration_smp))} · {cont.take_count} テイク
          </Text>
          <Button
            label={cont.take_count === 0 ? '録音を始める' : '収録・編集を続ける'}
            onPress={() => router.push(`/episode/${cont.id}/editor`)}
          />
        </Card>
      ) : (
        <Card>
          <Text style={{ color: c.ink, fontSize: 16, fontWeight: '700' }}>
            最初のエピソードを作りましょう
          </Text>
          <Text style={{ color: c.ink2, marginTop: 6, marginBottom: 12, lineHeight: 20 }}>
            「＋」で新しい回を作ると、Show の既定構成（Opening / Ending /
            BGM）が配置され、すぐ録音できます。
          </Text>
          <Button label="新しいエピソード" onPress={create} />
        </Card>
      )}

      <View style={st.sectionHead}>
        <Eyebrow>EPISODES</Eyebrow>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.push('/restore')} hitSlop={8} style={{ marginRight: 14 }}>
          <Text style={{ color: c.ink2, fontSize: 12, marginTop: 18 }}>復元</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/show/assets')} hitSlop={8}>
          <Text style={{ color: c.accent, fontSize: 12, marginTop: 18 }}>Show Assets ›</Text>
        </Pressable>
      </View>
      <Card style={{ paddingVertical: 4 }}>
        {list.length === 0 ? (
          <Text style={{ color: c.ink3, paddingVertical: 12 }}>まだエピソードがありません</Text>
        ) : null}
        {list.map((e) => (
          <Row
            key={e.id}
            label={`#${e.episode_number}  ${e.title}`}
            sub={`${formatSmp(smp(e.duration_smp))} · ${e.take_count} テイク`}
            onPress={() => router.push(`/episode/${e.id}`)}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text
                  style={[
                    st.badge,
                    {
                      color:
                        e.status === 'draft' ? c.accent : e.status === 'ready' ? c.voice : c.ink2,
                      borderColor:
                        e.status === 'draft' ? c.accent : e.status === 'ready' ? c.voice : c.ink3,
                    },
                  ]}
                >
                  {STATUS_LABEL[e.status]}
                </Text>
                <Pressable onPress={() => setMenu(e)} hitSlop={10} accessibilityLabel="メニュー">
                  <Text style={{ color: c.ink2, fontSize: 18 }}>⋮</Text>
                </Pressable>
              </View>
            }
          />
        ))}
      </Card>

      <Sheet
        visible={!!menu}
        onClose={() => setMenu(null)}
        title={menu ? `#${menu.episode_number} ${menu.title}` : ''}
      >
        {menu ? (
          <>
            <Row
              label="収録・編集を続ける"
              onPress={() => {
                setMenu(null);
                router.push(`/episode/${menu.id}/editor`);
              }}
            />
            <Row
              label="エピソードを開く"
              onPress={() => {
                setMenu(null);
                router.push(`/episode/${menu.id}`);
              }}
            />
            <Row
              label="エピソードの詳細"
              onPress={() => {
                setMenu(null);
                router.push(`/episode/${menu.id}/details`);
              }}
            />
            <Row
              label="書き出し"
              onPress={() => {
                setMenu(null);
                router.push(`/episode/${menu.id}/export`);
              }}
            />
            <Row label="複製して新しい回にする" onPress={() => duplicate(menu)} />
            <Row
              label="バックアップ（.podsnow）"
              sub="録音と編集データをまとめて書き出す"
              onPress={() => {
                setMenu(null);
                router.push(`/episode/${menu.id}/backup`);
              }}
            />
            <Row
              label="エピソードを削除"
              sub="元の録音は残ります・取り消し可"
              danger
              onPress={() => remove(menu)}
            />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: 8, marginBottom: 16 },
  hello: { fontSize: 12 },
  showName: { fontSize: 24, fontWeight: '700', marginTop: 2 },
  meta: { fontSize: 11, letterSpacing: 1, marginTop: 4 },
  gear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  eyebrowInline: { fontSize: 10, letterSpacing: 1.6, marginBottom: 8 },
  contNum: { fontSize: 12 },
  contTitle: { fontSize: 20, fontWeight: '700', marginTop: 2 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: {
    fontSize: 10,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabText: { fontSize: 28, color: '#141414', marginTop: -2 },
});
