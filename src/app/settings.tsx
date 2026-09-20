import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { APP_VERSION } from '@/domain/version';
import { useServices } from '@/features/app/ServicesProvider';
import { formatBytes, summarizeStorage, type StorageSummary } from '@/features/settings/storage';
import { useAsyncData } from '@/features/show/useAsyncData';
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

const THEME_OPTS: { v: AppSettings['theme']; label: string }[] = [
  { v: 'dark', label: 'Dark' },
  { v: 'light', label: 'Light' },
  { v: 'system', label: 'System' },
];
const MINUTES = [30, 60, 90, 120];
const SILENCE_LEN = [1000, 1500, 2000, 3000];
const SILENCE_DB = [-40, -45, -50, -55];
const SILENCE_PAD = [100, 250, 400];
const SOURCES: { v: AppSettings['recording']['androidAudioSource']; label: string; sub: string }[] =
  [
    { v: 'voice_recognition', label: '標準（推奨）', sub: 'AGC なし・軽いノイズ抑制' },
    { v: 'mic', label: 'マイク', sub: '端末の自動処理あり' },
    { v: 'unprocessed', label: '未処理', sub: '対応端末のみ。素の音' },
    { v: 'camcorder', label: 'カムコーダー', sub: '広い集音' },
  ];
const PRESETS: { v: AppSettings['export']['defaultPreset']; label: string; sub: string }[] = [
  { v: 'podcast', label: 'Podcast', sub: 'M4A 128 kbps モノラル' },
  { v: 'high', label: 'High Quality', sub: 'M4A 256 kbps ステレオ' },
  { v: 'wav', label: 'WAV', sub: '非圧縮 48 kHz' },
];
const MONITOR: { v: AppSettings['monitor']['jinglePlayback']; label: string; sub: string }[] = [
  {
    v: 'headphonesOnly',
    label: 'イヤホン接続時のみ',
    sub: 'スピーカーだと録音に回り込むため（推奨）',
  },
  { v: 'always', label: '常に再生', sub: 'スピーカー時は回り込みます' },
  { v: 'never', label: '再生しない', sub: '挿入イベントだけ記録' },
];

/** アプリ全般設定（REQUIREMENTS.md §2.9、DATA_MODEL.md §4.16）。 */
export default function SettingsScreen() {
  const c = useAppTheme();
  const router = useRouter();
  const services = useServices();
  const { db, recorder, updateSettings } = services;
  const { toast, show: showToast, act } = useToast();
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
    ? (currentInput?.name ?? '前回のデバイス（未接続）')
    : 'OS の既定';

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} />}>
      <Header title="設定" onBack={() => router.back()} />

      <Eyebrow>APPEARANCE</Eyebrow>
      <View style={st.chips}>
        {THEME_OPTS.map((o) => (
          <Chip
            key={o.v}
            label={o.label}
            active={settings.theme === o.v}
            onPress={() => set('theme', o.v)}
          />
        ))}
      </View>
      {settings.theme !== services.settings.theme ? (
        <Text style={[st.note, { color: c.ink3 }]}>テーマはすぐに反映されます。</Text>
      ) : null}

      <Eyebrow>RECORDING</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        <Row
          label="録音品質"
          sub="16 bit 非圧縮 WAV で保存します"
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
          label="チャンネル"
          sub="一人語りはモノラルでファイルが軽くなります"
          right={
            <View style={st.chipsInline}>
              <Chip
                label="モノラル"
                active={settings.recording.channels === 1}
                onPress={() => setRec({ channels: 1 })}
              />
              <Chip
                label="ステレオ"
                active={settings.recording.channels === 2}
                onPress={() => setRec({ channels: 2 })}
              />
            </View>
          }
        />
        <Row label="入力ソースの既定" sub={inputLabel} onPress={() => setSheet('input')} />
        {currentInput?.lowQuality ? (
          <Text style={[st.warn, { color: c.mistake }]}>
            Bluetooth
            マイクは通話用の帯域になり音質が大きく落ちます。可能なら内蔵・有線マイクをおすすめします。
          </Text>
        ) : null}
        <Row
          label="割り込み後に自動で再開"
          sub="着信などで止まったあと、OS が再開を推奨していれば新しい区間として続ける"
          right={
            <Toggle
              value={settings.recording.autoResumeAfterInterruption}
              onChange={(v) => setRec({ autoResumeAfterInterruption: v })}
            />
          }
        />
        <Row
          label="想定する収録時間"
          sub="録音開始前の空き容量チェックに使います"
          right={
            <View style={st.chipsInline}>
              {MINUTES.map((m) => (
                <Chip
                  key={m}
                  label={`${m}分`}
                  active={settings.recording.expectedMinutes === m}
                  onPress={() => setRec({ expectedMinutes: m })}
                />
              ))}
            </View>
          }
        />
        {Platform.OS === 'android' ? (
          <Row
            label="Android の録音ソース"
            sub={SOURCES.find((s) => s.v === settings.recording.androidAudioSource)?.label ?? ''}
            onPress={() => setSheet('source')}
          />
        ) : null}
      </Card>

      <Eyebrow>EDITING</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        <Row
          label="無音として扱う長さ"
          sub="これより長い静かな区間を「無音」とみなします"
          right={
            <View style={st.chipsInline}>
              {SILENCE_LEN.map((ms) => (
                <Chip
                  key={ms}
                  label={`${(ms / 1000).toFixed(1)}秒`}
                  active={settings.silence.minDurationMs === ms}
                  onPress={() => setSilence({ minDurationMs: ms })}
                />
              ))}
            </View>
          }
        />
        <Row
          label="無音とみなす音量"
          sub="小さいほど厳しく（-55 dB は本当の静寂のみ）"
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
          label="残す余白"
          sub="無音の前後に残す間"
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
          label="無音を自動で詰める"
          sub="オフなら削除前に件数と合計を確認します"
          right={
            <Toggle
              value={settings.silence.autoApply}
              onChange={(v) => setSilence({ autoApply: v })}
            />
          }
        />
        <Row
          label="ハプティクス"
          sub="録音開始・分割・スナップ時の振動"
          right={<Toggle value={settings.haptics} onChange={(v) => set('haptics', v)} />}
        />
        <Row
          label="ジングルのモニター再生"
          sub={MONITOR.find((m) => m.v === settings.monitor.jinglePlayback)?.label ?? ''}
          onPress={() => setSheet('monitor')}
        />
      </Card>

      <Eyebrow>EXPORT</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        <Row
          label="既定のプリセット"
          sub={PRESETS.find((p) => p.v === settings.export.defaultPreset)?.sub ?? ''}
          onPress={() => setSheet('preset')}
        />
      </Card>

      <Eyebrow>SHOW</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        <Row
          label="番組の設定"
          sub="番組名・既定構成・概要欄テンプレート"
          onPress={() => router.push('/show/settings')}
        />
        <Row
          label="Show Assets"
          sub="Opening / Ending / Jingle / BGM"
          onPress={() => router.push('/show/assets')}
        />
      </Card>

      <Eyebrow>STORAGE</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        <Row
          label="録音データ"
          sub="非圧縮の元データ（概算）"
          right={<Text style={{ color: c.ink }}>{formatBytes(data.storage.recordingsBytes)}</Text>}
        />
        <Row
          label="書き出しファイル"
          right={<Text style={{ color: c.ink }}>{formatBytes(data.storage.exportsBytes)}</Text>}
        />
        <Row
          label="端末の空き容量"
          right={<Text style={{ color: c.ink }}>{formatBytes(data.freeBytes)}</Text>}
        />
        <Row
          label="書き出し済みエピソードの元データを整理"
          sub={`${formatBytes(data.storage.exportedEpisodesRecordingsBytes)} が対象です。自動では削除しません（このバージョンでは案内のみ）`}
          onPress={() =>
            showToast({
              text: '整理機能は次のバージョンで追加予定です。エピソード単位の削除は Home のメニューから行えます。',
            })
          }
        />
      </Card>

      <Text style={[st.version, { color: c.ink3 }]}>
        podsnow {APP_VERSION} (MVP){'\n'}すべての編集は非破壊で、録音の元データは削除されません。
      </Text>

      <Sheet visible={sheet === 'input'} onClose={() => setSheet(null)} title="入力ソースの既定">
        <Row
          label="OS の既定"
          sub="接続状況に応じて自動"
          onPress={() => {
            setSheet(null);
            void setRec({ preferredInputUid: null });
          }}
        />
        {data.inputs.map((i) => (
          <Row
            key={i.uid}
            label={i.name}
            sub={`${i.type}${i.lowQuality ? ' · 音質が落ちます（通話用 Bluetooth）' : ''}`}
            onPress={() => {
              setSheet(null);
              void setRec({ preferredInputUid: i.uid });
            }}
          />
        ))}
        {data.inputs.length === 0 ? (
          <Text style={{ color: c.ink3, paddingVertical: 12 }}>
            入力デバイスを取得できませんでした（マイク権限が必要です）
          </Text>
        ) : null}
      </Sheet>

      <Sheet
        visible={sheet === 'source'}
        onClose={() => setSheet(null)}
        title="Android の録音ソース"
      >
        {SOURCES.map((s) => (
          <Row
            key={s.v}
            label={s.label}
            sub={s.sub}
            onPress={() => {
              setSheet(null);
              void setRec({ androidAudioSource: s.v });
            }}
          />
        ))}
      </Sheet>

      <Sheet
        visible={sheet === 'preset'}
        onClose={() => setSheet(null)}
        title="既定の書き出しプリセット"
      >
        {PRESETS.map((p) => (
          <Row
            key={p.v}
            label={p.label}
            sub={p.sub}
            onPress={() => {
              setSheet(null);
              void set('export', { defaultPreset: p.v });
            }}
          />
        ))}
      </Sheet>

      <Sheet
        visible={sheet === 'monitor'}
        onClose={() => setSheet(null)}
        title="ジングルのモニター再生"
      >
        {MONITOR.map((m) => (
          <Row
            key={m.v}
            label={m.label}
            sub={m.sub}
            onPress={() => {
              setSheet(null);
              void set('monitor', { jinglePlayback: m.v });
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
