import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppError } from '@/domain/errors';
import type { DirectoryResult } from '@/domain/podcast/directory';
import { useServices } from '@/features/app/ServicesProvider';
import { errorText, useLocale, useT } from '@/i18n';
import { useDeviceRegion } from '@/i18n/deviceLocale';
import type { ImportPreview, ImportResult } from '@/services/podcast/PodcastImportService';
import { Artwork } from '@/ui/Artwork';
import { Button, Card, Field, Notice, Screen, SectionHeader, Text } from '@/ui/components';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { useAppTheme } from '@/ui/ThemeContext';
import { hit, space, typography } from '@/ui/tokens';

/** 一覧のアートワーク。行の高さ（hit.min）に収める */
const THUMB = hit.min;
const COVER = 160;

type Step =
  | { kind: 'search' }
  | { kind: 'loading' }
  | {
      kind: 'preview';
      preview: ImportPreview;
      nextNumber: number | null;
      saving: boolean;
      /** 前回の RSS からの読み込み直し（取り込みとは別の操作） */
      refresh: boolean;
    }
  | { kind: 'done'; result: ImportResult };

/**
 * 配信中の番組の取り込み（Issue #101、REQUIREMENTS.md FR-SHOW-6〜10）。
 * 番組名で探す / RSS の URL を入れる / 前回の RSS から読み込み直す → プレビュー → 取り込む。
 * 確定するまで DB には書かない（FR-SHOW-9）。通信はボタンを押したときだけ（NFR-2）。
 */
export default function ImportScreen() {
  const c = useAppTheme();
  const t = useT();
  const locale = useLocale();
  const region = useDeviceRegion();
  const router = useRouter();
  const services = useServices();
  const { podcastImport } = services;
  const showId = services.show.id;
  const previousFeed = services.show.feed_url;

  const [step, setStep] = useState<Step>({ kind: 'search' });
  const [term, setTerm] = useState('');
  const [url, setUrl] = useState('');
  const [results, setResults] = useState<DirectoryResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const country = region ?? (locale === 'ja' ? 'JP' : 'US');

  const search = async () => {
    if (!term.trim() || searching) return;
    setError(null);
    setSearching(true);
    try {
      setResults(await podcastImport.search(term, country));
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setSearching(false);
    }
  };

  const load = async (source: { directory: DirectoryResult } | { feedUrl: string } | 'refresh') => {
    setError(null);
    setStep({ kind: 'loading' });
    try {
      const refresh = source === 'refresh';
      const preview = refresh
        ? await podcastImport.previewRefresh(showId)
        : await podcastImport.preview(showId, source);
      const nextNumber = await podcastImport.nextEpisodeNumberAfter(showId, preview);
      setStep({ kind: 'preview', preview, nextNumber, saving: false, refresh });
    } catch (e) {
      setError(errorText(t, e));
      setStep({ kind: 'search' });
    }
  };

  const confirm = async (s: Extract<Step, { kind: 'preview' }>) => {
    setError(null);
    setStep({ ...s, saving: true });
    try {
      const result = await podcastImport.commit(showId, s.preview);
      await services.reloadShow();
      if (!services.settings.onboardingDone) await services.updateSettings('onboardingDone', true);
      setStep({ kind: 'done', result });
    } catch (e) {
      setError(errorText(t, e));
      setStep({ ...s, saving: false });
    }
  };

  const errorNotice = error ? (
    <Notice kind="error" title={t.podcastImport.failed} body={error} />
  ) : null;

  if (step.kind === 'loading') {
    return (
      <Screen>
        <ScreenHeader title={t.podcastImport.title} />
        <Card>
          <Button label={t.podcastImport.loading} busy onPress={() => {}} kind="secondary" />
        </Card>
      </Screen>
    );
  }

  if (step.kind === 'preview') {
    const { show, items } = step.preview.feed;
    // 追加済み（同じ番組）なら取り込みはここで終わる。別の番組は取り込めない（docs/podcast-import-cases.md B-1 / Q2 / Q3）
    const blocked = step.refresh
      ? null
      : step.preview.identity === 'same'
        ? {
            kind: 'info' as const,
            title: t.podcastImport.alreadyAdded,
            body: t.podcastImport.alreadyAddedBody,
          }
        : step.preview.identity === 'different'
          ? {
              kind: 'error' as const,
              title: t.podcastImport.failed,
              body: errorText(t, new AppError('import_other_show')),
            }
          : null;
    return (
      <Screen>
        <ScreenHeader title={t.podcastImport.title} />
        <SectionHeader
          title={step.refresh ? t.podcastImport.refreshHeader : t.podcastImport.previewHeader}
        />
        <Card>
          <View style={st.previewTop}>
            <Artwork
              uri={show.imageUrl}
              size={COVER}
              label={t.podcastImport.a11yArtwork(show.title)}
            />
            <Text
              style={[typography.heading, st.center, { color: c.textPrimary }]}
              accessibilityRole="header"
            >
              {show.title}
            </Text>
            {show.author ? (
              <Text style={[typography.caption, st.center, { color: c.textSecondary }]}>
                {show.author}
              </Text>
            ) : null}
          </View>
          {show.description ? (
            <Text style={[typography.body, { color: c.textSecondary }]} numberOfLines={8}>
              {show.description}
            </Text>
          ) : null}
          <View style={st.meta}>
            <Text style={[typography.bodyStrong, { color: c.textPrimary }]}>
              {t.podcastImport.episodesCount(items.length)}
            </Text>
            <Text style={[typography.caption, { color: c.textSecondary }]}>
              {step.nextNumber !== null
                ? t.podcastImport.nextNumber(step.nextNumber)
                : t.podcastImport.noEpisodeNumbers}
            </Text>
          </View>
        </Card>
        {blocked ? (
          <Notice kind={blocked.kind} title={blocked.title} body={blocked.body} />
        ) : (
          <Notice kind="info" title={t.podcastImport.overwriteNote} />
        )}
        {errorNotice}
        <View style={st.actions}>
          {blocked ? null : (
            <Button
              label={
                step.saving
                  ? t.podcastImport.importing
                  : step.refresh
                    ? t.podcastImport.reload
                    : t.podcastImport.confirm
              }
              busy={step.saving}
              onPress={() => void confirm(step)}
            />
          )}
          <Button
            label={t.podcastImport.back}
            kind="ghost"
            disabled={step.saving}
            onPress={() => setStep({ kind: 'search' })}
          />
        </View>
      </Screen>
    );
  }

  if (step.kind === 'done') {
    return (
      <Screen>
        <ScreenHeader title={t.podcastImport.title} />
        <Notice
          kind="success"
          title={t.podcastImport.doneTitle}
          body={t.podcastImport.doneBody(step.result.episodes)}
        />
        {step.result.coverSaved ? null : (
          <Notice kind="warning" title={t.podcastImport.coverFailed} />
        )}
        <View style={st.actions}>
          <Button label={t.podcastImport.toHome} onPress={() => router.dismissTo('/')} />
          <Button
            label={t.podcastImport.toShow}
            kind="secondary"
            onPress={() => router.dismissTo('/show')}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t.podcastImport.title} />

      {previousFeed ? (
        <>
          <SectionHeader title={t.podcastImport.reloadHeader} />
          <Card>
            <Text style={[typography.body, st.gapBelow, { color: c.textSecondary }]}>
              {t.podcastImport.reloadBody(previousFeed)}
            </Text>
            <Button
              label={t.podcastImport.reload}
              icon="refresh"
              kind="secondary"
              onPress={() => void load('refresh')}
            />
          </Card>
        </>
      ) : null}

      {errorNotice}

      <Card>
        <Field
          label={t.podcastImport.searchLabel}
          value={term}
          onChangeText={setTerm}
          placeholder={t.podcastImport.searchPlaceholder}
          returnKeyType="search"
          autoCorrect={false}
          onSubmitEditing={() => void search()}
        />
        <Button
          label={searching ? t.podcastImport.searching : t.podcastImport.search}
          busy={searching}
          disabled={!term.trim()}
          onPress={() => void search()}
        />
      </Card>

      {results !== null ? (
        <>
          <SectionHeader title={t.podcastImport.resultsHeader} />
          {results.length === 0 ? (
            <Notice kind="info" title={t.podcastImport.noResults} />
          ) : (
            <Card style={st.list}>
              {results.map((r, i) => (
                <ResultRow
                  key={`${r.provider}:${r.externalId}`}
                  result={r}
                  last={i === results.length - 1}
                  noFeedLabel={t.podcastImport.noFeed}
                  onPress={() => void load({ directory: r })}
                />
              ))}
            </Card>
          )}
        </>
      ) : null}

      <SectionHeader title={t.podcastImport.urlHeader} />
      <Card>
        <Field
          label={t.podcastImport.urlLabel}
          help={t.podcastImport.urlHelp}
          value={url}
          onChangeText={setUrl}
          placeholder="https://"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => url.trim() && void load({ feedUrl: url })}
        />
        <Button
          label={t.podcastImport.loadUrl}
          kind="secondary"
          disabled={!url.trim()}
          onPress={() => void load({ feedUrl: url })}
        />
      </Card>
    </Screen>
  );
}

function ResultRow({
  result,
  last,
  noFeedLabel,
  onPress,
}: {
  result: DirectoryResult;
  last: boolean;
  noFeedLabel: string;
  onPress: () => void;
}) {
  const c = useAppTheme();
  const disabled = !result.feedUrl;
  const sub = disabled ? noFeedLabel : result.author;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${result.title}, ${sub}` : result.title}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        st.row,
        !last ? { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth } : null,
        { backgroundColor: pressed ? c.surfaceHover : 'transparent' },
      ]}
    >
      <Artwork uri={result.artworkUrl} size={THUMB} />
      <View style={st.flex}>
        <Text
          style={[typography.body, { color: disabled ? c.textDisabled : c.textPrimary }]}
          numberOfLines={2}
        >
          {result.title}
        </Text>
        {sub ? (
          <Text style={[typography.caption, { color: c.textSecondary }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1, gap: space.hair },
  center: { textAlign: 'center' },
  gapBelow: { marginBottom: space.md },
  list: { paddingVertical: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    minHeight: hit.min,
  },
  previewTop: { alignItems: 'center', gap: space.sm, marginBottom: space.lg },
  meta: { gap: space.xs, marginTop: space.lg },
  actions: { gap: space.sm, marginTop: space.lg },
});
