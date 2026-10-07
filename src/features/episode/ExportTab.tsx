import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { parseNumberingInput } from '@/domain/episodes/numbering';
import { insertTopics, renderTemplate } from '@/domain/metadata/template';
import { EPISODE_TYPES } from '@/domain/podcast/feed';
import { headings } from '@/domain/outline';
import { formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import {
  episodeHeading,
  errorCodeText,
  errorText,
  formatDate,
  formatDateTime,
  storedErrorText,
  useLocale,
  useT,
  type Messages,
} from '@/i18n';
import { isExportRunning, listExports, type ExportRow } from '@/infra/db/repositories/exportsRepo';
import { getDefaultTemplate } from '@/infra/db/repositories/showsRepo';
import type { LoudnessStatus } from '@/services/audio/LoudnessService';
import { parseSoundSettings, type SoundSettings } from '@/services/audio/renderDocumentFromDb';
import {
  CUSTOM_BITRATES,
  EXPORT_SAMPLE_RATES,
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
import {
  artwork,
  hit,
  icon,
  pressedOpacity,
  radius,
  space,
  stroke,
  tabularNums,
  typography,
} from '@/ui/tokens';
import { Artwork } from '@/ui/Artwork';
import { CircleButton } from '@/ui/CircleButton';
import {
  Button,
  Chip,
  Field,
  Icon,
  IconButton,
  InfoButton,
  Loading,
  Notice,
  ProgressBar,
  Row,
  Segmented,
  Text,
  type TermInfo,
} from '@/ui/components';
import { confirmDestructive } from '@/ui/alerts';
import { DateField } from '@/ui/DateField';
import { Sheet } from '@/ui/Sheet';
import { useAppTheme } from '@/ui/ThemeContext';

import { CopyRow } from './CopyRow';
import { fromDateInput } from './detailsDraft';
import { useCopy } from './useCopy';
import { shareExport } from './shareExport';
import type { DetailsDraftState } from './useDetailsDraft';
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
  /** 詳細の入力中の値と自動保存（エピソード画面の `useDetailsDraft`）。 */
  details: DetailsDraftState;
  onShowToast: (text: string, undo?: () => void) => void;
  onDone: (exportId: string) => void;
  onGoEdit: () => void;
}

/**
 * 書き出しタブ（docs/ux-restructure.md §7）。
 * 旧「詳細」「音の仕上げ」「書き出し」の 3 画面を 1 本のスクロールにまとめる。
 */
export function ExportTab({ ws, details, onShowToast, onDone, onGoEdit }: ExportTabProps) {
  const c = useAppTheme();
  const t = useT();
  const locale = useLocale();
  const {
    db,
    show,
    coverArt,
    episodes,
    exporter,
    playback,
    loudness,
    settings,
    updateSettings,
    haptics,
  } = useServices();
  const { state } = ws;
  const episode = state.episode;

  // 詳細の入力中の値と自動保存はエピソード画面が持つ（タブを切り替えても消えない。Issue #167）
  const { draft, draftRef, edit, flush } = details;
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
  // 試聴は書き出すチャンネル（モノラル / ステレオ）で鳴らす。離れたら編集の既定（ステレオ）に戻す。
  // サンプルレートは試聴に反映しない（Issue #174、ユーザー判断 2026-10-03）
  const previewChannels = resolveExportPreset(preset, custom).channels;
  useEffect(() => {
    void playback.setTimelineChannels(previewChannels).catch(() => {});
  }, [playback, previewChannels]);
  useEffect(() => () => void playback.setTimelineChannels(2).catch(() => {}), [playback]);
  // 試聴に書き出しと同じ正規化をかける。ゲインは保存してあれば使い、無ければ裏で測る（Issue #158）。
  // 離れたら測定をやめ、調整なしに戻す（編集タブは正規化しない）
  const episodeId = episode?.id ?? null;
  const [measure, setMeasure] = useState<LoudnessStatus>(() => loudness.getStatus());
  useEffect(() => {
    const sub = loudness.onStatus(setMeasure);
    return () => sub.remove();
  }, [loudness]);
  useEffect(() => {
    if (episodeId) void loudness.activate(episodeId, previewChannels).catch(() => {});
  }, [loudness, episodeId, previewChannels]);
  useEffect(() => () => void loudness.deactivate().catch(() => {}), [loudness]);
  const [history, setHistory] = useState<ExportRow[]>([]);
  const [job, setJob] = useState<{ exportId: string; progress: number; phase: string } | null>(
    null,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [undoDescription, setUndoDescription] = useState<(() => void) | null>(null);
  // 配信サービスに貼る情報の行を押したときの編集シート
  const [editing, setEditing] = useState<'title' | 'description' | 'more' | 'recorded' | null>(
    null,
  );
  const { copied, copy } = useCopy();
  const closeEditing = () => {
    setEditing(null);
    void flush();
  };

  const soundHydrated = sound !== null;
  useEffect(() => {
    if (!episode || soundHydrated) return;
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) setSound(parseSoundSettings(episode.sound_settings));
    });
    return () => {
      alive = false;
    };
  }, [episode, soundHydrated]);

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
        // 音声は書き出せている。題名などが入らなかったことだけ知らせる（Issue #56）
        if (!e.metadataEmbedded) onShowToast(errorCodeText(t, 'export_metadata_failed'));
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
    // 書き出しの間は試聴の測定を止める（書き出しが測って保存する。AUDIO_DESIGN.md §8.4）
    loudness.setExporting(true);
    try {
      const exportId = await exporter.start(episode.id, resolveExportPreset(preset, custom));
      setJob({ exportId, progress: 0, phase: 'measuring' });
    } catch (e) {
      loudness.setExporting(false);
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
    const khz = String(x.sampleRate / 1000);
    return x.format === 'wav'
      ? t.export.specWav(ch, khz)
      : t.export.specM4a(Math.round(x.bitrate / 1000), ch, khz);
  }

  const phaseLabel = job?.phase === 'measuring' ? t.export.phaseMeasuring : t.export.phaseRendering;
  const hasBgm = state.doc.overlays.some((o) => o.kind === 'bgm');
  // 「その他の詳細」の値（Spotify for Creators と同じ並び: 種類・話数・シーズン。Issue #211）
  const draftNumber = parseNumberingInput(draft.episodeNumber);
  const draftSeason = parseNumberingInput(draft.season);
  const moreDetailsText = [
    t.details.episodeTypes[draft.episodeType],
    draftNumber ? t.episode.number(draftNumber) : null,
    draftSeason ? t.details.seasonValue(draftSeason) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  /** 入力をやめたとき、空として保存した 0 は欄も空にする（保存した値と欄の見た目をそろえる）。 */
  const blurNumbering = (key: 'episodeNumber' | 'season') => {
    if (parseNumberingInput(draft[key]) === null && draft[key] !== '') edit({ [key]: '' });
    void flush();
  };
  const badDate = fromDateInput(draft.recordedAt) === undefined;

  const lufsText = `${sound.loudness.targetLufs} LUFS`;
  const duckText = `${sound.ducking.depthDb} dB`;
  const recordedDate = fromDateInput(draft.recordedAt);
  const autosave = (
    <Text style={[typography.caption, { color: c.textTertiary }]}>{t.details.autosaveHelp}</Text>
  );

  return (
    <View style={st.ex}>
      {/* 見本 `.exhero`: アートワーク（中）と題・番組名・時間。右に試聴の白い丸 */}
      <View style={st.hero}>
        <Artwork
          uri={coverArt.uri(show.cover_path)}
          name={
            episode.episode_number === null ? show.name : t.episode.number(episode.episode_number)
          }
          size={artwork.exportHero}
        />
        <View style={st.heroText}>
          <Text style={[typography.heading, { color: c.textPrimary }]} numberOfLines={2}>
            {episodeHeading(t, episode.episode_number, episode.title)}
          </Text>
          <Text style={[typography.caption, { color: c.textSecondary }]} numberOfLines={1}>
            {`${show.name} · ${formatSmp(state.total)}`}
          </Text>
        </View>
        <CircleButton
          name={state.playing ? 'pause' : 'play'}
          label={state.playing ? t.a11y.pause : t.a11y.play}
          disabled={state.total <= 0}
          onPress={() => void ws.togglePlay()}
        />
      </View>

      {/* 見本 `.checks`: 仕上げの項目。押すと入・切が替わる */}
      <View style={[st.checks, { backgroundColor: c.surface }]}>
        <Check
          label={t.sound.loudness}
          on={sound.loudness.enabled}
          // 試聴の音量を測っている間は、値の所に進み具合を出す（行を増やさず、見本の行の間を保つ）
          value={
            !sound.loudness.enabled
              ? null
              : measure.measuring
                ? t.sound.measuringShort(Math.round(measure.progress * 100))
                : lufsText
          }
          {...(sound.loudness.enabled && measure.measuring
            ? { a11yValue: t.sound.measuring(Math.round(measure.progress * 100)) }
            : {})}
          onPress={() =>
            updateSound({
              ...sound,
              loudness: { ...sound.loudness, enabled: !sound.loudness.enabled },
            })
          }
        />
        {/* BGM が無いときは押すと収録タブへ（BGM を入れる） */}
        <Check
          label={t.sound.ducking}
          on={sound.ducking.enabled && hasBgm}
          value={hasBgm ? (sound.ducking.enabled ? duckText : null) : t.sound.addBgm}
          onPress={
            hasBgm
              ? () =>
                  updateSound({
                    ...sound,
                    ducking: { ...sound.ducking, enabled: !sound.ducking.enabled },
                  })
              : onGoEdit
          }
        />
        <Check label={t.sound.embed} on />
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
      </View>

      {/* 見本: 形式のチップ（M4A / WAV）と見込みのサイズ、アクセントの「書き出して共有」 */}
      <View style={st.format}>
        <View style={st.formatRow}>
          <Chip
            label={t.export.custom.m4aShort}
            active={p.format === 'm4a'}
            onPress={() => (p.format === 'm4a' ? undefined : choosePreset('podcast'))}
          />
          <Chip
            label={t.export.custom.wavShort}
            active={p.format === 'wav'}
            onPress={() => (p.format === 'wav' ? undefined : choosePreset('wav'))}
          />
          <Text style={[typography.small, st.size, tabularNums, { color: c.textSecondary }]}>
            {t.export.estimatedSizeShort(formatBytes(estimateExportBytes(p, state.total)))}
          </Text>
        </View>
        {soundAdvanced ? (
          <View style={st.chipsRow}>
            {PRESET_KEYS.map((k) => (
              <Chip
                key={k}
                label={presetText(k).label}
                active={preset === k}
                accessibilityLabel={`${presetText(k).label}, ${presetText(k).spec}`}
                onPress={() => choosePreset(k)}
              />
            ))}
          </View>
        ) : null}
        {soundAdvanced ? (
          <Text style={[typography.small, { color: c.textSecondary }]}>
            {presetText(preset).spec}
          </Text>
        ) : null}
        {soundAdvanced ? (
          <>
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
                  {t.export.custom.sampleRate}
                </Text>
                <Segmented
                  value={String(custom.sampleRate)}
                  onChange={(v) =>
                    updateCustom({
                      sampleRate: EXPORT_SAMPLE_RATES.find((r) => String(r) === v) ?? 48000,
                    })
                  }
                  options={EXPORT_SAMPLE_RATES.map((r) => ({
                    value: String(r),
                    label: `${r / 1000} kHz`,
                  }))}
                />
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
          </>
        ) : null}
        {failure ? (
          <Notice
            kind="error"
            title={t.export.failedTitle}
            body={`${t.export.failedBody}\n${failure}`}
          />
        ) : null}

        {job ? (
          <View style={[st.job, { backgroundColor: c.surface }]}>
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
            />
          </View>
        ) : (
          <Button
            large
            label={failure ? t.common.retry : t.export.run}
            icon="share"
            onPress={() => void start()}
            disabled={state.total <= 0}
          />
        )}
        {state.total <= 0 ? (
          <Text style={[typography.caption, { color: c.textSecondary }]}>
            {t.export.emptyVoice}
          </Text>
        ) : null}
        <Button
          label={soundAdvanced ? t.sound.hideAdvanced : t.sound.advanced}
          kind="ghost"
          icon={soundAdvanced ? 'chevronUp' : 'chevron'}
          compact
          accessibilityLabel={t.sound.a11yAdvanced}
          onPress={() => setSoundAdvanced((v) => !v)}
        />
      </View>

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
      {/* 見本 `.fields`: 配信サービスに貼る情報。行を押すと直せる */}
      <View>
        <Text
          style={[typography.subheading, st.fieldsHead, { color: c.textPrimary }]}
          accessibilityRole="header"
        >
          {t.pack.fieldsHeading}
        </Text>
        <CopyRow
          label={t.details.titleEyebrow}
          value={draft.title}
          copied={copied === 'title'}
          onCopy={() => void copy('title', draft.title)}
          onEdit={() => setEditing('title')}
          editLabel={t.details.a11yEdit(t.details.titleEyebrow)}
        />
        <CopyRow
          label={t.details.descriptionEyebrow}
          value={draft.description}
          copied={copied === 'description'}
          onCopy={() => void copy('description', draft.description)}
          onEdit={() => setEditing('description')}
          editLabel={t.details.a11yEdit(t.details.descriptionEyebrow)}
        />
        <CopyRow
          label={t.details.moreDetails}
          value={moreDetailsText}
          onEdit={() => setEditing('more')}
          editLabel={t.details.a11yEdit(t.details.moreDetails)}
        />
        <CopyRow
          label={t.details.recordedEyebrow}
          value={recordedDate ? formatDate(new Date(recordedDate), locale) : ''}
          copied={copied === 'recorded'}
          onCopy={() =>
            void copy('recorded', recordedDate ? formatDate(new Date(recordedDate), locale) : '')
          }
          onEdit={() => setEditing('recorded')}
          editLabel={t.details.a11yEdit(t.details.recordedEyebrow)}
        />
      </View>

      <Sheet visible={editing === 'title'} onClose={closeEditing} title={t.details.titleEyebrow}>
        <Field
          label={t.details.titleEyebrow}
          value={draft.title}
          onChangeText={(v) => edit({ title: v })}
          onBlur={() => void flush()}
          placeholder={t.details.titlePlaceholder}
        />
        {autosave}
      </Sheet>
      <Sheet
        visible={editing === 'description'}
        onClose={closeEditing}
        title={t.details.descriptionEyebrow}
      >
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
            kind="secondary"
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
                    episodeNumber: parseNumberingInput(cur.episodeNumber) ?? null,
                    season: parseNumberingInput(cur.season) ?? null,
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
        {autosave}
      </Sheet>
      <Sheet visible={editing === 'more'} onClose={closeEditing} title={t.details.moreDetails}>
        <View style={st.moreDetails}>
          <View style={st.custom}>
            <Text style={[typography.caption, { color: c.textSecondary }]}>
              {t.details.typeEyebrow}
            </Text>
            <Segmented
              value={draft.episodeType}
              onChange={(v) => {
                edit({ episodeType: v });
                void flush();
              }}
              options={EPISODE_TYPES.map((v) => ({ value: v, label: t.details.episodeTypes[v] }))}
            />
          </View>
          <View style={st.pair}>
            <View style={st.flex}>
              <Field
                label={t.details.episodeEyebrow}
                value={draft.episodeNumber}
                onChangeText={(v) => edit({ episodeNumber: v })}
                onBlur={() => blurNumbering('episodeNumber')}
                keyboardType="number-pad"
                help={t.details.numberHelp}
              />
            </View>
            <View style={st.flex}>
              <Field
                label={t.details.seasonEyebrow}
                value={draft.season}
                onChangeText={(v) => edit({ season: v })}
                onBlur={() => blurNumbering('season')}
                keyboardType="number-pad"
              />
            </View>
          </View>
        </View>
        {autosave}
      </Sheet>
      <Sheet
        visible={editing === 'recorded'}
        onClose={closeEditing}
        title={t.details.recordedEyebrow}
      >
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
        {autosave}
      </Sheet>

      {history.length ? (
        <Text style={[typography.subheading, { color: c.textPrimary }]} accessibilityRole="header">
          {t.export.historyEyebrow}
        </Text>
      ) : null}
      {history.map((h, i) => (
        <Row
          key={h.id}
          label={`${formatDateTime(h.created_at, locale)} · ${h.format.toUpperCase()}`}
          sub={
            h.status === 'done'
              ? [
                  formatSmp(smp(h.duration_smp)),
                  formatBytes(h.bytes ?? 0),
                  loudnessText(t, h),
                  h.error === 'export_metadata_failed' ? t.export.historyNoMetadata : null,
                ]
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

/** 仕上げの項目の行（見本 `.check`）。入っていればアクセントの丸に ✓、値は右端。 */
function Check({
  label,
  info,
  on,
  value,
  a11yValue,
  disabled,
  onPress,
}: {
  label: string;
  info?: TermInfo;
  on: boolean;
  value?: string | null;
  /** 読み上げで値の代わりに読む文（短い表示の値を補う）。 */
  a11yValue?: string;
  disabled?: boolean;
  /** 無ければ切り替えられない（常に入っている項目）。 */
  onPress?: () => void;
}) {
  const c = useAppTheme();
  const body = (
    <>
      <View
        style={[
          st.dot,
          on
            ? { backgroundColor: c.accentSolid }
            : { borderColor: c.borderStrong, borderWidth: stroke.selected },
        ]}
      >
        {on ? <Icon name="check" color={c.accentOnSolid} size={icon.dot} /> : null}
      </View>
      <Text
        style={[
          typography.body,
          st.checkLabel,
          { color: disabled ? c.textDisabled : c.textPrimary },
        ]}
      >
        {label}
      </Text>
      {info ? <InfoButton info={info} /> : null}
      {value ? (
        <Text
          style={[typography.numeric, st.checkVal, { color: c.textSecondary }]}
          accessibilityLiveRegion="polite"
        >
          {value}
        </Text>
      ) : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={st.check} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={a11yValue || value ? `${label}, ${a11yValue ?? value}` : label}
      accessibilityState={{ checked: on, disabled: !!disabled }}
      hitSlop={{ top: space.x10 / 2, bottom: space.x10 / 2 }}
      style={({ pressed }) => [st.check, pressed ? { opacity: pressedOpacity } : null]}
    >
      {body}
    </Pressable>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  // 見本 `.ex`: まとまりの間 20。
  ex: { gap: space.x20 },
  // 見本 `.exhero`: 間 14。
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.x14 },
  heroText: { flex: 1, minWidth: 0, gap: space.xs },
  // 見本 `.checks`: 地 `surface`、角丸 8、内側 14、行の間 10。
  checks: { borderRadius: radius.sm, padding: space.x14, gap: space.x10 },
  // 見本 `.check`: 行の高さは文字の分だけ（触れる面は hitSlop で広げる）
  check: { flexDirection: 'row', alignItems: 'center', gap: space.x10 },
  checkLabel: { flexShrink: 1 },
  checkVal: { marginLeft: 'auto' },
  dot: {
    width: icon.button,
    height: icon.button,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  format: { gap: space.x10 },
  // 見本: チップ 2 つと、右端に見込みのサイズ
  formatRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  size: { marginLeft: 'auto' },
  // 見本 `.fields h4`: 下 4
  fieldsHead: { marginBottom: space.xs },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  job: { borderRadius: radius.sm, padding: space.x14, gap: space.md },
  group: { gap: space.md },
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
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
    borderBottomWidth: stroke.hairline,
  },
  stepVal: { minWidth: 84, textAlign: 'center' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pair: { flexDirection: 'row', gap: space.md },
  custom: { gap: space.sm },
  // 「その他の詳細」のシート: 種類の切り替えと、話数・シーズンの欄の間をあける
  moreDetails: { gap: space.xl },
});
