import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { useHome } from '@/features/home/useHome';
import { useT } from '@/i18n';
import type { EpisodeListItem } from '@/infra/db/repositories/episodesRepo';
import { Button, Card, Eyebrow, Row, Screen, Sheet, Toast } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

export default function HomeScreen() {
  const c = useAppTheme();
  const t = useT();
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
      text: t.home.recovered(formatSmp(r.durationSmp)),
      action: t.common.open,
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
      text: t.home.removed(e.episode_number),
      action: t.common.undo,
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
    showToast({ text: t.home.duplicated(d.episode_number) });
  };

  return (
    <Screen
      overlay={
        <>
          <Pressable
            onPress={create}
            accessibilityLabel={t.a11y.newEpisode}
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
          <Text style={[st.hello, { color: c.ink2 }]}>{t.home.greeting}</Text>
          <Text style={[st.showName, { color: c.ink }]} numberOfLines={1}>
            {show.name}
          </Text>
          <Text style={[st.meta, { color: c.ink2 }]}>
            {t.home.showMeta(show.default_season, list.length)}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/settings')}
          hitSlop={10}
          accessibilityLabel={t.a11y.settings}
          style={st.gear}
        >
          <Text style={{ color: c.ink2, fontSize: 22 }}>⚙</Text>
        </Pressable>
      </View>

      {cont ? (
        <Card style={{ borderColor: c.accent }}>
          <Text style={[st.eyebrowInline, { color: c.accent }]}>
            ●{' '}
            {cont.status === 'draft' && cont.take_count === 0
              ? t.home.badgeNew
              : t.home.badgeEditing}
          </Text>
          <Text style={[st.contNum, { color: c.ink2 }]}>#{cont.episode_number}</Text>
          <Text style={[st.contTitle, { color: c.ink }]} numberOfLines={2}>
            {cont.title}
          </Text>
          <Text style={[st.meta, { color: c.ink2, marginBottom: 12 }]}>
            {formatSmp(smp(cont.duration_smp))} · {t.home.takes(cont.take_count)}
          </Text>
          <Button
            label={cont.take_count === 0 ? t.home.startRecording : t.home.continueEditing}
            onPress={() => router.push(`/episode/${cont.id}/editor`)}
          />
        </Card>
      ) : (
        <Card>
          <Text style={{ color: c.ink, fontSize: 16, fontWeight: '700' }}>
            {list.length === 0 ? t.home.firstEpisode : t.home.nextEpisode}
          </Text>
          <Text style={{ color: c.ink2, marginTop: 6, marginBottom: 12, lineHeight: 20 }}>
            {t.home.emptyLead}
          </Text>
          <Button label={t.home.newEpisode} onPress={create} />
        </Card>
      )}

      <View style={st.sectionHead}>
        <Eyebrow>{t.home.sectionEpisodes}</Eyebrow>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.push('/restore')} hitSlop={8} style={{ marginRight: 14 }}>
          <Text style={{ color: c.ink2, fontSize: 12, marginTop: 18 }}>{t.home.restore}</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/show/assets')} hitSlop={8}>
          <Text style={{ color: c.accent, fontSize: 12, marginTop: 18 }}>
            {t.home.showAssetsLink}
          </Text>
        </Pressable>
      </View>
      <Card style={{ paddingVertical: 4 }}>
        {list.length === 0 ? (
          <Text style={{ color: c.ink3, paddingVertical: 12 }}>{t.home.noEpisodes}</Text>
        ) : null}
        {list.map((e) => (
          <Row
            key={e.id}
            label={`#${e.episode_number}  ${e.title}`}
            sub={`${formatSmp(smp(e.duration_smp))} · ${t.home.takes(e.take_count)}`}
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
                  {t.status[e.status]}
                </Text>
                <Pressable onPress={() => setMenu(e)} hitSlop={10} accessibilityLabel={t.a11y.menu}>
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
              label={t.home.continueEditing}
              onPress={() => {
                setMenu(null);
                router.push(`/episode/${menu.id}/editor`);
              }}
            />
            <Row
              label={t.home.menu.openEpisode}
              onPress={() => {
                setMenu(null);
                router.push(`/episode/${menu.id}`);
              }}
            />
            <Row
              label={t.home.menu.details}
              onPress={() => {
                setMenu(null);
                router.push(`/episode/${menu.id}/details`);
              }}
            />
            <Row
              label={t.home.menu.export}
              onPress={() => {
                setMenu(null);
                router.push(`/episode/${menu.id}/export`);
              }}
            />
            <Row label={t.home.menu.duplicate} onPress={() => duplicate(menu)} />
            <Row
              label={t.home.menu.backup}
              sub={t.home.menu.backupSub}
              onPress={() => {
                setMenu(null);
                router.push(`/episode/${menu.id}/backup`);
              }}
            />
            <Row
              label={t.home.menu.remove}
              sub={t.home.menu.removeSub}
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
