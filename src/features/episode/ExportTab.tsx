import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { insertTopics, renderTemplate } from '@/domain/metadata/template';
import { headings } from '@/domain/outline';
import { formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { errorText, storedErrorText, useT } from '@/i18n';
import { listExports, type ExportRow } from '@/infra/db/repositories/exportsRepo';
import { getDefaultTemplate } from '@/infra/db/repositories/showsRepo';
import { joinRoot } from '@/infra/files/layout';
import { parseSoundSettings, type SoundSettings } from '@/services/audio/renderDocumentFromDb';
import { estimateExportBytes, EXPORT_PRESETS } from '@/services/export/ExportService';
import { glyphSlop, hit, radius, space, typography } from '@/ui/tokens';
import { Button, Card, Chip, Eyebrow, Row, Toggle } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';

import type { Workspace } from './useWorkspace';

type PresetKey = keyof typeof EXPORT_PRESETS;
const PRESET_KEYS = Object.keys(EXPORT_PRESETS) as PresetKey[];

export function formatBytes(b: number): string {
  const mb = b / 1048576;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

function formatWhen(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toDateInput(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fromDateInput(s: string): number | null | undefined {
  const v = s.trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
}

export interface ExportTabProps {
  ws: Workspace;
  onShowToast: (text: string, undo?: () => void) => void;
  onDone: (exportId: string) => void;
}

/**
 * 書き出しタブ（docs/ux-restructure.md §7）。
 * 旧「詳細」「音の仕上げ」「書き出し」の 3 画面を 1 本のスクロールにまとめる。
 */
export function ExportTab({ ws, onShowToast, onDone }: ExportTabProps) {
  const c = useAppTheme();
  const t = useT();
  const { db, root, show, episodes, exporter, settings } = useServices();
  const { state } = ws;
  const episode = state.episode;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [season, setSeason] = useState('');
  const [recordedAt, setRecordedAt] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [sound, setSound] = useState<SoundSettings | null>(null);
  const [soundOpen, setSoundOpen] = useState(false);
  const [preset, setPreset] = useState<PresetKey>(settings.export.defaultPreset);
  const [history, setHistory] = useState<ExportRow[]>([]);
  const [job, setJob] = useState<{ exportId: string; progress: number; phase: string } | null>(
    null,
  );

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
      setSound(parseSoundSettings(episode.sound_settings));
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [episode, hydrated]);

  const reloadHistory = useCallback(async () => {
    setHistory(await listExports(db, ws.state.episode?.id ?? ''));
  }, [db, ws.state.episode?.id]);

  useEffect(() => {
    // 読み込みはマイクロタスクへ逃がす（useWorkspace と同じ理由。Issue #86）。
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) return reloadHistory();
    });
    return () => {
      alive = false;
    };
  }, [reloadHistory]);

  useEffect(() => {
    const subs = [
      exporter.on('progress', (e) =>
        setJob((j) =>
          j && j.exportId === e.exportId ? { ...j, progress: e.progress, phase: e.phase } : j,
        ),
      ),
      exporter.on('done', (e) => {
        setJob((j) => (j && j.exportId === e.exportId ? null : j));
        void reloadHistory();
        onDone(e.exportId);
      }),
      exporter.on('failed', (e) => {
        setJob((j) => (j && j.exportId === e.exportId ? null : j));
        void reloadHistory();
        onShowToast(e.cancelled ? t.export.cancelled : t.export.failed(e.message));
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [exporter, onDone, onShowToast, reloadHistory, t]);

  const mark =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };

  const save = useCallback(async () => {
    if (!episode) return false;
    const num = Number.parseInt(episodeNumber, 10);
    const sea = Number.parseInt(season, 10);
    const rec = fromDateInput(recordedAt);
    if (rec === undefined) {
      onShowToast(t.details.badDate);
      return false;
    }
    await episodes.update(episode.id, {
      title: title.trim(),
      description,
      recordedAt: rec,
      ...(Number.isFinite(num) && num > 0 ? { episodeNumber: num } : {}),
      ...(Number.isFinite(sea) && sea > 0 ? { season: sea } : {}),
    });
    await ws.reloadAll();
    setDirty(false);
    return true;
  }, [
    description,
    episode,
    episodeNumber,
    episodes,
    onShowToast,
    recordedAt,
    season,
    t,
    title,
    ws,
  ]);

  const updateSound = (next: SoundSettings) => {
    if (!episode) return;
    setSound(next);
    void episodes.update(episode.id, { soundSettings: JSON.stringify(next) });
  };

  const start = async () => {
    if (!episode) return;
    if (dirty && !(await save())) return;
    try {
      const exportId = await exporter.start(episode.id, EXPORT_PRESETS[preset]);
      setJob({ exportId, progress: 0, phase: 'measuring' });
    } catch (e) {
      onShowToast(errorText(t, e));
    }
  };

  const share = async (row: ExportRow) => {
    if (!row.path) return;
    if (!(await Sharing.isAvailableAsync())) {
      onShowToast(t.common.shareUnavailable);
      return;
    }
    await Sharing.shareAsync(`file://${joinRoot(root, row.path)}`, {
      mimeType: row.format === 'wav' ? 'audio/wav' : 'audio/mp4',
      UTI: row.format === 'wav' ? 'com.microsoft.waveform-audio' : 'public.mpeg-4-audio',
      dialogTitle: `episode-${String(episode?.episode_number ?? 0).padStart(3, '0')}.${row.format}`,
    });
  };

  if (!episode || !hydrated || !sound) return null;

  const inputStyle = [
    st.input,
    { color: c.textPrimary, backgroundColor: c.surfaceRaised, borderColor: c.border },
  ];
  const p = EXPORT_PRESETS[preset];
  const phaseLabel = job?.phase === 'measuring' ? t.export.phaseMeasuring : t.export.phaseRendering;
  const soundSummary = sound.loudness.enabled
    ? t.export.soundStandard(sound.loudness.targetLufs)
    : t.export.soundOff;

  return (
    <View>
      {/* 通して聴く */}
      <Card>
        <View style={st.kv}>
          <Text style={{ color: c.textSecondary }}>{t.export.duration}</Text>
          <Text style={[typography.bodyStrong, { color: c.textPrimary }]}>
            {formatSmp(state.total)}
          </Text>
        </View>
        <Button
          label={state.playing ? t.export.pausePreview : t.export.playPreview}
          kind="secondary"
          onPress={() => void ws.togglePlay()}
          disabled={state.total === 0}
        />
      </Card>

      {/* 音 */}
      <Eyebrow>{t.export.soundEyebrow}</Eyebrow>
      <Card>
        <Pressable
          onPress={() => setSoundOpen((v) => !v)}
          style={st.soundHead}
          accessibilityRole="button"
        >
          <Text style={[typography.body, { color: c.textPrimary, flex: 1 }]}>{soundSummary}</Text>
          <Text style={{ color: c.textSecondary }}>{soundOpen ? '▲' : '▼'}</Text>
        </Pressable>
        {soundOpen ? (
          <>
            <Row
              label={t.sound.loudness}
              sub={t.sound.loudnessSub}
              right={
                <Toggle
                  value={sound.loudness.enabled}
                  onChange={(v) =>
                    updateSound({ ...sound, loudness: { ...sound.loudness, enabled: v } })
                  }
                />
              }
            />
            {sound.loudness.enabled ? (
              <View style={st.chips}>
                {[-14, -16, -18].map((v) => (
                  <Chip
                    key={v}
                    label={`${v} LUFS${v === -16 ? t.sound.recommended : ''}`}
                    active={sound.loudness.targetLufs === v}
                    onPress={() =>
                      updateSound({ ...sound, loudness: { ...sound.loudness, targetLufs: v } })
                    }
                  />
                ))}
              </View>
            ) : null}
            <Row
              label={t.sound.ducking}
              sub={t.sound.duckingSub}
              right={
                <Toggle
                  value={sound.ducking.enabled}
                  onChange={(v) =>
                    updateSound({ ...sound, ducking: { ...sound.ducking, enabled: v } })
                  }
                />
              }
            />
          </>
        ) : null}
      </Card>

      {/* タイトルと概要 */}
      <Eyebrow>{t.export.infoEyebrow}</Eyebrow>
      <Card>
        <Eyebrow>{t.details.titleEyebrow}</Eyebrow>
        <TextInput
          value={title}
          onChangeText={mark(setTitle)}
          placeholder={t.details.titlePlaceholder}
          placeholderTextColor={c.textTertiary}
          style={inputStyle}
          accessibilityLabel={t.details.titlePlaceholder}
        />
        <Eyebrow>{t.details.descriptionEyebrow}</Eyebrow>
        <TextInput
          value={description}
          onChangeText={mark(setDescription)}
          placeholder={t.details.descriptionPlaceholder}
          placeholderTextColor={c.textTertiary}
          multiline
          textAlignVertical="top"
          style={[inputStyle, { minHeight: 160 }]}
          accessibilityLabel={t.details.descriptionPlaceholder}
        />
        <View style={st.actionRow}>
          <Button
            label={t.details.insertTopics}
            kind="secondary"
            style={{ flex: 1 }}
            onPress={() => {
              const list = headings(state.outline);
              if (!list.length) {
                onShowToast(t.details.noTopics);
                return;
              }
              setDescription((d) => insertTopics(d, list));
              setDirty(true);
            }}
          />
          <Button
            label={t.details.reapplyTemplate}
            kind="ghost"
            style={{ flex: 1 }}
            onPress={() => {
              void getDefaultTemplate(db, show.id).then((tpl) => {
                if (!tpl) {
                  onShowToast(t.details.noTemplate);
                  return;
                }
                const prev = description;
                setDescription(
                  renderTemplate(tpl.body, {
                    title: title.trim(),
                    episodeNumber: Number.parseInt(episodeNumber, 10) || 0,
                    season: Number.parseInt(season, 10) || 0,
                    topics: headings(state.outline),
                    showName: show.name,
                  }),
                );
                setDirty(true);
                onShowToast(t.details.templateApplied, () => setDescription(prev));
              });
            }}
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
        <Button
          label={dirty ? t.common.save : t.common.saved}
          kind="secondary"
          onPress={() => void save()}
          disabled={!dirty}
          style={{ marginTop: space.md }}
        />
      </Card>

      {/* 書き出す */}
      <Eyebrow>{t.export.formatEyebrow}</Eyebrow>
      <Card style={{ paddingVertical: space.xs }}>
        {PRESET_KEYS.map((k) => (
          <Row
            key={k}
            label={t.export.presets[k].label}
            sub={`${t.export.presets[k].sub} · ${t.export.presets[k].spec}`}
            onPress={() => setPreset(k)}
            right={
              <Chip
                label={preset === k ? t.common.selected : t.common.select}
                active={preset === k}
                onPress={() => setPreset(k)}
              />
            }
          />
        ))}
        <View style={st.kv}>
          <Text style={{ color: c.textSecondary }}>{t.export.estimatedSize}</Text>
          <Text style={[typography.bodyStrong, { color: c.textPrimary }]}>
            {formatBytes(estimateExportBytes(p, state.total))}
          </Text>
        </View>
      </Card>

      {job ? (
        <Card style={{ borderColor: c.accentBorder }}>
          <View style={st.kv}>
            <Text style={{ color: c.textPrimary }}>{phaseLabel}</Text>
            <Text style={{ color: c.textSecondary }}>{Math.round(job.progress * 100)}%</Text>
          </View>
          <View
            style={[st.bar, { backgroundColor: c.surfaceRaised }]}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(job.progress * 100) }}
          >
            <View
              style={[
                st.barFill,
                { width: `${Math.round(job.progress * 100)}%`, backgroundColor: c.accentSolid },
              ]}
            />
          </View>
          <Button
            label={t.common.cancelRun}
            kind="ghost"
            onPress={() => exporter.cancel(job.exportId)}
            style={{ marginTop: space.md }}
          />
        </Card>
      ) : (
        <Button label={t.export.run} onPress={() => void start()} disabled={state.total <= 0} />
      )}
      {state.total <= 0 ? (
        <Text style={[typography.caption, { color: c.textTertiary, marginTop: space.sm }]}>
          {t.export.emptyVoice}
        </Text>
      ) : null}

      <Eyebrow>{t.export.historyEyebrow}</Eyebrow>
      <Card style={{ paddingVertical: space.xs }}>
        {history.length === 0 ? (
          <Text style={{ color: c.textTertiary, paddingVertical: space.md }}>
            {t.export.noHistory}
          </Text>
        ) : null}
        {history.map((h) => (
          <Row
            key={h.id}
            label={`${formatWhen(h.created_at)} · ${h.format.toUpperCase()}`}
            sub={
              h.status === 'done'
                ? `${formatSmp(smp(h.duration_smp))} · ${formatBytes(h.bytes ?? 0)}${h.measured_lufs != null ? ` · ${h.measured_lufs.toFixed(1)} LUFS` : ''}`
                : h.status === 'failed'
                  ? t.export.historyFailed(storedErrorText(t, h.error))
                  : h.status === 'cancelled'
                    ? t.export.historyCancelled
                    : t.export.historyRunning(Math.round(h.progress * 100))
            }
            {...(h.status === 'done'
              ? {
                  onPress: () => onDone(h.id),
                  right: (
                    <Pressable
                      onPress={() => void share(h)}
                      hitSlop={glyphSlop}
                      accessibilityRole="button"
                      accessibilityLabel={t.common.share}
                    >
                      <Text style={[typography.label, { color: c.accentText }]}>
                        {t.common.share}
                      </Text>
                    </Pressable>
                  ),
                }
              : {})}
          />
        ))}
      </Card>
    </View>
  );
}

const st = StyleSheet.create({
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.xs },
  bar: { height: space.sm, borderRadius: radius.xs, overflow: 'hidden', marginTop: space.sm },
  barFill: { height: space.sm, borderRadius: radius.xs },
  soundHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: hit.min,
    paddingVertical: space.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm },
  input: {
    ...typography.body,
    minHeight: hit.min,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  actionRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  triple: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
});
