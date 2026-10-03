import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import { insertTopics, renderTemplate } from '@/domain/metadata/template';
import { headings } from '@/domain/outline';
import { formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { errorText, formatDateTime, storedErrorText, useLocale, useT, type Messages } from '@/i18n';
import { isExportRunning, listExports, type ExportRow } from '@/infra/db/repositories/exportsRepo';
import { getDefaultTemplate } from '@/infra/db/repositories/showsRepo';
import { parseSoundSettings, type SoundSettings } from '@/services/audio/renderDocumentFromDb';
import {
  CUSTOM_BITRATES,
  estimateExportBytes,
  EXPORT_PRESETS,
  episodeExportPreset,
  exportLoudness,
  normalizeCustomExport,
  resolveExportPreset,
  type CustomExportSettings,
  type ExportPreset,
  type ExportPresetKey,
} from '@/services/export/ExportService';
import { hit, radius, space, stroke, tabularNums, typography } from '@/ui/tokens';
import {
  Button,
  Card,
  Chip,
  Field,
  IconButton,
  InfoButton,
  Loading,
  Notice,
  ProgressBar,
  Row,
  SectionHeader,
  Segmented,
  Text,
  Toggle,
  type TermInfo,
} from '@/ui/components';
import { confirmDestructive } from '@/ui/alerts';
import { DateField } from '@/ui/DateField';
import { EpisodePlayer } from '@/ui/EpisodePlayer';
import { useAppTheme } from '@/ui/ThemeContext';

import {
  applyDetailsPatch,
  detailsPatch,
  draftFromEpisode,
  fromDateInput,
  type DetailsDraft,
} from './detailsDraft';
import { shareExport } from './shareExport';
import type { Workspace } from './useWorkspace';

const PRESET_KEYS: readonly ExportPresetKey[] = [
  ...(Object.keys(EXPORT_PRESETS) as (keyof typeof EXPORT_PRESETS)[]),
  'custom',
];

/** 書き出したファイルの音量の表示（例: 「-16.0 LUFS」）。出せる値が無ければ null。 */
export function loudnessText(t: Messages, row: ExportRow): string | null {
  const l = exportLoudness(row);
  if (!l) return null;
  const v = l.lufs.toFixed(1);
  return l.shortOfTarget != null ? t.export.lufsBelowTarget(v, l.shortOfTarget) : t.export.lufs(v);
}

export function formatBytes(b: number): string {
  const mb = b / 1048576;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

function Stepper({
  label,
  value,
  unit,
  step,
  min,
  max,
  onChange,
  info,
}: {
  label: string;
  /** ラベルが専門用語のとき（Issue #170）。 */
  info?: TermInfo;
  value: number;
  unit: string;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const c = useAppTheme();
  const t = useT();
  return (
    <View style={[st.stepper, { borderBottomColor: c.border }]}>
      <View style={st.stepLabel}>
        <Text style={[typography.body, st.stepLabelText, { color: c.textPrimary }]}>{label}</Text>
        {info ? <InfoButton info={info} /> : null}
      </View>
      <IconButton
        name="minus"
        label={t.a11y.decrease(label)}
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, +(value - step).toFixed(2)))}
      />
      <Text style={[typography.numeric, tabularNums, st.stepVal, { color: c.textPrimary }]}>
        {/* 刻みが小数なら -1.0 / -1.5 のように桁を揃え、押すたびに字数が変わらないようにする */}
        {value.toFixed(Number.isInteger(step) && Number.isInteger(value) ? 0 : 1)} {unit}
      </Text>
      <IconButton
        name="plus"
        label={t.a11y.increase(label)}
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, +(value + step).toFixed(2)))}
      />
    </View>
  );
}

export interface ExportTabProps {
  ws: Workspace;
  onShowToast: (text: string, undo?: () => void) => void;
  onDone: (exportId: string) => void;
  onGoEdit: () => void;
}

/**
 * 書き出しタブ（docs/ux-restructure.md §7）。
 * 旧「詳細」「音の仕上げ」「書き出し」の 3 画面を 1 本のスクロールにまとめる。
 */
export function ExportTab({ ws, onShowToast, onDone, onGoEdit }: ExportTabProps) {
  const c = useAppTheme();
  const t = useT();
  const locale = useLocale();
  const { db, show, coverArt, episodes, exporter, playback, settings, updateSettings, haptics } =
    useServices();
  const { state } = ws;
  const episode = state.episode;

  // 詳細は入力をやめたとき（blur・タブ切替・画面を離れる・アプリを裏へ回す）に自動で保存する（Issue #167）。
  // 入力中の値は ref にも持ち、離れる瞬間の保存でも最新の値を書く。
  const [draft, setDraft] = useState<DetailsDraft | null>(null);
  const draftRef = useRef<DetailsDraft | null>(null);
  const savedRef = useRef<(Parameters<typeof detailsPatch>[1] & { id: string }) | null>(null);
  const flushRef = useRef<(reload: boolean) => Promise<void>>(async () => undefined);
  const [sound, setSound] = useState<SoundSettings | null>(null);
  const [soundAdvanced, setSoundAdvanced] = useState(false);
  // その回で最後に選んだもの → なければ設定の既定（DATA_MODEL.md §4.5.1）。
  // 選んだ直後は DB の保存を待たずに表示を切り替える。
  const [picked, setPicked] = useState<ExportPresetKey | null>(null);
  const preset =
    picked ?? episodeExportPreset(episode?.export_preset, settings.export.defaultPreset);
  const [custom, setCustom] = useState<CustomExportSettings>(() =>
    normalizeCustomExport(settings.export.custom),
  );
  const [history, setHistory] = useState<ExportRow[]>([]);
  const [job, setJob] = useState<{ exportId: string; progress: number; phase: string } | null>(
    null,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [takenNumbers, setTakenNumbers] = useState<number[]>([]);

  useEffect(() => {
    let alive = true;
    void episodes.list(show.id).then((l) => {
      if (alive)
        setTakenNumbers(l.filter((e) => e.id !== episode?.id).map((e) => e.episode_number));
    });
    return () => {
      alive = false;
    };
  }, [episode?.id, episodes, show.id]);
  const [undoDescription, setUndoDescription] = useState<(() => void) | null>(null);

  const hydrated = draft !== null;
  useEffect(() => {
    if (!episode || hydrated) return;
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      const next = draftFromEpisode(episode);
      draftRef.current = next;
      savedRef.current = {
        id: episode.id,
        title: episode.title,
        description: episode.description,
        episode_number: episode.episode_number,
        season: episode.season,
        recorded_at: episode.recorded_at,
      };
      setDraft(next);
      setSound(parseSoundSettings(episode.sound_settings));
    });
    return () => {
      alive = false;
    };
  }, [episode, hydrated]);

  useEffect(() => {
    flushRef.current = async (reload: boolean) => {
      const d = draftRef.current;
      const saved = savedRef.current;
      if (!d || !saved) return;
      const patch = detailsPatch(d, saved);
      if (!patch) return;
      savedRef.current = applyDetailsPatch(saved, patch);
      try {
        await episodes.update(saved.id, patch);
      } catch (e) {
        savedRef.current = saved;
        onShowToast(errorText(t, e));
        return;
      }
      if (reload) await ws.reloadAll();
    };
  });
  /** 変わった項目だけを保存する。何も変わっていなければ何もしない。 */
  const flush = useCallback(() => flushRef.current(true), []);
  useEffect(() => {
    // タブを切り替える・画面を離れるとき（アンマウント）と、アプリを裏へ回したときにも保存する
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') void flushRef.current(false);
    });
    return () => {
      sub.remove();
      void flushRef.current(false);
    };
  }, []);
  const edit = (patch: Partial<DetailsDraft>) => {
    if (!draftRef.current) return;
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
  };

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
        haptics.play('success');
        onDone(e.exportId);
      }),
      exporter.on('failed', (e) => {
        setJob((j) => (j && j.exportId === e.exportId ? null : j));
        void reloadHistory();
        if (e.cancelled) onShowToast(t.export.cancelled);
        else setFailure(e.message);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [exporter, haptics, onDone, onShowToast, reloadHistory, t]);

  /** カスタムの項目は次回も使えるよう設定に残す（既定プリセットは変えない）。 */
  const updateCustom = (patch: Partial<CustomExportSettings>) => {
    const next = { ...custom, ...patch };
    setCustom(next);
    void updateSettings('export', { ...settings.export, custom: next });
  };

  const choosePreset = (k: ExportPresetKey) => {
    setPicked(k);
    void ws.updateExportPreset(k);
  };

  const updateSound = (next: SoundSettings) => {
    if (!episode || !sound) return;
    setSound(next);
    void ws.updateSound(sound, next);
  };

  const start = async () => {
    if (!episode) return;
    await flush();
    setFailure(null);
    try {
      const exportId = await exporter.start(episode.id, resolveExportPreset(preset, custom));
      setJob({ exportId, progress: 0, phase: 'measuring' });
    } catch (e) {
      setFailure(errorText(t, e));
    }
  };

  const share = async (row: ExportRow) => {
    try {
      const r = await shareExport(exporter, row.id);
      if (r === 'unavailable') onShowToast(t.common.shareUnavailable);
      else if (r === 'missing') onShowToast(t.pack.missingFile);
    } catch (e) {
      onShowToast(errorText(t, e));
    }
  };

  /** 書き出しを履歴ごと消す（Issue #152）。消すと聴けなくなる回は、確認の文言で伝える。 */
  const removeExport = async (row: ExportRow) => {
    const impact = await exporter.removalImpact(row.id);
    confirmDestructive({
      title: t.export.deleteExport,
      message: impact.lastListenable
        ? t.export.deleteExportLastListenable
        : t.export.deleteExportMessage,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      onConfirm: () =>
        void (async () => {
          try {
            await playback.forgetExport(row.id);
            await exporter.remove(row.id);
            onShowToast(t.export.exportDeleted);
          } catch (e) {
            onShowToast(errorText(t, e));
          }
          await reloadHistory();
        })(),
    });
  };

  if (!episode || !draft || !sound) return <Loading label={t.common.loading} />;

  const p = resolveExportPreset(preset, custom);
  const presetText = (k: ExportPresetKey) =>
    k === 'custom'
      ? { ...t.export.presets.custom, spec: specText(resolveExportPreset('custom', custom)) }
      : t.export.presets[k];
  function specText(x: ExportPreset): string {
    const ch = x.channels === 1 ? t.export.custom.mono : t.export.custom.stereo;
    return x.format === 'wav'
      ? t.export.specWav(ch)
      : t.export.specM4a(Math.round(x.bitrate / 1000), ch);
  }

  const phaseLabel = job?.phase === 'measuring' ? t.export.phaseMeasuring : t.export.phaseRendering;
  const hasBgm = state.doc.overlays.some((o) => o.kind === 'bgm');
  const num = Number.parseInt(draft.episodeNumber, 10);
  const numberTaken = Number.isFinite(num) && takenNumbers.includes(num);
  const badDate = fromDateInput(draft.recordedAt) === undefined;

  return (
    <View>
      <Card>
        <EpisodePlayer
          medium="tape"
          artworkUri={coverArt.uri(show.cover_path)}
          title={episode.title}
          episodeNumber={episode.episode_number}
          position={state.playhead}
          duration={state.total}
          playing={state.playing}
          onToggle={() => void ws.togglePlay()}
          onSeek={(to) => void ws.seek(to)}
        />
      </Card>

      <SectionHeader title={t.sound.title} />
      <Card style={st.listCard}>
        <Row
          label={t.sound.loudness}
          info={t.glossary.loudness}
          {...(sound.loudness.enabled
            ? {
                sub: t.sound.loudnessTarget(sound.loudness.targetLufs, sound.loudness.truePeakDbtp),
              }
            : {})}
          right={
            <Toggle
              accessibilityLabel={t.sound.loudness}
              value={sound.loudness.enabled}
              onChange={(v) =>
                updateSound({ ...sound, loudness: { ...sound.loudness, enabled: v } })
              }
            />
          }
        />
        <Row
          label={t.sound.ducking}
          info={t.glossary.ducking}
          {...(hasBgm && sound.ducking.enabled ? { sub: `${sound.ducking.depthDb} dB` } : {})}
          last={!soundAdvanced}
          right={
            <Toggle
              accessibilityLabel={t.sound.ducking}
              value={sound.ducking.enabled && hasBgm}
              disabled={!hasBgm}
              onChange={(v) => {
                if (!hasBgm) return;
                updateSound({ ...sound, ducking: { ...sound.ducking, enabled: v } });
              }}
            />
          }
        />
        {!hasBgm ? (
          <Button label={t.sound.addBgm} kind="ghost" icon="music" compact onPress={onGoEdit} />
        ) : null}
        <Button
          label={soundAdvanced ? t.sound.hideAdvanced : t.sound.advanced}
          kind="ghost"
          icon={soundAdvanced ? 'chevronUp' : 'chevron'}
          compact
          accessibilityLabel={t.sound.a11yAdvanced}
          onPress={() => setSoundAdvanced((v) => !v)}
        />
        {soundAdvanced ? (
          <>
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
            {sound.loudness.enabled ? (
              <Stepper
                label={t.sound.truePeak}
                info={t.glossary.truePeak}
                value={sound.loudness.truePeakDbtp}
                unit="dBTP"
                step={0.5}
                min={-3}
                max={0}
                onChange={(v) =>
                  updateSound({ ...sound, loudness: { ...sound.loudness, truePeakDbtp: v } })
                }
              />
            ) : null}
            <Stepper
              label={t.sound.depth}
              value={sound.ducking.depthDb}
              unit="dB"
              step={1}
              min={-30}
              max={0}
              onChange={(v) => updateSound({ ...sound, ducking: { ...sound.ducking, depthDb: v } })}
            />
            <Stepper
              label={t.sound.attack}
              value={sound.ducking.attackMs}
              unit="ms"
              step={10}
              min={0}
              max={500}
              onChange={(v) =>
                updateSound({ ...sound, ducking: { ...sound.ducking, attackMs: v } })
              }
            />
            <Stepper
              label={t.sound.release}
              value={sound.ducking.releaseMs}
              unit="ms"
              step={50}
              min={0}
              max={3000}
              onChange={(v) =>
                updateSound({ ...sound, ducking: { ...sound.ducking, releaseMs: v } })
              }
            />
            <Stepper
              label={t.sound.threshold}
              value={sound.ducking.thresholdDb}
              unit="dBFS"
              step={2}
              min={-70}
              max={-10}
              onChange={(v) =>
                updateSound({ ...sound, ducking: { ...sound.ducking, thresholdDb: v } })
              }
            />
          </>
        ) : null}
      </Card>

      <SectionHeader title={t.details.title} />
      {episode.description_suggestion ? (
        <Notice
          title={t.details.suggestionEyebrow}
          body={episode.description_suggestion}
          action={
            <View style={st.actionRow}>
              <Button
                label={t.details.adopt}
                kind="secondary"
                compact
                onPress={() => {
                  edit({ description: episode.description_suggestion ?? '' });
                  void flush();
                  void episodes
                    .update(episode.id, { descriptionSuggestion: null })
                    .then(() => ws.reloadAll());
                }}
              />
              <Button
                label={t.details.discard}
                kind="ghost"
                compact
                onPress={() => {
                  void episodes
                    .update(episode.id, { descriptionSuggestion: null })
                    .then(() => ws.reloadAll());
                }}
              />
            </View>
          }
        />
      ) : null}
      <Card>
        <Field
          label={t.details.titleEyebrow}
          value={draft.title}
          onChangeText={(v) => edit({ title: v })}
          onBlur={() => void flush()}
          placeholder={t.details.titlePlaceholder}
        />
        <View style={st.pair}>
          <View style={st.flex}>
            <Field
              label={t.details.episodeEyebrow}
              value={draft.episodeNumber}
              onChangeText={(v) => edit({ episodeNumber: v })}
              onBlur={() => void flush()}
              keyboardType="number-pad"
              {...(numberTaken ? { error: t.details.numberTaken } : {})}
            />
          </View>
          <View style={st.flex}>
            <Field
              label={t.details.seasonEyebrow}
              value={draft.season}
              onChangeText={(v) => edit({ season: v })}
              onBlur={() => void flush()}
              keyboardType="number-pad"
            />
          </View>
        </View>
        <Field
          label={t.details.descriptionEyebrow}
          value={draft.description}
          onChangeText={(v) => edit({ description: v })}
          onBlur={() => void flush()}
          placeholder={t.details.descriptionPlaceholder}
          multiline
        />
        <View style={st.actionRow}>
          <Button
            label={t.details.insertTopics}
            kind="secondary"
            compact
            onPress={() => {
              const list = headings(state.outline);
              if (!list.length) {
                onShowToast(t.details.noTopics);
                return;
              }
              edit({ description: insertTopics(draft.description, list) });
              void flush();
            }}
          />
          <Button
            label={t.details.reapplyTemplate}
            kind="ghost"
            compact
            onPress={() => {
              void getDefaultTemplate(db, show.id).then((tpl) => {
                if (!tpl) {
                  onShowToast(t.details.noTemplate);
                  return;
                }
                const cur = draftRef.current;
                if (!cur) return;
                const prev = cur.description;
                edit({
                  description: renderTemplate(tpl.body, {
                    title: cur.title.trim(),
                    episodeNumber: Number.parseInt(cur.episodeNumber, 10) || 0,
                    season: Number.parseInt(cur.season, 10) || 0,
                    topics: headings(state.outline),
                    showName: show.name,
                  }),
                });
                void flush();
                onShowToast(t.details.templateApplied);
                setUndoDescription(() => () => {
                  edit({ description: prev });
                  void flush();
                });
              });
            }}
          />
        </View>
        {undoDescription ? (
          <Button
            label={t.details.undoTemplate}
            kind="ghost"
            compact
            icon="undo"
            onPress={() => {
              undoDescription();
              setUndoDescription(null);
            }}
          />
        ) : null}
        <DateField
          label={t.details.recordedEyebrow}
          value={draft.recordedAt}
          onChange={(v) => {
            edit({ recordedAt: v });
            void flush();
          }}
          help={t.details.dateHelp}
          error={badDate ? t.details.badDate : null}
        />
        <Text style={[typography.caption, { color: c.textTertiary }]}>
          {t.details.autosaveHelp}
        </Text>
      </Card>

      <SectionHeader title={t.export.title} />
      <Card style={st.listCard}>
        {PRESET_KEYS.map((k, i) => {
          const on = preset === k;
          const text = presetText(k);
          return (
            <Pressable
              key={k}
              onPress={() => choosePreset(k)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${text.label}, ${text.spec}`}
              style={({ pressed }) => [
                st.preset,
                {
                  backgroundColor: pressed ? c.surfaceHover : 'transparent',
                  borderBottomColor: c.border,
                  borderBottomWidth: i === PRESET_KEYS.length - 1 ? 0 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <View
                style={[
                  st.radio,
                  {
                    borderColor: on ? (c.isDark ? c.accentSolid : c.accentBorder) : c.borderStrong,
                  },
                ]}
              >
                {on ? (
                  <View
                    style={[
                      st.radioDot,
                      { backgroundColor: c.isDark ? c.accentSolid : c.accentBorder },
                    ]}
                  />
                ) : null}
              </View>
              <View style={st.flex}>
                <Text style={[typography.bodyStrong, { color: c.textPrimary }]}>
                  {k === 'podcast' ? `${text.label}${t.sound.recommended}` : text.label}
                </Text>
                <Text style={[typography.caption, { color: c.textSecondary }]}>{text.spec}</Text>
              </View>
            </Pressable>
          );
        })}
        {preset === 'custom' ? (
          <View style={st.custom}>
            <Text style={[typography.caption, { color: c.textSecondary }]}>
              {t.export.custom.format}
            </Text>
            <Segmented
              value={custom.format}
              onChange={(v) => updateCustom({ format: v })}
              options={[
                { value: 'm4a' as const, label: t.export.custom.m4a },
                { value: 'wav' as const, label: t.export.custom.wav },
              ]}
            />
            {custom.format === 'm4a' ? (
              <View style={st.infoCaption}>
                <Text style={[typography.caption, { color: c.textSecondary }]}>
                  {t.export.custom.bitrate}
                </Text>
                <InfoButton info={t.glossary.bitrate} />
              </View>
            ) : null}
            {custom.format === 'm4a' ? (
              <View style={st.chips}>
                {CUSTOM_BITRATES.map((b) => (
                  <Chip
                    key={b}
                    label={`${b / 1000} kbps`}
                    active={custom.bitrate === b}
                    onPress={() => updateCustom({ bitrate: b })}
                  />
                ))}
              </View>
            ) : null}
            <Text style={[typography.caption, { color: c.textSecondary }]}>
              {t.export.custom.channels}
            </Text>
            <Segmented
              value={custom.channels === 1 ? 'mono' : 'stereo'}
              onChange={(v) => updateCustom({ channels: v === 'mono' ? 1 : 2 })}
              options={[
                { value: 'mono' as const, label: t.export.custom.mono },
                { value: 'stereo' as const, label: t.export.custom.stereo },
              ]}
            />
          </View>
        ) : null}
        <View style={[st.kv, st.sizeRow]}>
          <Text style={[typography.body, { color: c.textSecondary }]}>
            {t.export.estimatedSize}
          </Text>
          <Text style={[typography.numeric, tabularNums, { color: c.textPrimary }]}>
            {formatBytes(estimateExportBytes(p, state.total))}
          </Text>
        </View>
      </Card>

      {failure ? (
        <Notice
          kind="error"
          title={t.export.failedTitle}
          body={`${t.export.failedBody}\n${failure}`}
        />
      ) : null}

      {job ? (
        <Card>
          <View style={st.kv}>
            <Text
              style={[typography.bodyStrong, { color: c.textPrimary }]}
              accessibilityLiveRegion="polite"
            >
              {phaseLabel}
            </Text>
            <Text style={[typography.numeric, tabularNums, { color: c.textSecondary }]}>
              {Math.round(job.progress * 100)}%
            </Text>
          </View>
          <ProgressBar value={job.progress} label={phaseLabel} />
          <Button
            label={t.export.cancel}
            kind="secondary"
            onPress={() => exporter.cancel(job.exportId)}
            style={st.cancel}
          />
        </Card>
      ) : (
        <Button
          label={failure ? t.common.retry : t.export.run}
          icon="share"
          onPress={() => void start()}
          disabled={state.total <= 0}
        />
      )}
      {state.total <= 0 ? (
        <Text style={[typography.caption, { color: c.textSecondary, marginTop: space.sm }]}>
          {t.export.emptyVoice}
        </Text>
      ) : null}

      {history.length ? <SectionHeader title={t.export.historyEyebrow} /> : null}
      {history.map((h, i) => (
        <Row
          key={h.id}
          label={`${formatDateTime(h.created_at, locale)} · ${h.format.toUpperCase()}`}
          sub={
            h.status === 'done'
              ? [formatSmp(smp(h.duration_smp)), formatBytes(h.bytes ?? 0), loudnessText(t, h)]
                  .filter(Boolean)
                  .join(' · ')
              : h.status === 'failed'
                ? t.export.historyFailed(storedErrorText(t, h.error))
                : h.status === 'cancelled'
                  ? t.export.historyCancelled
                  : t.export.historyRunning(Math.round(h.progress * 100))
          }
          last={i === history.length - 1}
          {...(h.status === 'done'
            ? {
                onPress: () => onDone(h.id),
                accessibilityLabel: t.export.a11yOpenHandoff(formatDateTime(h.created_at, locale)),
              }
            : {})}
          {...(isExportRunning(h.status)
            ? {}
            : {
                right: (
                  <View style={st.rowActions}>
                    {h.status === 'done' ? (
                      <IconButton
                        name="share"
                        label={t.common.share}
                        onPress={() => void share(h)}
                      />
                    ) : null}
                    <IconButton
                      name="trash"
                      label={t.export.a11yDeleteExport(formatDateTime(h.created_at, locale))}
                      onPress={() => void removeExport(h)}
                    />
                  </View>
                ),
              })}
        />
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.md,
  },
  listCard: { paddingVertical: space.sm },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginVertical: space.sm },
  stepLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  stepLabelText: { flexShrink: 1 },
  infoCaption: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: hit.min,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepVal: { minWidth: 84, textAlign: 'center' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  pair: { flexDirection: 'row', gap: space.md },
  preset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: hit.min + space.md,
    paddingVertical: space.md,
  },
  radio: {
    width: space.xl,
    height: space.xl,
    borderRadius: radius.pill,
    borderWidth: stroke.selected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: space.md, height: space.md, borderRadius: radius.pill },
  sizeRow: { marginTop: space.md, marginBottom: 0 },
  custom: { gap: space.sm, paddingTop: space.md },
  cancel: { marginTop: space.lg },
});
