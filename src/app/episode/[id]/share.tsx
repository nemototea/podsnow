import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatAllMetadata } from '@/domain/metadata/template';
import { formatClock, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { formatBytes, loudnessText } from '@/features/episode/ExportTab';
import { shareExport } from '@/features/episode/shareExport';
import { useCopy } from '@/features/episode/useCopy';
import { useEpisode } from '@/features/episode/useEpisode';
import { errorText, useT } from '@/i18n';
import { listExports, type ExportRow } from '@/infra/db/repositories/exportsRepo';
import { fileExists } from '@/infra/files/fileSystem';
import { joinRoot } from '@/infra/files/layout';
import { exportLoudness } from '@/services/export/ExportService';
import { space, tabularNums, typography } from '@/ui/tokens';
import { Button, Card, Loading, Notice, Screen, Text, Toast } from '@/ui/components';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

function formatWhen(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

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
    <View style={[st.copyBlock, { borderBottomColor: c.border }]}>
      <View style={st.copyHead}>
        <Text style={[typography.label, { color: c.textSecondary, flex: 1 }]}>{label}</Text>
        <Button
          label={copied ? t.common.copied : t.common.copy}
          icon={copied ? 'check' : 'copy'}
          kind="secondary"
          compact
          disabled={!value}
          accessibilityLabel={copied ? t.pack.a11yCopied(label) : t.pack.a11yCopy(label)}
          onPress={onCopy}
        />
      </View>
      <Text style={[typography.body, { color: value ? c.textPrimary : c.textTertiary }]} selectable>
        {value || t.common.empty}
      </Text>
    </View>
  );
}

export default function DistributionPackScreen() {
  const { id, exportId } = useLocalSearchParams<{ id: string; exportId?: string }>();
  const episodeId = id ?? '';
  const c = useAppTheme();
  const t = useT();
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
        subtitle={`${t.episode.number(episode.episode_number)} · ${episode.title || t.episode.untitled}`}
      />

      <View style={st.top} />

      {row ? (
        <>
          {row.id !== latestId ? (
            <Notice
              title={t.pack.olderExport(formatWhen(row.created_at), row.format.toUpperCase())}
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

          <Card>
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
              label={t.pack.shareFile}
              icon="share"
              disabled={!exists}
              onPress={() => void share()}
            />
          </Card>
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

      <Card>
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
      </Card>

      <Button
        label={t.pack.backHome}
        kind="secondary"
        onPress={() => router.dismissTo('/' as never)}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  top: { height: space.lg },
  file: { gap: space.xs, marginBottom: space.lg },
  copyBlock: {
    gap: space.sm,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  copyHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
