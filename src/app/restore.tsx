import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useServices } from '@/features/app/ServicesProvider';
import { expoFsPort } from '@/infra/files/expoFsPort';
import {
  importEpisodeBackup,
  type BackupProgress,
  type RestoreResult,
} from '@/services/backup/BackupService';
import { Button, Card, Header, Screen } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';

type Phase = 'idle' | 'running' | 'done' | 'error';

function stripScheme(uri: string): string {
  return uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
}

/** .podsnow を選んで現在の Show にエピソードを復元する（Issue #48）。 */
export default function RestoreScreen() {
  const router = useRouter();
  const c = useAppTheme();
  const services = useServices();
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    if (
      !asset.name.toLowerCase().endsWith('.podsnow') &&
      !asset.name.toLowerCase().endsWith('.zip')
    ) {
      setError('.podsnow ファイルを選んでください');
      return;
    }
    setPhase('running');
    try {
      const r = await importEpisodeBackup(
        {
          db: services.db,
          fs: expoFsPort,
          root: services.root,
          newId: services.newId,
          now: services.now,
        },
        services.show.id,
        stripScheme(asset.uri),
        (p) => setProgress(p),
      );
      setResult(r);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  const pct = progress ? Math.round(progress.progress * 100) : 0;
  const phaseLabel =
    progress?.phase === 'db'
      ? 'データベースへ書き込み中'
      : progress?.detail === 'audio'
        ? '音声を展開中'
        : '読み込み中';

  return (
    <Screen>
      <Header
        title="バックアップから復元"
        subtitle=".podsnow ファイルを新しいエピソードとして取り込みます"
        onBack={() => router.back()}
      />
      <Card>
        <Text style={[st.body, { color: c.ink2 }]}>
          復元したエピソードは現在の番組に新しい話数として追加されます。番組に同じ素材があればそれを使い、無ければ素材も取り込みます。
        </Text>
        {phase === 'idle' || phase === 'error' ? (
          <Button label="ファイルを選ぶ" onPress={() => void pick()} />
        ) : null}
        {phase === 'running' ? (
          <View>
            <Text style={{ color: c.ink, marginBottom: 8 }}>
              {phaseLabel}… {pct}%
            </Text>
            <View style={[st.track, { backgroundColor: c.panel2 }]}>
              <View style={[st.fill, { width: `${pct}%`, backgroundColor: c.accent }]} />
            </View>
          </View>
        ) : null}
        {phase === 'done' && result ? (
          <View>
            <Text style={{ color: c.ink, fontWeight: '700', marginBottom: 4 }}>
              第{result.episodeNumber}回として復元しました
            </Text>
            <Text style={{ color: c.ink2, fontSize: 12, marginBottom: 12 }}>
              テイク {result.takes} 件 · 素材 再利用 {result.reusedAssets} / 取り込み{' '}
              {result.importedAssets}
            </Text>
            <Button
              label="エピソードを開く"
              onPress={() => router.replace(`/episode/${result.episodeId}`)}
            />
          </View>
        ) : null}
        {error ? <Text style={{ color: c.rec, marginTop: 12 }}>{error}</Text> : null}
      </Card>
    </Screen>
  );
}

const st = StyleSheet.create({
  body: { lineHeight: 20, marginBottom: 14 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6 },
});
