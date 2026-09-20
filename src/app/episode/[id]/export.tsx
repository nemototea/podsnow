import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { useEpisode, voiceDurationSmp } from '@/features/episode/useEpisode';
import { listExports, type ExportRow } from '@/infra/db/repositories/exportsRepo';
import { joinRoot } from '@/infra/files/layout';
import { estimateExportBytes, EXPORT_PRESETS } from '@/services/export/ExportService';
import { Button, Card, Chip, Eyebrow, Header, Loading, Row, Screen, Toast } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

type PresetKey = keyof typeof EXPORT_PRESETS;

const PRESET_INFO: Record<PresetKey, { label: string; sub: string; spec: string }> = {
  podcast: { label: 'Podcast', sub: 'おすすめ', spec: 'M4A · 128 kbps · モノラル' },
  high: { label: 'High Quality', sub: '音楽が多い回に', spec: 'M4A · 256 kbps · ステレオ' },
  wav: { label: 'WAV', sub: '別ツールで再編集する', spec: '48 kHz · 16 bit · 非圧縮' },
};

export function formatBytes(b: number): string {
  const mb = b / 1048576;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

function formatWhen(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 書き出し画面（FR-EXP-1, 3, 4, 5, 6）。 */
export default function ExportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const episodeId = id ?? '';
  const c = useAppTheme();
  const router = useRouter();
  const { db, root, exporter, settings } = useServices();
  const { episode } = useEpisode(episodeId);
  const { toast, show: showToast, act } = useToast();
  const [preset, setPreset] = useState<PresetKey>(settings.export.defaultPreset);
  const [durationSmp, setDurationSmp] = useState<number | null>(null);
  const [history, setHistory] = useState<ExportRow[]>([]);
  const [job, setJob] = useState<{ exportId: string; progress: number; phase: string } | null>(
    null,
  );

  const reload = useCallback(async () => {
    const [d, h] = await Promise.all([voiceDurationSmp(db, episodeId), listExports(db, episodeId)]);
    setDurationSmp(d);
    setHistory(h);
  }, [db, episodeId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    const subs = [
      exporter.on('progress', (e) =>
        setJob((j) =>
          j && j.exportId === e.exportId ? { ...j, progress: e.progress, phase: e.phase } : j,
        ),
      ),
      exporter.on('done', (e) => {
        setJob((j) => (j && j.exportId === e.exportId ? null : j));
        void reload();
        router.push(`/episode/${episodeId}/pack?exportId=${e.exportId}` as never);
      }),
      exporter.on('failed', (e) => {
        setJob((j) => (j && j.exportId === e.exportId ? null : j));
        void reload();
        showToast({
          text: e.cancelled ? '書き出しを中止しました' : `書き出しに失敗しました: ${e.message}`,
        });
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [episodeId, exporter, reload, router, showToast]);

  const start = async () => {
    try {
      const exportId = await exporter.start(episodeId, EXPORT_PRESETS[preset]);
      setJob({ exportId, progress: 0, phase: 'measuring' });
    } catch (e) {
      showToast({ text: e instanceof Error ? e.message : String(e) });
    }
  };

  const share = async (row: ExportRow) => {
    if (!row.path) return;
    if (!(await Sharing.isAvailableAsync())) {
      showToast({ text: 'この端末では共有できません' });
      return;
    }
    await Sharing.shareAsync(`file://${joinRoot(root, row.path)}`, {
      mimeType: row.format === 'wav' ? 'audio/wav' : 'audio/mp4',
      UTI: row.format === 'wav' ? 'com.microsoft.waveform-audio' : 'public.mpeg-4-audio',
      dialogTitle: `episode-${String(episode?.episode_number ?? 0).padStart(3, '0')}.${row.format}`,
    });
  };

  if (!episode || durationSmp === null) return <Loading label="読み込んでいます" />;

  const p = EXPORT_PRESETS[preset];
  const phaseLabel = job?.phase === 'measuring' ? '音量を測定中…' : '書き出し中…';

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} />}>
      <Header
        title="書き出し"
        subtitle={`Episode #${episode.episode_number}`}
        onBack={() => router.back()}
      />

      <Eyebrow>FORMAT / QUALITY</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        {(Object.keys(PRESET_INFO) as PresetKey[]).map((k) => (
          <Row
            key={k}
            label={PRESET_INFO[k].label}
            sub={`${PRESET_INFO[k].sub} · ${PRESET_INFO[k].spec}`}
            onPress={() => setPreset(k)}
            right={
              <Chip
                label={preset === k ? '選択中' : '選ぶ'}
                active={preset === k}
                onPress={() => setPreset(k)}
              />
            }
          />
        ))}
      </Card>

      <Card>
        <View style={st.kv}>
          <Text style={{ color: c.ink2 }}>推定サイズ</Text>
          <Text style={{ color: c.ink, fontWeight: '700' }}>
            {formatBytes(estimateExportBytes(p, durationSmp))}
          </Text>
        </View>
        <View style={st.kv}>
          <Text style={{ color: c.ink2 }}>長さ</Text>
          <Text style={{ color: c.ink, fontWeight: '700' }}>{formatSmp(smp(durationSmp))}</Text>
        </View>
      </Card>

      {job ? (
        <Card style={{ borderColor: c.accent }}>
          <View style={st.kv}>
            <Text style={{ color: c.ink }}>{phaseLabel}</Text>
            <Text style={{ color: c.ink2 }}>{Math.round(job.progress * 100)}%</Text>
          </View>
          <View
            style={[st.bar, { backgroundColor: c.panel2 }]}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(job.progress * 100) }}
          >
            <View
              style={[
                st.barFill,
                { width: `${Math.round(job.progress * 100)}%`, backgroundColor: c.accent },
              ]}
            />
          </View>
          <Button
            label="中止"
            kind="ghost"
            onPress={() => exporter.cancel(job.exportId)}
            style={{ marginTop: 12 }}
          />
        </Card>
      ) : (
        <Button label="書き出す" onPress={() => void start()} disabled={durationSmp <= 0} />
      )}
      {durationSmp <= 0 ? (
        <Text style={{ color: c.ink3, fontSize: 12, marginTop: 8 }}>
          声トラックが空です。先に録音してください。
        </Text>
      ) : null}

      <Eyebrow>EXPORT HISTORY</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        {history.length === 0 ? (
          <Text style={{ color: c.ink3, paddingVertical: 12 }}>まだ書き出しはありません</Text>
        ) : null}
        {history.map((h) => (
          <Row
            key={h.id}
            label={`${formatWhen(h.created_at)} · ${h.format.toUpperCase()}`}
            sub={
              h.status === 'done'
                ? `${formatSmp(smp(h.duration_smp))} · ${formatBytes(h.bytes ?? 0)}${h.measured_lufs != null ? ` · ${h.measured_lufs.toFixed(1)} LUFS` : ''}`
                : h.status === 'failed'
                  ? `失敗: ${h.error ?? ''}`
                  : h.status === 'cancelled'
                    ? '中止'
                    : `進行中 ${Math.round(h.progress * 100)}%`
            }
            {...(h.status === 'done'
              ? {
                  onPress: () =>
                    router.push(`/episode/${episodeId}/pack?exportId=${h.id}` as never),
                  right: (
                    <Pressable
                      onPress={() => void share(h)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="共有"
                    >
                      <Text style={{ color: c.accent, fontWeight: '600' }}>共有</Text>
                    </Pressable>
                  ),
                }
              : {})}
          />
        ))}
      </Card>
    </Screen>
  );
}

const st = StyleSheet.create({
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 8 },
  barFill: { height: 8, borderRadius: 4 },
});
