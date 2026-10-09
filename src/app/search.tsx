import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { htmlToPlainText } from '@/domain/podcast/parseFeed';
import { useServices } from '@/features/app/ServicesProvider';
import { TabHeader } from '@/features/app/TabHeader';
import { EpisodeRow, itemLabel } from '@/features/home/EpisodeRow';
import { useEpisodeActions } from '@/features/home/useEpisodeActions';
import { useHome } from '@/features/home/useHome';
import { usePlaybackStatus } from '@/features/player/usePlayback';
import { kindLabel } from '@/features/show/assetKinds';
import { useT } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import type { HomeEpisodeItem } from '@/services/home/HomeService';
import { Icon, Screen, Text, TextInput, Toast } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { artwork, hit, icon, pressedOpacity, radius, space, typography } from '@/ui/tokens';
import { useToast } from '@/ui/useToast';

/** 大文字・小文字と全角・半角を区別せずに比べる。 */
function norm(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

/**
 * 下部タブの「検索」（見本 `.tabs`）。過去の回（手元と配信済み）と素材を、題・概要・名前で探す。
 * 端末の中だけを探し、通信しない（NFR-2）。
 */
export default function SearchScreen() {
  const c = useAppTheme();
  const t = useT();
  const router = useRouter();
  const services = useServices();
  const { list, playable, reload } = useHome();
  const player = usePlaybackStatus();
  const { toast, show: showToast, act, dismiss } = useToast();
  const [query, setQuery] = useState('');
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const notify = useCallback((text: string) => showToast({ text }), [showToast]);
  const episodeActions = useEpisodeActions(reload, notify);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void reload();
      void services.assets.list(services.show.id).then((a) => alive && setAssets(a));
      return () => {
        alive = false;
      };
    }, [reload, services]),
  );

  const q = norm(query.trim());
  const episodes = useMemo(
    () =>
      q
        ? list.filter((item) =>
            norm(
              [
                itemLabel(t, item),
                item.local?.description ?? '',
                item.feed?.description ? htmlToPlainText(item.feed.description) : '',
              ].join('\n'),
            ).includes(q),
          )
        : [],
    [list, q, t],
  );
  const sounds = useMemo(
    () => (q ? assets.filter((a) => norm(`${a.name}\n${kindLabel(t, a.kind)}`).includes(q)) : []),
    [assets, q, t],
  );

  const open = (item: HomeEpisodeItem) => {
    if (item.local) router.push(`/episode/${item.local.id}`);
    else
      void player.toggleHome(item).then((ok) => {
        if (ok) router.push('/player');
      });
  };

  return (
    <Screen edgeTop overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}>
      <View style={st.page}>
        <TabHeader title={t.tabs.search} />
        <View style={[st.box, { backgroundColor: c.surfaceRaised }]}>
          <Icon name="search" color={c.textSecondary} size={icon.action} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t.search.placeholder}
            placeholderTextColor={c.textTertiary}
            accessibilityLabel={t.search.placeholder}
            returnKeyType="search"
            autoCorrect={false}
            style={[st.input, { color: c.textPrimary }]}
          />
        </View>

        {q && episodes.length === 0 && sounds.length === 0 ? (
          <Text
            style={[typography.body, { color: c.textSecondary }]}
            accessibilityLiveRegion="polite"
          >
            {t.search.noResults}
          </Text>
        ) : null}

        {episodes.length ? (
          <View style={st.section}>
            <Text style={[typography.title, { color: c.textPrimary }]} accessibilityRole="header">
              {t.search.episodes}
            </Text>
            <View style={st.list}>
              {episodes.map((item) => (
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

        {sounds.length ? (
          <View style={st.section}>
            <Text style={[typography.title, { color: c.textPrimary }]} accessibilityRole="header">
              {t.search.sounds}
            </Text>
            <View style={st.list}>
              {sounds.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => router.replace({ pathname: '/library', params: { kind: a.kind } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${a.name}, ${kindLabel(t, a.kind)}`}
                  style={({ pressed }) => [st.sound, pressed ? { opacity: pressedOpacity } : null]}
                >
                  <View style={[st.mat, { backgroundColor: c.surfaceHover }]}>
                    <Icon name="music" color={c.textSecondary} size={artwork.matIcon} />
                  </View>
                  <View style={st.soundText}>
                    <Text style={[typography.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>
                      {a.name}
                    </Text>
                    <Text style={[typography.caption, { color: c.textSecondary }]}>
                      {kindLabel(t, a.kind)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  // Home と同じ（見本 `.home` の上 6、まとまりの間 22。一覧は間 14、見出しの下 12）
  page: { marginTop: space.x6 - space.sm, gap: space.x22 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: hit.button,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
  },
  // 入力欄には lineHeight を渡さない（Android は字の上に積み、プレースホルダーが上に寄る。`Field` と同じ）。
  // 太字にもしない（プレースホルダーまで太くなる）。Android の EditText の既定の左右の余白も消す。
  input: {
    flex: 1,
    fontSize: typography.body.fontSize,
    fontWeight: typography.body.fontWeight,
    paddingVertical: space.x10,
    paddingHorizontal: 0,
  },
  section: { gap: space.md },
  list: { gap: space.x14 },
  sound: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  mat: {
    width: artwork.row,
    height: artwork.row,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soundText: { flex: 1, minWidth: 0, gap: space.hair + 1 },
});
