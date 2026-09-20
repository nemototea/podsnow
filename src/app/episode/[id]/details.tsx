import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { insertTopics, renderTemplate } from '@/domain/metadata/template';
import { useServices } from '@/features/app/ServicesProvider';
import { useCopy } from '@/features/episode/useCopy';
import { useEpisode } from '@/features/episode/useEpisode';
import { getDefaultTemplate } from '@/infra/db/repositories/showsRepo';
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
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={active ? 'コピーしました' : 'コピー'}
    >
      <Text style={{ color: active ? c.voice : c.accent, fontSize: 13, fontWeight: '600' }}>
        {active ? '✓ コピーしました' : '⧉ コピー'}
      </Text>
    </Pressable>
  );
}

/** エピソードの詳細（FR-META-1〜4）。 */
export default function EpisodeDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const episodeId = id ?? '';
  const c = useAppTheme();
  const router = useRouter();
  const { db, show, episodes } = useServices();
  const { episode, reload } = useEpisode(episodeId);
  const { toast, show: showToast, act } = useToast();
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
      showToast({ text: '収録日は YYYY-MM-DD で入力してください' });
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
    title,
  ]);

  const insertTopicsIntoDescription = async () => {
    const rows = await db.all<{ text: string }>(
      'SELECT text FROM topics WHERE episode_id = ? ORDER BY position',
      [episodeId],
    );
    if (!rows.length) {
      showToast({ text: 'トークテーマがありません（Editor で追加できます）' });
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
      showToast({ text: '概要欄テンプレートがありません' });
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
      text: 'テンプレートを適用しました',
      action: '元に戻す',
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

  if (!episode || !hydrated) return <Loading label="読み込んでいます" />;

  const inputStyle = [st.input, { color: c.ink, backgroundColor: c.panel2, borderColor: c.line }];

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} />}>
      <Header
        title="エピソードの詳細"
        subtitle={`Episode #${episode.episode_number}`}
        onBack={() => {
          if (dirty) void save().then((ok) => ok && router.back());
          else router.back();
        }}
        right={
          <Pressable
            onPress={() => void copy('all', `${title}\n\n${description}`)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="すべてコピー"
          >
            <Text
              style={{
                color: copied === 'all' ? c.voice : c.accent,
                fontSize: 13,
                fontWeight: '600',
              }}
            >
              {copied === 'all' ? '✓ コピーしました' : 'すべてコピー'}
            </Text>
          </Pressable>
        }
      />

      {episode.description_suggestion ? (
        <Card style={{ borderColor: c.accent }}>
          <Eyebrow>AI の下書き候補</Eyebrow>
          <Text style={{ color: c.ink, lineHeight: 20 }}>{episode.description_suggestion}</Text>
          <View style={st.suggestRow}>
            <Button label="採用する" onPress={() => void adoptSuggestion()} style={{ flex: 1 }} />
            <Button
              label="破棄"
              kind="ghost"
              onPress={() => void discardSuggestion()}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : null}

      <Card>
        <View style={st.labelRow}>
          <Eyebrow>TITLE</Eyebrow>
          <CopyBtn active={copied === 'title'} onPress={() => void copy('title', title)} />
        </View>
        <TextInput
          value={title}
          onChangeText={mark(setTitle)}
          placeholder="タイトル"
          placeholderTextColor={c.ink3}
          style={inputStyle}
          accessibilityLabel="タイトル"
        />

        <View style={st.labelRow}>
          <Eyebrow>DESCRIPTION</Eyebrow>
          <CopyBtn active={copied === 'desc'} onPress={() => void copy('desc', description)} />
        </View>
        <TextInput
          value={description}
          onChangeText={mark(setDescription)}
          placeholder="概要"
          placeholderTextColor={c.ink3}
          multiline
          textAlignVertical="top"
          style={[inputStyle, { minHeight: 180 }]}
          accessibilityLabel="概要"
        />
        <View style={st.actionRow}>
          <Button
            label="トークテーマを差し込む"
            kind="secondary"
            onPress={() => void insertTopicsIntoDescription()}
            style={{ flex: 1 }}
          />
          <Button
            label="テンプレートを再適用"
            kind="ghost"
            onPress={() => void reapplyTemplate()}
            style={{ flex: 1 }}
          />
        </View>

        <View style={st.triple}>
          <View style={{ flex: 1 }}>
            <Eyebrow>EPISODE</Eyebrow>
            <TextInput
              value={episodeNumber}
              onChangeText={mark(setEpisodeNumber)}
              keyboardType="number-pad"
              style={inputStyle}
              accessibilityLabel="話数"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Eyebrow>SEASON</Eyebrow>
            <TextInput
              value={season}
              onChangeText={mark(setSeason)}
              keyboardType="number-pad"
              style={inputStyle}
              accessibilityLabel="シーズン"
            />
          </View>
          <View style={{ flex: 1.6 }}>
            <Eyebrow>RECORDED</Eyebrow>
            <TextInput
              value={recordedAt}
              onChangeText={mark(setRecordedAt)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={c.ink3}
              style={inputStyle}
              accessibilityLabel="収録日"
            />
          </View>
        </View>
      </Card>

      <Button label={dirty ? '保存' : '保存済み'} onPress={() => void save()} disabled={!dirty} />
      <Button
        label="次へ：音の仕上げ"
        kind="secondary"
        style={{ marginTop: 10 }}
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
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  labelRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  suggestRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  triple: { flexDirection: 'row', gap: 8 },
});
