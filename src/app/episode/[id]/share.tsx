import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatAllMetadata } from '@/domain/metadata/template';
import { formatClock, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { formatBytes, loudnessText } from '@/features/episode/ExportTab';
import { shareExport } from '@/features/episode/shareExport';
import { useCopy } from '@/features/episode/useCopy';
import { useEpisode } from '@/features/episode/useEpisode';
import { errorText, formatDateTime, useLocale, useT } from '@/i18n';
import { listExports, type ExportRow } from '@/infra/db/repositories/exportsRepo';
import { fileExists } from '@/infra/files/fileSystem';
import { joinRoot } from '@/infra/files/layout';
import { exportLoudness } from '@/services/export/ExportService';
import { hitSlop, radius, space, stroke, tabularNums, typography } from '@/ui/tokens';
import { Button, Loading, Notice, Screen, Text, Toast } from '@/ui/components';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

/**
 * コピーの行（見本 `.field`）。上に小さい名前、下に値、右に丸い端の「コピー」。コピーできたら
 * アクセントの塗りの「コピー済み」になる（書き込みが成功してから。DESIGN_SYSTEM.md §8）。
 */
function CopyBlock({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const c = useAppTheme();
  const t = useT();
  return (
    <View style={[st.field, { borderBottomColor: c.border }]}>
      <View style={st.fieldText}>
        <Text style={[typography.fieldLabel, { color: c.textSecondary }]}>{label}</Text>
        <Text
          style={[typography.rowTitle, { color: value ? c.textPrimary : c.textTertiary }]}
          numberOfLines={2}
          selectable
        >
          {value || t.common.empty}
        </Text>
      </View>
      <Pressable
        onPress={onCopy}
        disabled={!value}
        accessibilityRole="button"
        accessibilityLabel={copied ? t.pack.a11yCopied(label) : t.pack.a11yCopy(label)}
        accessibilityState={{ disabled: !value }}
        hitSlop={hitSlop(typography.smallStrong.lineHeight + space.x6 * 2)}
        style={({ pressed }) => [
          st.copy,
          copied
            ? { backgroundColor: c.accentSolid, borderColor: c.accentSolid }
            : { borderColor: pressed ? c.textPrimary : c.borderStrong },
        ]}
      >
        <Text
          style={[
            typography.smallStrong,
            { color: !value ? c.textDisabled : copied ? c.accentOnSolid : c.textPrimary },
          ]}
        >
          {copied ? t.common.copied : t.common.copy}
        </Text>
      </Pressable>
    </View>
  );
}

export default function DistributionPackScreen() {
  const { id, exportId } = useLocalSearchParams<{ id: string; exportId?: string }>();
  const episodeId = id ?? '';
  const c = useAppTheme();
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { db, root, exporter } = useServices();
  const { episode } = useEpisode(episodeId);
  const { copied, copy } = useCopy();
  const { toast, show: showToast, act, dismiss } = useToast();
  const [row, setRow] = useState<ExportRow | null | undefined>(undefined);
  const [latestId, setLatestId] = useState<string | null>(null);
  const [exists, setExists] = useState(true);
  const [fileName, setFileName] = useState('');

  const load = useCallback(async () => {
    const all = await listExports(db, episodeId);
    const done = all.filter((e) => e.status === 'done');
    const r = (exportId ? done.find((e) => e.id === exportId) : done[0]) ?? null;
    // 共有で実際に付く名前と同じもの（Issue #166）
    setFileName(r ? ((await exporter.shareFileName(r.id)) ?? '') : '');
    setLatestId(done[0]?.id ?? null);
    setRow(r);
    setExists(r?.path ? fileExists(joinRoot(root, r.path)) : false);
  }, [db, episodeId, exportId, exporter, root]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) void load();
    });
    return () => {
      alive = false;
    };
  }, [load]);

  if (!episode || row === undefined) return <Loading label={t.common.loading} />;

  const durationLabel = formatClock(smp(row?.duration_smp ?? 0));
  const shortOfTarget = row ? (exportLoudness(row)?.shortOfTarget ?? null) : null;
  const allMeta = formatAllMetadata({
    title: episode.title,
    episodeNumber: episode.episode_number,
    season: episode.season,
    recordedAt: episode.recorded_at ? new Date(episode.recorded_at) : null,
    durationLabel,
    fileName,
    description: episode.description,
    labels: t.metadata,
  });

  const share = async () => {
    if (!row) return;
    try {
      const r = await shareExport(exporter, row.id);
      if (r === 'missing') setExists(false);
      else if (r === 'unavailable') showToast({ text: t.common.shareUnavailable });
    } catch (e) {
      showToast({ text: errorText(t, e) });
    }
  };

  const doCopy = (key: string, text: string) =>
    void copy(key, text).catch(() => showToast({ text: t.pack.copyFailed }));

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}>
      <ScreenHeader
        title={t.pack.title}
        subtitle={
          episode.title
            ? `${t.episode.number(episode.episode_number)} · ${episode.title}`
            : t.episode.number(episode.episode_number)
        }
      />

      <View style={st.top} />

      {row ? (
        <>
          {row.id !== latestId ? (
            <Notice
              title={t.pack.olderExport(
                formatDateTime(row.created_at, locale),
                row.format.toUpperCase(),
              )}
            />
          ) : null}

          {exists ? null : (
            <Notice
              kind="error"
              title={t.pack.missingFile}
              action={
                <Button
                  label={t.pack.toExport}
                  kind="secondary"
                  compact
                  onPress={() => router.back()}
                />
              }
            />
          )}

          <View style={[st.fileCard, { backgroundColor: c.surface }]}>
            <View style={st.file}>
              <Text style={[typography.bodyStrong, { color: c.textPrimary }]}>{fileName}</Text>
              <Text style={[typography.numeric, tabularNums, { color: c.textSecondary }]}>
                {[durationLabel, formatBytes(row.bytes ?? 0), loudnessText(t, row)]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            {shortOfTarget != null ? (
              <Text
                style={[typography.caption, { color: c.textSecondary, marginBottom: space.md }]}
              >
                {t.pack.belowTargetNote(shortOfTarget)}
              </Text>
            ) : null}
            <Button
              large
              label={t.pack.shareFile}
              icon="share"
              disabled={!exists}
              onPress={() => void share()}
            />
          </View>
        </>
      ) : (
        <Notice
          kind="info"
          title={t.pack.noExport}
          action={
            <Button
              label={t.pack.toExport}
              kind="secondary"
              compact
              onPress={() => router.back()}
            />
          }
        />
      )}

      <View>
        <Text
          style={[typography.subheading, st.fieldsHead, { color: c.textPrimary }]}
          accessibilityRole="header"
        >
          {t.pack.fieldsHeading}
        </Text>
        <CopyBlock
          label={t.pack.titleEyebrow}
          value={episode.title}
          copied={copied === 'title'}
          onCopy={() => doCopy('title', episode.title)}
        />
        <CopyBlock
          label={t.pack.descriptionEyebrow}
          value={episode.description}
          copied={copied === 'desc'}
          onCopy={() => doCopy('desc', episode.description)}
        />
        <CopyBlock
          label={t.pack.allMetadataEyebrow}
          value={allMeta}
          copied={copied === 'meta'}
          onCopy={() => doCopy('meta', allMeta)}
        />
      </View>

      <Button
        label={t.pack.backHome}
        kind="secondary"
        onPress={() => router.dismissTo('/' as never)}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  top: { height: space.sm },
  // 見本 `.checks` と同じ面（`surface`、角丸 8、内側 14）
  fileCard: { borderRadius: radius.sm, padding: space.x14, gap: space.md },
  file: { gap: space.xs },
  fieldsHead: { marginTop: space.x20, marginBottom: space.xs },
  // 見本 `.field`: 上下 10、間 12、下端に線。
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.x10,
    borderBottomWidth: stroke.hairline,
  },
  fieldText: { flex: 1, minWidth: 0, gap: space.hair },
  // 見本 `.copybtn`: 上下 6・左右 12、丸い端、1 の輪郭。
  copy: {
    paddingVertical: space.x6,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: stroke.hairline,
  },
});
