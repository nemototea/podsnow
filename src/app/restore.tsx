import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useServices } from '@/features/app/ServicesProvider';
import { errorText, useT } from '@/i18n';
import { expoFsPort } from '@/infra/files/expoFsPort';
import {
  importEpisodeBackup,
  type BackupProgress,
  type RestoreResult,
} from '@/services/backup/BackupService';
import { space, typography } from '@/ui/tokens';
import { Button, Card, Notice, ProgressBar, Screen, Text } from '@/ui/components';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { useAppTheme } from '@/ui/ThemeContext';

type Phase = 'idle' | 'running' | 'done' | 'error';

function stripScheme(uri: string): string {
  return uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
}

/** .podsnow を選んで現在の Show にエピソードを復元する（Issue #48）。 */
export default function RestoreScreen() {
  const router = useRouter();
  const c = useAppTheme();
  const t = useT();
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
      setError(t.restore.wrongExtension);
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
      setError(errorText(t, e));
      setPhase('error');
    }
  };

  const pct = progress ? Math.round(progress.progress * 100) : 0;
  const phaseLabel =
    progress?.phase === 'db'
      ? t.restore.phaseDb
      : progress?.detail === 'audio'
        ? t.restore.phaseAudio
        : t.restore.phaseReading;

  return (
    <Screen>
      <ScreenHeader title={t.restore.title} />
      <Card>
        <Text style={[st.body, { color: c.textSecondary }]}>{t.restore.lead}</Text>
        {phase === 'idle' || phase === 'error' ? (
          <Button label={t.restore.pick} icon="download" onPress={() => void pick()} />
        ) : null}
        {phase === 'running' ? (
          <View style={st.progress}>
            <Text
              style={[typography.bodyStrong, { color: c.textPrimary }]}
              accessibilityLiveRegion="polite"
            >
              {phaseLabel}
            </Text>
            <ProgressBar value={progress ? progress.progress : null} label={phaseLabel} />
            <Text style={[typography.mono, { color: c.textSecondary }]}>{pct}%</Text>
          </View>
        ) : null}
        {phase === 'done' && result ? (
          <View style={st.progress}>
            <Text style={[typography.bodyStrong, { color: c.textPrimary }]}>
              {t.restore.done(result.episodeNumber)}
            </Text>
            <Text style={[typography.caption, { color: c.textSecondary }]}>
              {t.restore.summary(result.takes, result.reusedAssets, result.importedAssets)}
            </Text>
            <Button
              label={t.restore.openEpisode}
              onPress={() => router.replace(`/episode/${result.episodeId}`)}
            />
          </View>
        ) : null}
      </Card>
      {error ? <Notice kind="error" title={t.restore.failed} body={error} /> : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  body: { ...typography.body, marginBottom: space.lg },
  progress: { gap: space.sm },
});
