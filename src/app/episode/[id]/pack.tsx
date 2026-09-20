import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatAllMetadata } from '@/domain/metadata/template';
import { formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { useCopy } from '@/features/episode/useCopy';
import { useEpisode } from '@/features/episode/useEpisode';
import { listExports, type ExportRow } from '@/infra/db/repositories/exportsRepo';
import { joinRoot } from '@/infra/files/layout';
import { Button, Card, Eyebrow, Header, Loading, Screen, Toast } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

function formatBytes(b: number): string {
  const mb = b / 1048576;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

function CopyRow({
  label,
  value,
  active,
  onCopy,
}: {
  label: string;
  value: string;
  active: boolean;
  onCopy: () => void;
}) {
  const c = useAppTheme();
  return (
    <Card>
      <View style={st.labelRow}>
        <Eyebrow>{label}</Eyebrow>
        <Pressable
          onPress={onCopy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={active ? `${label} をコピーしました` : `${label} をコピー`}
        >
          <Text style={{ color: active ? c.voice : c.accent, fontSize: 13, fontWeight: '600' }}>
            {active ? '✓ コピーしました' : '⧉ コピー'}
          </Text>
        </Pressable>
      </View>
      <Text style={{ color: c.ink, lineHeight: 20 }} selectable>
        {value || '（未入力）'}
      </Text>
    </Card>
  );
}

/**
 * Distribution Pack（FR-EXP-6〜8）: 書き出しの終点を「配信管理画面へ貼れる状態」にする。
 * 音声ファイルの共有と、タイトル / 概要 / 全メタデータの個別コピー。
 */
export default function DistributionPackScreen() {
  const { id, exportId } = useLocalSearchParams<{ id: string; exportId?: string }>();
  const episodeId = id ?? '';
  const c = useAppTheme();
  const router = useRouter();
  const { db, root } = useServices();
  const { episode } = useEpisode(episodeId);
  const { copied, copy } = useCopy();
  const { toast, show: showToast, act } = useToast();
  const [row, setRow] = useState<ExportRow | null | undefined>(undefined);

  const load = useCallback(async () => {
    const all = await listExports(db, episodeId);
    const done = all.filter((e) => e.status === 'done');
    setRow((exportId ? done.find((e) => e.id === exportId) : done[0]) ?? null);
  }, [db, episodeId, exportId]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) void load();
    });
    return () => {
      alive = false;
    };
  }, [load]);

  if (!episode || row === undefined) return <Loading label="読み込んでいます" />;

  const fileName = `episode-${String(episode.episode_number).padStart(3, '0')}.${row?.format ?? 'm4a'}`;
  const durationLabel = formatSmp(smp(row?.duration_smp ?? 0));
  const allMeta = formatAllMetadata({
    title: episode.title,
    episodeNumber: episode.episode_number,
    season: episode.season,
    recordedAt: episode.recorded_at ? new Date(episode.recorded_at) : null,
    durationLabel,
    fileName,
    description: episode.description,
  });

  const share = async () => {
    if (!row?.path) return;
    if (!(await Sharing.isAvailableAsync())) {
      showToast({ text: 'この端末では共有できません' });
      return;
    }
    await Sharing.shareAsync(`file://${joinRoot(root, row.path)}`, {
      mimeType: row.format === 'wav' ? 'audio/wav' : 'audio/mp4',
      UTI: row.format === 'wav' ? 'com.microsoft.waveform-audio' : 'public.mpeg-4-audio',
      dialogTitle: fileName,
    });
  };

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} />}>
      <Header
        title="配信の準備ができました"
        subtitle={`#${episode.episode_number} ${episode.title}`}
        onBack={() => router.back()}
      />

      {row ? (
        <Card style={{ borderColor: c.accent }}>
          <View style={st.fileRow}>
            <Text style={{ color: c.accent, fontSize: 22 }}>♪</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.ink, fontWeight: '700' }}>{fileName}</Text>
              <Text style={{ color: c.ink2, fontSize: 12, marginTop: 2 }}>
                {formatBytes(row.bytes ?? 0)} · {durationLabel}
                {row.measured_lufs != null ? ` · ${row.measured_lufs.toFixed(1)} LUFS` : ''}
              </Text>
            </View>
          </View>
          <Button
            label="共有・ファイルに保存"
            onPress={() => void share()}
            style={{ marginTop: 12 }}
          />
          <Text style={{ color: c.ink3, fontSize: 11, marginTop: 8, lineHeight: 16 }}>
            共有シートから「ファイルに保存」や AirDrop、配信アプリへの送信ができます。
          </Text>
        </Card>
      ) : (
        <Card>
          <Text style={{ color: c.ink }}>書き出し済みの音声ファイルがありません。</Text>
          <Button
            label="書き出しへ"
            kind="secondary"
            style={{ marginTop: 12 }}
            onPress={() => router.push(`/episode/${episodeId}/export` as never)}
          />
        </Card>
      )}

      <CopyRow
        label="TITLE"
        value={episode.title}
        active={copied === 'title'}
        onCopy={() => void copy('title', episode.title)}
      />
      <CopyRow
        label="DESCRIPTION"
        value={episode.description}
        active={copied === 'desc'}
        onCopy={() => void copy('desc', episode.description)}
      />
      <CopyRow
        label="ALL METADATA"
        value={allMeta}
        active={copied === 'meta'}
        onCopy={() => void copy('meta', allMeta)}
      />

      <Button
        label={copied === 'all' ? '✓ コピーしました' : '⧉ すべてのメタデータをコピー'}
        kind="secondary"
        onPress={() => void copy('all', allMeta)}
      />
      <Button
        label="Home へ戻る"
        kind="ghost"
        style={{ marginTop: 10 }}
        onPress={() => router.dismissTo('/' as never)}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
