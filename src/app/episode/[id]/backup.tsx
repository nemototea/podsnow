import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useServices } from '@/features/app/ServicesProvider';
import { expoFsPort } from '@/infra/files/expoFsPort';
import { joinRoot, relPaths } from '@/infra/files/layout';
import {
  backupFileName,
  exportEpisodeBackup,
  type BackupProgress,
} from '@/services/backup/BackupService';
import { Button, Card, Header, Screen, Toast } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

type Phase = 'idle' | 'running' | 'done' | 'error';

/** エピソードのバックアップ（.podsnow）を作成して共有する（Issue #48）。 */
export default function BackupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useAppTheme();
  const services = useServices();
  const { toast, show: showToast, act } = useToast();
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
      if (!ep) throw new Error('エピソードが見つかりません');
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
      if (r.missingFiles.length)
        showToast({ text: `${r.missingFiles.length} 件のファイルが見つからずスキップしました` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  const share = async () => {
    if (!result) return;
    if (!(await Sharing.isAvailableAsync())) {
      showToast({ text: 'この端末では共有できません' });
      return;
    }
    await Sharing.shareAsync(`file://${result.path}`, {
      mimeType: 'application/zip',
      dialogTitle: 'バックアップを保存',
    });
  };

  const mb = result ? (result.bytes / 1048576).toFixed(1) : null;
  const pct = progress ? Math.round(progress.progress * 100) : 0;

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} />}>
      <Header
        title="バックアップ"
        subtitle="録音素材と編集データを 1 ファイルにまとめます"
        onBack={() => router.back()}
      />
      <Card>
        <Text style={[st.body, { color: c.ink2 }]}>
          録音（WAV）・素材・タイムライン・マーカー・トークテーマを .podsnow
          ファイルに書き出します。別の端末で「バックアップから復元」すると同じエピソードを再現できます。
        </Text>
        {phase === 'idle' || phase === 'error' ? (
          <Button label="バックアップを作成" onPress={() => void run()} />
        ) : null}
        {phase === 'running' ? (
          <View>
            <Text style={{ color: c.ink, marginBottom: 8 }}>
              {progress?.phase === 'zip' ? '書き込み中' : '準備中'}… {pct}%
            </Text>
            <View style={[st.track, { backgroundColor: c.panel2 }]}>
              <View style={[st.fill, { width: `${pct}%`, backgroundColor: c.accent }]} />
            </View>
            {progress?.detail ? (
              <Text style={{ color: c.ink3, fontSize: 11, marginTop: 6 }} numberOfLines={1}>
                {progress.detail}
              </Text>
            ) : null}
          </View>
        ) : null}
        {phase === 'done' && result ? (
          <View>
            <Text style={{ color: c.ink, fontWeight: '700', marginBottom: 4 }}>
              作成しました（{mb} MB）
            </Text>
            <Text style={{ color: c.ink3, fontSize: 11, marginBottom: 12 }} numberOfLines={2}>
              {result.path.split('/').pop()}
            </Text>
            <Button label="共有・保存する" onPress={() => void share()} />
            <Button
              label="もう一度作成"
              kind="ghost"
              onPress={() => void run()}
              style={{ marginTop: 8 }}
            />
          </View>
        ) : null}
        {error ? <Text style={{ color: c.rec, marginTop: 12 }}>{error}</Text> : null}
      </Card>
      <Text style={{ color: c.ink3, fontSize: 12, lineHeight: 18 }}>
        ファイルは一時領域に作られ、共有先へ保存した後は次回起動時に整理されます。iCloud Drive /
        Google Drive などに保存すれば端末外へのバックアップになります。
      </Text>
    </Screen>
  );
}

const st = StyleSheet.create({
  body: { lineHeight: 20, marginBottom: 14 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6 },
});
