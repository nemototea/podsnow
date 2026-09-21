import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { insertTopics, renderTemplate } from '@/domain/metadata/template';
import { useServices } from '@/features/app/ServicesProvider';
import { useCopy } from '@/features/episode/useCopy';
import { useEpisode } from '@/features/episode/useEpisode';
import { useT } from '@/i18n';
import { getDefaultTemplate } from '@/infra/db/repositories/showsRepo';
import { glyphSlop, hit, radius, space, typography } from '@/ui/tokens';
import { Button, Card, Eyebrow, Header, Loading, Screen, Toast } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

function toDateInput(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fromDateInput(s: string): number | null | undefined {
  const t = s.trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (!m) return undefined; // 不正
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
}

function CopyBtn({ active, onPress }: { active: boolean; onPress: () => void }) {
  const c = useAppTheme();
  const t = useT();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={glyphSlop}
      accessibilityRole="button"
      accessibilityLabel={active ? t.a11y.copied : t.a11y.copy}
    >
      <Text style={[typography.label, { color: active ? c.successText : c.accentText }]}>
        {active ? t.common.copied : t.common.copy}
      </Text>
    </Pressable>
  );
}

/** エピソードの詳細（FR-META-1〜4）。 */
export default function EpisodeDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const episodeId = id ?? '';
  const c = useAppTheme();
  const t = useT();
  const router = useRouter();
  const { db, show, episodes } = useServices();
  const { episode, reload } = useEpisode(episodeId);
  const { toast, show: showToast, act, dismiss } = useToast();
  const { copied, copy } = useCopy();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [season, setSeason] = useState('');
  const [recordedAt, setRecordedAt] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!episode || hydrated) return;
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      setTitle(episode.title);
      setDescription(episode.description);
      setEpisodeNumber(String(episode.episode_number));
      setSeason(String(episode.season));
      setRecordedAt(toDateInput(episode.recorded_at));
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [episode, hydrated]);

  const mark =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };

  const save = useCallback(async () => {
    const num = Number.parseInt(episodeNumber, 10);
    const sea = Number.parseInt(season, 10);
    const rec = fromDateInput(recordedAt);
    if (rec === undefined) {
      showToast({ text: t.details.badDate });
      return false;
    }
    await episodes.update(episodeId, {
      title: title.trim(),
      description,
      recordedAt: rec,
      ...(Number.isFinite(num) && num > 0 ? { episodeNumber: num } : {}),
      ...(Number.isFinite(sea) && sea > 0 ? { season: sea } : {}),
    });
    await reload();
    setDirty(false);
    return true;
  }, [
    description,
    episodeId,
    episodeNumber,
    episodes,
    recordedAt,
    reload,
    season,
    showToast,
    t,
    title,
  ]);

  const insertTopicsIntoDescription = async () => {
    const rows = await db.all<{ text: string }>(
      'SELECT text FROM topics WHERE episode_id = ? ORDER BY position',
      [episodeId],
    );
    if (!rows.length) {
      showToast({ text: t.details.noTopics });
      return;
    }
    setDescription((d) =>
      insertTopics(
        d,
        rows.map((r) => r.text),
      ),
    );
    setDirty(true);
  };

  const reapplyTemplate = async () => {
    const tpl = await getDefaultTemplate(db, show.id);
    if (!tpl) {
      showToast({ text: t.details.noTemplate });
      return;
    }
    const rows = await db.all<{ text: string }>(
      'SELECT text FROM topics WHERE episode_id = ? ORDER BY position',
      [episodeId],
    );
    const prev = description;
    setDescription(
      renderTemplate(tpl.body, {
        title: title.trim(),
        episodeNumber: Number.parseInt(episodeNumber, 10) || 0,
        season: Number.parseInt(season, 10) || 0,
        topics: rows.map((r) => r.text),
        showName: show.name,
      }),
    );
    setDirty(true);
    showToast({
      text: t.details.templateApplied,
      action: t.details.revert,
      onAction: () => setDescription(prev),
    });
  };

  const adoptSuggestion = async () => {
    if (!episode?.description_suggestion) return;
    setDescription(episode.description_suggestion);
    setDirty(true);
    await episodes.update(episodeId, { descriptionSuggestion: null });
    await reload();
  };
  const discardSuggestion = async () => {
    await episodes.update(episodeId, { descriptionSuggestion: null });
    await reload();
  };

  if (!episode || !hydrated) return <Loading label={t.common.loading} />;

  const inputStyle = [
    st.input,
    { color: c.textPrimary, backgroundColor: c.surfaceRaised, borderColor: c.border },
  ];

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}>
      <Header
        title={t.details.title}
        subtitle={t.episode.headerTitle(episode.episode_number)}
        onBack={() => {
          if (dirty) void save().then((ok) => ok && router.back());
          else router.back();
        }}
        right={
          <Pressable
            onPress={() => void copy('all', `${title}\n\n${description}`)}
            hitSlop={glyphSlop}
            accessibilityRole="button"
            accessibilityLabel={t.a11y.copyAll}
          >
            <Text
              style={[typography.label, { color: copied === 'all' ? c.successText : c.accentText }]}
            >
              {copied === 'all' ? t.common.copied : t.common.copyAll}
            </Text>
          </Pressable>
        }
      />

      {episode.description_suggestion ? (
        <Card style={{ borderColor: c.accentBorder }}>
          <Eyebrow>{t.details.suggestionEyebrow}</Eyebrow>
          <Text style={{ color: c.textPrimary, lineHeight: 20 }}>
            {episode.description_suggestion}
          </Text>
          <View style={st.suggestRow}>
            <Button
              label={t.details.adopt}
              onPress={() => void adoptSuggestion()}
              style={{ flex: 1 }}
            />
            <Button
              label={t.details.discard}
              kind="ghost"
              onPress={() => void discardSuggestion()}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : null}

      <Card>
        <View style={st.labelRow}>
          <Eyebrow>{t.details.titleEyebrow}</Eyebrow>
          <CopyBtn active={copied === 'title'} onPress={() => void copy('title', title)} />
        </View>
        <TextInput
          value={title}
          onChangeText={mark(setTitle)}
          placeholder={t.details.titlePlaceholder}
          placeholderTextColor={c.textTertiary}
          style={inputStyle}
          accessibilityLabel={t.details.titlePlaceholder}
        />

        <View style={st.labelRow}>
          <Eyebrow>{t.details.descriptionEyebrow}</Eyebrow>
          <CopyBtn active={copied === 'desc'} onPress={() => void copy('desc', description)} />
        </View>
        <TextInput
          value={description}
          onChangeText={mark(setDescription)}
          placeholder={t.details.descriptionPlaceholder}
          placeholderTextColor={c.textTertiary}
          multiline
          textAlignVertical="top"
          style={[inputStyle, { minHeight: 180 }]}
          accessibilityLabel={t.details.descriptionPlaceholder}
        />
        <View style={st.actionRow}>
          <Button
            label={t.details.insertTopics}
            kind="secondary"
            onPress={() => void insertTopicsIntoDescription()}
            style={{ flex: 1 }}
          />
          <Button
            label={t.details.reapplyTemplate}
            kind="ghost"
            onPress={() => void reapplyTemplate()}
            style={{ flex: 1 }}
          />
        </View>

        <View style={st.triple}>
          <View style={{ flex: 1 }}>
            <Eyebrow>{t.details.episodeEyebrow}</Eyebrow>
            <TextInput
              value={episodeNumber}
              onChangeText={mark(setEpisodeNumber)}
              keyboardType="number-pad"
              style={inputStyle}
              accessibilityLabel={t.metadata.episode}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Eyebrow>{t.details.seasonEyebrow}</Eyebrow>
            <TextInput
              value={season}
              onChangeText={mark(setSeason)}
              keyboardType="number-pad"
              style={inputStyle}
              accessibilityLabel={t.metadata.season}
            />
          </View>
          <View style={{ flex: 1.6 }}>
            <Eyebrow>{t.details.recordedEyebrow}</Eyebrow>
            <TextInput
              value={recordedAt}
              onChangeText={mark(setRecordedAt)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={c.textTertiary}
              style={inputStyle}
              accessibilityLabel={t.metadata.recordedAt}
            />
          </View>
        </View>
      </Card>

      <Button
        label={dirty ? t.common.save : t.common.saved}
        onPress={() => void save()}
        disabled={!dirty}
      />
      <Button
        label={t.details.nextSound}
        kind="secondary"
        style={{ marginTop: space.md }}
        onPress={() => {
          const next = () => router.push(`/episode/${episodeId}/sound` as never);
          if (dirty) void save().then((ok) => ok && next());
          else next();
        }}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  input: {
    ...typography.body,
    minHeight: hit.min,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  labelRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  actionRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  suggestRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  triple: { flexDirection: 'row', gap: space.sm },
});
