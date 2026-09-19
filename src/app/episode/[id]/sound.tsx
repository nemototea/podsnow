import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useServices } from '@/features/app/ServicesProvider';
import { useEpisode } from '@/features/episode/useEpisode';
import { parseSoundSettings, type SoundSettings } from '@/services/audio/renderDocumentFromDb';
import { Button, Card, Chip, Eyebrow, Header, Loading, Row, Screen, Toggle } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';

function Stepper({
  label,
  value,
  unit,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const c = useAppTheme();
  return (
    <View style={[st.stepper, { borderBottomColor: c.line }]}>
      <Text style={{ color: c.ink, flex: 1, fontSize: 15 }}>{label}</Text>
      <Pressable
        onPress={() => onChange(Math.max(min, +(value - step).toFixed(2)))}
        style={[st.stepBtn, { borderColor: c.line }]}
        accessibilityRole="button"
        accessibilityLabel={`${label} を下げる`}
      >
        <Text style={{ color: c.ink, fontSize: 18 }}>−</Text>
      </Pressable>
      <Text style={[st.stepVal, { color: c.ink }]}>
        {value} {unit}
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(max, +(value + step).toFixed(2)))}
        style={[st.stepBtn, { borderColor: c.line }]}
        accessibilityRole="button"
        accessibilityLabel={`${label} を上げる`}
      >
        <Text style={{ color: c.ink, fontSize: 18 }}>＋</Text>
      </Pressable>
    </View>
  );
}

/** 音の仕上げ（FR-SND-1, FR-SND-2）: episodes.sound_settings を編集する。 */
export default function SoundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const episodeId = id ?? '';
  const c = useAppTheme();
  const router = useRouter();
  const { episodes } = useServices();
  const { episode } = useEpisode(episodeId);
  const [sound, setSound] = useState<SoundSettings | null>(null);
  const [adv, setAdv] = useState(false);

  useEffect(() => {
    if (!episode || sound) return;
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) setSound(parseSoundSettings(episode.sound_settings));
    });
    return () => {
      alive = false;
    };
  }, [episode, sound]);

  const update = useCallback(
    (next: SoundSettings) => {
      setSound(next);
      void episodes.update(episodeId, { soundSettings: JSON.stringify(next) });
    },
    [episodeId, episodes],
  );

  if (!episode || !sound) return <Loading label="読み込んでいます" />;

  const setLoudness = (p: Partial<SoundSettings['loudness']>) =>
    update({ ...sound, loudness: { ...sound.loudness, ...p } });
  const setDucking = (p: Partial<SoundSettings['ducking']>) =>
    update({ ...sound, ducking: { ...sound.ducking, ...p } });

  return (
    <Screen>
      <Header
        title="音の仕上げ"
        subtitle={`Episode #${episode.episode_number}`}
        onBack={() => router.back()}
      />

      <Card>
        <Row
          label="ラウドネス正規化"
          sub="全体の音量をポッドキャストの標準に揃えます"
          right={
            <Toggle value={sound.loudness.enabled} onChange={(v) => setLoudness({ enabled: v })} />
          }
        />
        {sound.loudness.enabled ? (
          <>
            <Eyebrow>目標ラウドネス</Eyebrow>
            <View style={st.chips}>
              {[-14, -16, -18].map((v) => (
                <Chip
                  key={v}
                  label={`${v} LUFS${v === -16 ? '（推奨）' : ''}`}
                  active={sound.loudness.targetLufs === v}
                  onPress={() => setLoudness({ targetLufs: v })}
                />
              ))}
            </View>
            <Stepper
              label="トゥルーピーク上限"
              value={sound.loudness.truePeakDbtp}
              unit="dBTP"
              step={0.5}
              min={-3}
              max={0}
              onChange={(v) => setLoudness({ truePeakDbtp: v })}
            />
          </>
        ) : null}
      </Card>

      <Card>
        <Row
          label="BGM ダッキング"
          sub="しゃべっている間は BGM の音量を下げます"
          right={
            <Toggle value={sound.ducking.enabled} onChange={(v) => setDucking({ enabled: v })} />
          }
        />
        <Pressable
          onPress={() => setAdv((a) => !a)}
          style={st.advToggle}
          accessibilityRole="button"
          accessibilityLabel="詳細設定"
        >
          <Text style={{ color: c.ink2, fontSize: 13 }}>詳細設定（Advanced）</Text>
          <Text style={{ color: c.ink2 }}>{adv ? '▲' : '▼'}</Text>
        </Pressable>
        {adv ? (
          <>
            <Stepper
              label="下げ幅"
              value={sound.ducking.depthDb}
              unit="dB"
              step={1}
              min={-30}
              max={0}
              onChange={(v) => setDucking({ depthDb: v })}
            />
            <Stepper
              label="アタック"
              value={sound.ducking.attackMs}
              unit="ms"
              step={10}
              min={0}
              max={500}
              onChange={(v) => setDucking({ attackMs: v })}
            />
            <Stepper
              label="リリース"
              value={sound.ducking.releaseMs}
              unit="ms"
              step={50}
              min={0}
              max={3000}
              onChange={(v) => setDucking({ releaseMs: v })}
            />
            <Stepper
              label="声のしきい値"
              value={sound.ducking.thresholdDb}
              unit="dBFS"
              step={2}
              min={-70}
              max={-10}
              onChange={(v) => setDucking({ thresholdDb: v })}
            />
          </>
        ) : null}
      </Card>

      <Text style={{ color: c.ink3, fontSize: 12, lineHeight: 18, marginBottom: 16 }}>
        設定は書き出し時に適用されます。元の録音は変更されません。
      </Text>
      <Button
        label="次へ：書き出し"
        onPress={() => router.push(`/episode/${episodeId}/export` as never)}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepVal: { minWidth: 84, textAlign: 'center', fontVariant: ['tabular-nums'] },
  advToggle: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
});
