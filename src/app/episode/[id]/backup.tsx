import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useServices } from '@/features/app/ServicesProvider';
import { useT } from '@/i18n';
import { expoFsPort } from '@/infra/files/expoFsPort';
import { joinRoot, relPaths } from '@/infra/files/layout';
import {
  backupFileName,
  exportEpisodeBackup,
  type BackupProgress,
} from '@/services/backup/BackupService';
import { radius, space, typography } from '@/ui/tokens';
import { Button, Card, Header, Screen, Toast } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

type Phase = 'idle' | 'running' | 'done' | 'error';

/** エピソードのバックアップ（.podsnow）を作成して共有する（Issue #48）。 */
export default function BackupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useAppTheme();
  const t = useT();
  const services = useServices();
  const { toast, show: showToast, act, dismiss } = useToast();
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [result, setResult] = useState<{
    path: string;
    bytes: number;
    missingFiles: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setPhase('running');
    setError(null);
    try {
      const ep = await services.episodes.get(id);
      if (!ep) throw new Error(t.backup.episodeNotFound);
      const name = backupFileName(ep.episode_number, ep.title, new Date(services.now()));
      const out = joinRoot(services.root, `${relPaths.tmp()}/${name}`);
      const r = await exportEpisodeBackup(
        {
          db: services.db,
          fs: expoFsPort,
          root: services.root,
          newId: services.newId,
          now: services.now,
        },
        id,
        out,
        (p) => setProgress(p),
      );
      setResult(r);
      setPhase('done');
      if (r.missingFiles.length) showToast({ text: t.backup.skipped(r.missingFiles.length) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  const share = async () => {
    if (!result) return;
    if (!(await Sharing.isAvailableAsync())) {
      showToast({ text: t.common.shareUnavailable });
      return;
    }
    await Sharing.shareAsync(`file://${result.path}`, {
      mimeType: 'application/zip',
      dialogTitle: t.backup.dialogTitle,
    });
  };

  const mb = result ? (result.bytes / 1048576).toFixed(1) : null;
  const pct = progress ? Math.round(progress.progress * 100) : 0;

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}>
      <Header title={t.backup.title} subtitle={t.backup.subtitle} onBack={() => router.back()} />
      <Card>
        <Text style={[st.body, { color: c.textSecondary }]}>{t.backup.lead}</Text>
        {phase === 'idle' || phase === 'error' ? (
          <Button label={t.backup.run} onPress={() => void run()} />
        ) : null}
        {phase === 'running' ? (
          <View>
            <Text style={{ color: c.textPrimary, marginBottom: space.sm }}>
              {progress?.phase === 'zip' ? t.backup.phaseWriting : t.backup.phasePreparing}… {pct}%
            </Text>
            <View style={[st.track, { backgroundColor: c.surfaceRaised }]}>
              <View style={[st.fill, { width: `${pct}%`, backgroundColor: c.accentSolid }]} />
            </View>
            {progress?.detail ? (
              <Text
                style={[typography.caption, { color: c.textTertiary, marginTop: space.xs }]}
                numberOfLines={1}
              >
                {progress.detail}
              </Text>
            ) : null}
          </View>
        ) : null}
        {phase === 'done' && result ? (
          <View>
            <Text style={[typography.bodyStrong, { color: c.textPrimary, marginBottom: space.xs }]}>
              {t.backup.done(mb ?? '0')}
            </Text>
            <Text
              style={[typography.caption, { color: c.textTertiary, marginBottom: space.md }]}
              numberOfLines={2}
            >
              {result.path.split('/').pop()}
            </Text>
            <Button label={t.backup.shareSave} onPress={() => void share()} />
            <Button
              label={t.backup.again}
              kind="ghost"
              onPress={() => void run()}
              style={{ marginTop: space.sm }}
            />
          </View>
        ) : null}
        {error ? (
          <Text style={[typography.body, { color: c.dangerText, marginTop: space.md }]}>
            {error}
          </Text>
        ) : null}
      </Card>
      <Text style={[typography.caption, { color: c.textTertiary }]}>{t.backup.footer}</Text>
    </Screen>
  );
}

const st = StyleSheet.create({
  body: { ...typography.body, marginBottom: space.lg },
  track: { height: space.sm, borderRadius: radius.xs, overflow: 'hidden' },
  fill: { height: space.sm },
});
