import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';

import { APP_VERSION } from '@/domain/version';
import { useServices } from '@/features/app/ServicesProvider';
import { formatBytes, summarizeStorage, type StorageSummary } from '@/features/settings/storage';
import { useAsyncData } from '@/features/show/useAsyncData';
import { useT, type Messages } from '@/i18n';
import { availableDiskBytes } from '@/infra/files/fileSystem';
import type { AppSettings } from '@/infra/db/repositories/settingsRepo';
import { space, tabularNums, typography } from '@/ui/tokens';
import {
  Card,
  Chip,
  Notice,
  Row,
  Screen,
  SectionHeader,
  Segmented,
  Text,
  Toast,
  Toggle,
} from '@/ui/components';
import { ChoiceMenu } from '@/ui/ChoiceMenu';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

import type { AudioInput } from '../../modules/podsnow-recorder/src/PodsnowRecorder.types';

interface Loaded {
  storage: StorageSummary;
  freeBytes: number;
  inputs: AudioInput[];
}

/** 選択肢は「値の並び」だけ持ち、ラベルは i18n から引く（Issue #80）。 */
/** 表示テーマと同じく「システム」を最後に置く。 */
const LANGUAGES: readonly AppSettings['language'][] = ['ja', 'en', 'system'];
const THEMES: readonly AppSettings['theme'][] = ['dark', 'light', 'system'];
const MINUTES = [30, 60, 90, 120];
const SILENCE_LEN = [1000, 1500, 2000, 3000];
const SILENCE_DB = [-40, -45, -50, -55];
const SILENCE_PAD = [100, 250, 400];
const SOURCES: readonly AppSettings['recording']['androidAudioSource'][] = [
  'voice_recognition',
  'mic',
  'unprocessed',
  'camcorder',
];
const PRESETS: readonly AppSettings['export']['defaultPreset'][] = [
  'podcast',
  'high',
  'wav',
  'custom',
];
const MONITOR: readonly AppSettings['monitor']['jinglePlayback'][] = [
  'headphonesOnly',
  'always',
  'never',
];

/** アプリ全般設定（REQUIREMENTS.md §2.9、DATA_MODEL.md §4.16）。 */
export default function SettingsScreen() {
  const c = useAppTheme();
  const t: Messages = useT();
  const router = useRouter();
  const services = useServices();
  const { db, recorder, updateSettings } = services;
  const { toast, show: showToast, act, dismiss } = useToast();
  const [settings, setSettings] = useState<AppSettings>(services.settings);

  const loader = useCallback(async (): Promise<Loaded> => {
    const [storage, inputs] = await Promise.all([
      summarizeStorage(db),
      recorder.getInputs().catch(() => [] as AudioInput[]),
    ]);
    let freeBytes = 0;
    try {
      freeBytes = availableDiskBytes();
    } catch {
      freeBytes = 0;
    }
    return { storage, freeBytes, inputs };
  }, [db, recorder]);
  const { data } = useAsyncData<Loaded>(loader, {
    storage: { recordingsBytes: 0, exportsBytes: 0, exportedEpisodesRecordingsBytes: 0 },
    freeBytes: 0,
    inputs: [],
  });

  const set = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    await updateSettings(key, value);
  };
  const setRec = (p: Partial<AppSettings['recording']>) =>
    set('recording', { ...settings.recording, ...p });
  const setSilence = (p: Partial<AppSettings['silence']>) =>
    set('silence', { ...settings.silence, ...p });

  // 内蔵マイクは端末名（例: Pixel 9a）ではなく「内蔵マイク」と出し、端末名は補足に回す。
  const inputName = (i: AudioInput) => (i.type === 'builtin' ? t.record.builtInMic : i.name);
  const inputSub = (i: AudioInput) =>
    `${i.type === 'builtin' ? i.name : t.settings.inputTypes[i.type]}${
      i.lowQuality ? t.settings.lowQualitySuffix : ''
    }`;
  const currentInput = data.inputs.find((i) => i.uid === settings.recording.preferredInputUid);
  const inputLabel = settings.recording.preferredInputUid
    ? currentInput
      ? inputName(currentInput)
      : t.settings.inputLastUsed
    : t.settings.inputOsDefault;

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}>
      <ScreenHeader title={t.settings.title} />

      <SectionHeader title={t.settings.languageEyebrow} />
      <Segmented
        value={settings.language}
        onChange={(v) => void set('language', v)}
        options={LANGUAGES.map((v) => ({ value: v, label: t.settings.language[v] }))}
      />

      <SectionHeader title={t.settings.appearanceEyebrow} />
      <Segmented
        value={settings.theme}
        onChange={(v) => void set('theme', v)}
        options={THEMES.map((v) => ({ value: v, label: t.settings.theme[v] }))}
      />

      <SectionHeader title={t.settings.recordingEyebrow} />
      <Card style={{ paddingVertical: space.xs }}>
        <Row
          label={t.settings.quality}
          sub={t.settings.qualitySub}
          below={
            <>
              {[44100, 48000].map((sr) => (
                <Chip
                  key={sr}
                  label={`${sr / 1000} kHz`}
                  active={settings.recording.sampleRate === sr}
                  onPress={() => setRec({ sampleRate: sr })}
                />
              ))}
            </>
          }
        />
        <Row
          label={t.settings.channels}
          sub={t.settings.channelsSub}
          below={
            <>
              <Chip
                label={t.settings.stereo}
                active={settings.recording.channels === 2}
                onPress={() => setRec({ channels: 2 })}
              />
              <Chip
                label={t.settings.mono}
                active={settings.recording.channels === 1}
                onPress={() => setRec({ channels: 1 })}
              />
            </>
          }
        />
        <ChoiceMenu
          label={t.settings.inputDefault}
          sub={inputLabel}
          title={t.settings.inputDefault}
          value={settings.recording.preferredInputUid ?? ''}
          options={[
            { value: '', label: t.settings.inputOsDefault, sub: t.settings.inputOsDefaultSub },
            ...data.inputs.map((i) => ({
              value: i.uid,
              label: inputName(i),
              sub: inputSub(i),
            })),
          ]}
          onChange={(uid) => void setRec({ preferredInputUid: uid || null })}
        />
        {currentInput?.lowQuality ? (
          <Notice
            kind="warning"
            title={t.record.bluetoothTitle}
            body={t.settings.bluetoothWarning}
          />
        ) : null}
        <Row
          label={t.settings.autoResume}
          sub={t.settings.autoResumeSub}
          right={
            <Toggle
              value={settings.recording.autoResumeAfterInterruption}
              onChange={(v) => setRec({ autoResumeAfterInterruption: v })}
            />
          }
        />
        <Row
          label={t.settings.expectedLength}
          sub={t.settings.expectedLengthSub}
          below={
            <>
              {MINUTES.map((m) => (
                <Chip
                  key={m}
                  label={t.settings.minutes(m)}
                  active={settings.recording.expectedMinutes === m}
                  onPress={() => setRec({ expectedMinutes: m })}
                />
              ))}
            </>
          }
        />
        {Platform.OS === 'android' ? (
          <ChoiceMenu
            label={t.settings.androidSource}
            sub={t.settings.sources[settings.recording.androidAudioSource].label}
            title={t.settings.androidSource}
            value={settings.recording.androidAudioSource}
            options={SOURCES.map((v) => ({
              value: v,
              label: t.settings.sources[v].label,
              sub: t.settings.sources[v].sub,
            }))}
            onChange={(v) => void setRec({ androidAudioSource: v })}
          />
        ) : null}
      </Card>

      <SectionHeader title={t.settings.editingEyebrow} />
      <Card style={{ paddingVertical: space.xs }}>
        <Row
          label={t.settings.silenceLength}
          sub={t.settings.silenceLengthSub}
          below={
            <>
              {SILENCE_LEN.map((ms) => (
                <Chip
                  key={ms}
                  label={t.settings.seconds((ms / 1000).toFixed(1))}
                  active={settings.silence.minDurationMs === ms}
                  onPress={() => setSilence({ minDurationMs: ms })}
                />
              ))}
            </>
          }
        />
        <Row
          label={t.settings.silenceThreshold}
          sub={t.settings.silenceThresholdSub}
          below={
            <>
              {SILENCE_DB.map((dbv) => (
                <Chip
                  key={dbv}
                  label={`${dbv} dB`}
                  active={settings.silence.thresholdDb === dbv}
                  onPress={() => setSilence({ thresholdDb: dbv })}
                />
              ))}
            </>
          }
        />
        <Row
          label={t.settings.silencePad}
          sub={t.settings.silencePadSub}
          below={
            <>
              {SILENCE_PAD.map((ms) => (
                <Chip
                  key={ms}
                  label={`${ms} ms`}
                  active={settings.silence.padMs === ms}
                  onPress={() => setSilence({ padMs: ms })}
                />
              ))}
            </>
          }
        />
        <Row
          label={t.settings.silenceAuto}
          sub={t.settings.silenceAutoSub}
          right={
            <Toggle
              value={settings.silence.autoApply}
              onChange={(v) => setSilence({ autoApply: v })}
            />
          }
        />
        <Row
          label={t.settings.haptics}
          sub={t.settings.hapticsSub}
          right={<Toggle value={settings.haptics} onChange={(v) => set('haptics', v)} />}
        />
        <ChoiceMenu
          label={t.settings.monitorRow}
          sub={t.settings.monitor[settings.monitor.jinglePlayback].label}
          title={t.settings.monitorRow}
          value={settings.monitor.jinglePlayback}
          options={MONITOR.map((v) => ({
            value: v,
            label: t.settings.monitor[v].label,
            sub: t.settings.monitor[v].sub,
          }))}
          onChange={(v) => void set('monitor', { jinglePlayback: v })}
        />
      </Card>

      <SectionHeader title={t.settings.exportEyebrow} />
      <Card style={{ paddingVertical: space.xs }}>
        <ChoiceMenu
          label={t.settings.defaultPreset}
          sub={t.settings.presets[settings.export.defaultPreset].sub}
          title={t.settings.defaultPresetSheet}
          value={settings.export.defaultPreset}
          options={PRESETS.map((v) => ({
            value: v,
            label: t.settings.presets[v].label,
            sub: t.settings.presets[v].sub,
          }))}
          onChange={(v) => void set('export', { ...services.settings.export, defaultPreset: v })}
        />
      </Card>

      <SectionHeader title={t.settings.showEyebrow} />
      <Card style={{ paddingVertical: space.xs }}>
        <Row
          label={t.settings.showSettings}
          sub={t.settings.showSettingsSub}
          onPress={() => router.push('/show')}
        />
        <Row
          label={t.settings.showAssets}
          sub={t.settings.showAssetsSub}
          onPress={() => router.push('/show')}
        />
      </Card>

      <SectionHeader title={t.settings.storageEyebrow} />
      <Card style={{ paddingVertical: space.xs }}>
        <Row
          label={t.settings.recordingsSize}
          sub={t.settings.recordingsSizeSub}
          right={
            <Text style={[typography.mono, tabularNums, { color: c.textPrimary }]}>
              {formatBytes(data.storage.recordingsBytes)}
            </Text>
          }
        />
        <Row
          label={t.settings.exportsSize}
          right={
            <Text style={[typography.mono, tabularNums, { color: c.textPrimary }]}>
              {formatBytes(data.storage.exportsBytes)}
            </Text>
          }
        />
        <Row
          label={t.settings.freeSpace}
          right={
            <Text style={[typography.mono, tabularNums, { color: c.textPrimary }]}>
              {formatBytes(data.freeBytes)}
            </Text>
          }
        />
        <Row
          label={t.settings.cleanup}
          sub={t.settings.cleanupSub(formatBytes(data.storage.exportedEpisodesRecordingsBytes))}
          onPress={() => showToast({ text: t.settings.cleanupToast })}
        />
      </Card>

      <Text style={[st.version, { color: c.textTertiary }]}>
        {t.app.versionLine(APP_VERSION)}
        {'\n'}
        {t.app.nonDestructiveNote}
      </Text>
    </Screen>
  );
}

const st = StyleSheet.create({
  version: { ...typography.caption, textAlign: 'center', marginTop: space.xl },
});
