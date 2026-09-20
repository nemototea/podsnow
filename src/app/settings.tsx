import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { APP_VERSION } from '@/domain/version';
import { useServices } from '@/features/app/ServicesProvider';
import { formatBytes, summarizeStorage, type StorageSummary } from '@/features/settings/storage';
import { useAsyncData } from '@/features/show/useAsyncData';
import { useT, type Messages } from '@/i18n';
import { availableDiskBytes } from '@/infra/files/fileSystem';
import type { AppSettings } from '@/infra/db/repositories/settingsRepo';
import { Card, Chip, Eyebrow, Header, Row, Screen, Sheet, Toast, Toggle } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

import type { AudioInput } from '../../modules/podsnow-recorder/src/PodsnowRecorder.types';

interface Loaded {
  storage: StorageSummary;
  freeBytes: number;
  inputs: AudioInput[];
}

/** 選択肢は「値の並び」だけ持ち、ラベルは i18n から引く（Issue #80）。 */
const LANGUAGES: readonly AppSettings['language'][] = ['system', 'ja', 'en'];
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
const PRESETS: readonly AppSettings['export']['defaultPreset'][] = ['podcast', 'high', 'wav'];
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
  const [sheet, setSheet] = useState<'input' | 'source' | 'preset' | 'monitor' | null>(null);

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

  const currentInput = data.inputs.find((i) => i.uid === settings.recording.preferredInputUid);
  const inputLabel = settings.recording.preferredInputUid
    ? (currentInput?.name ?? t.settings.inputLastUsed)
    : t.settings.inputOsDefault;

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}>
      <Header title={t.settings.title} onBack={() => router.back()} />

      <Eyebrow>{t.settings.languageEyebrow}</Eyebrow>
      <View style={st.chips}>
        {LANGUAGES.map((v) => (
          <Chip
            key={v}
            label={t.settings.language[v]}
            active={settings.language === v}
            onPress={() => set('language', v)}
          />
        ))}
      </View>
      <Text style={[st.note, { color: c.ink3 }]}>{t.settings.languageNote}</Text>

      <Eyebrow>{t.settings.appearanceEyebrow}</Eyebrow>
      <View style={st.chips}>
        {THEMES.map((v) => (
          <Chip
            key={v}
            label={t.settings.theme[v]}
            active={settings.theme === v}
            onPress={() => set('theme', v)}
          />
        ))}
      </View>
      {settings.theme !== services.settings.theme ? (
        <Text style={[st.note, { color: c.ink3 }]}>{t.settings.themeNote}</Text>
      ) : null}

      <Eyebrow>{t.settings.recordingEyebrow}</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        <Row
          label={t.settings.quality}
          sub={t.settings.qualitySub}
          right={
            <View style={st.chipsInline}>
              {[44100, 48000].map((sr) => (
                <Chip
                  key={sr}
                  label={`${sr / 1000} kHz`}
                  active={settings.recording.sampleRate === sr}
                  onPress={() => setRec({ sampleRate: sr })}
                />
              ))}
            </View>
          }
        />
        <Row
          label={t.settings.channels}
          sub={t.settings.channelsSub}
          right={
            <View style={st.chipsInline}>
              <Chip
                label={t.settings.mono}
                active={settings.recording.channels === 1}
                onPress={() => setRec({ channels: 1 })}
              />
              <Chip
                label={t.settings.stereo}
                active={settings.recording.channels === 2}
                onPress={() => setRec({ channels: 2 })}
              />
            </View>
          }
        />
        <Row label={t.settings.inputDefault} sub={inputLabel} onPress={() => setSheet('input')} />
        {currentInput?.lowQuality ? (
          <Text style={[st.warn, { color: c.mistake }]}>{t.settings.bluetoothWarning}</Text>
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
          right={
            <View style={st.chipsInline}>
              {MINUTES.map((m) => (
                <Chip
                  key={m}
                  label={t.settings.minutes(m)}
                  active={settings.recording.expectedMinutes === m}
                  onPress={() => setRec({ expectedMinutes: m })}
                />
              ))}
            </View>
          }
        />
        {Platform.OS === 'android' ? (
          <Row
            label={t.settings.androidSource}
            sub={t.settings.sources[settings.recording.androidAudioSource].label}
            onPress={() => setSheet('source')}
          />
        ) : null}
      </Card>

      <Eyebrow>{t.settings.editingEyebrow}</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        <Row
          label={t.settings.silenceLength}
          sub={t.settings.silenceLengthSub}
          right={
            <View style={st.chipsInline}>
              {SILENCE_LEN.map((ms) => (
                <Chip
                  key={ms}
                  label={t.settings.seconds((ms / 1000).toFixed(1))}
                  active={settings.silence.minDurationMs === ms}
                  onPress={() => setSilence({ minDurationMs: ms })}
                />
              ))}
            </View>
          }
        />
        <Row
          label={t.settings.silenceThreshold}
          sub={t.settings.silenceThresholdSub}
          right={
            <View style={st.chipsInline}>
              {SILENCE_DB.map((dbv) => (
                <Chip
                  key={dbv}
                  label={`${dbv} dB`}
                  active={settings.silence.thresholdDb === dbv}
                  onPress={() => setSilence({ thresholdDb: dbv })}
                />
              ))}
            </View>
          }
        />
        <Row
          label={t.settings.silencePad}
          sub={t.settings.silencePadSub}
          right={
            <View style={st.chipsInline}>
              {SILENCE_PAD.map((ms) => (
                <Chip
                  key={ms}
                  label={`${ms} ms`}
                  active={settings.silence.padMs === ms}
                  onPress={() => setSilence({ padMs: ms })}
                />
              ))}
            </View>
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
        <Row
          label={t.settings.monitorRow}
          sub={t.settings.monitor[settings.monitor.jinglePlayback].label}
          onPress={() => setSheet('monitor')}
        />
      </Card>

      <Eyebrow>{t.settings.exportEyebrow}</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        <Row
          label={t.settings.defaultPreset}
          sub={t.settings.presets[settings.export.defaultPreset].sub}
          onPress={() => setSheet('preset')}
        />
      </Card>

      <Eyebrow>{t.settings.showEyebrow}</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        <Row
          label={t.settings.showSettings}
          sub={t.settings.showSettingsSub}
          onPress={() => router.push('/show/settings')}
        />
        <Row
          label={t.settings.showAssets}
          sub={t.settings.showAssetsSub}
          onPress={() => router.push('/show/assets')}
        />
      </Card>

      <Eyebrow>{t.settings.storageEyebrow}</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        <Row
          label={t.settings.recordingsSize}
          sub={t.settings.recordingsSizeSub}
          right={<Text style={{ color: c.ink }}>{formatBytes(data.storage.recordingsBytes)}</Text>}
        />
        <Row
          label={t.settings.exportsSize}
          right={<Text style={{ color: c.ink }}>{formatBytes(data.storage.exportsBytes)}</Text>}
        />
        <Row
          label={t.settings.freeSpace}
          right={<Text style={{ color: c.ink }}>{formatBytes(data.freeBytes)}</Text>}
        />
        <Row
          label={t.settings.cleanup}
          sub={t.settings.cleanupSub(formatBytes(data.storage.exportedEpisodesRecordingsBytes))}
          onPress={() => showToast({ text: t.settings.cleanupToast })}
        />
      </Card>

      <Text style={[st.version, { color: c.ink3 }]}>
        {t.app.versionLine(APP_VERSION)}
        {'\n'}
        {t.app.nonDestructiveNote}
      </Text>

      <Sheet
        visible={sheet === 'input'}
        onClose={() => setSheet(null)}
        title={t.settings.inputDefault}
      >
        <Row
          label={t.settings.inputOsDefault}
          sub={t.settings.inputOsDefaultSub}
          onPress={() => {
            setSheet(null);
            void setRec({ preferredInputUid: null });
          }}
        />
        {data.inputs.map((i) => (
          <Row
            key={i.uid}
            label={i.name}
            sub={`${i.type}${i.lowQuality ? t.settings.lowQualitySuffix : ''}`}
            onPress={() => {
              setSheet(null);
              void setRec({ preferredInputUid: i.uid });
            }}
          />
        ))}
        {data.inputs.length === 0 ? (
          <Text style={{ color: c.ink3, paddingVertical: 12 }}>{t.settings.noInputs}</Text>
        ) : null}
      </Sheet>

      <Sheet
        visible={sheet === 'source'}
        onClose={() => setSheet(null)}
        title={t.settings.androidSource}
      >
        {SOURCES.map((v) => (
          <Row
            key={v}
            label={t.settings.sources[v].label}
            sub={t.settings.sources[v].sub}
            onPress={() => {
              setSheet(null);
              void setRec({ androidAudioSource: v });
            }}
          />
        ))}
      </Sheet>

      <Sheet
        visible={sheet === 'preset'}
        onClose={() => setSheet(null)}
        title={t.settings.defaultPresetSheet}
      >
        {PRESETS.map((v) => (
          <Row
            key={v}
            label={t.settings.presets[v].label}
            sub={t.settings.presets[v].sub}
            onPress={() => {
              setSheet(null);
              void set('export', { defaultPreset: v });
            }}
          />
        ))}
      </Sheet>

      <Sheet
        visible={sheet === 'monitor'}
        onClose={() => setSheet(null)}
        title={t.settings.monitorRow}
      >
        {MONITOR.map((v) => (
          <Row
            key={v}
            label={t.settings.monitor[v].label}
            sub={t.settings.monitor[v].sub}
            onPress={() => {
              setSheet(null);
              void set('monitor', { jinglePlayback: v });
            }}
          />
        ))}
      </Sheet>
    </Screen>
  );
}

const st = StyleSheet.create({
  chips: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  chipsInline: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    maxWidth: 190,
  },
  note: { fontSize: 11, marginTop: 6 },
  warn: { fontSize: 12, lineHeight: 18, paddingVertical: 8 },
  version: { fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 24 },
});
