import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { EditTab } from '@/features/episode/EditTab';
import { ExportTab } from '@/features/episode/ExportTab';
import { playMonitor } from '@/features/episode/monitor';
import { RecordTab } from '@/features/episode/RecordTab';
import { useWorkspace } from '@/features/episode/useWorkspace';
import { errorCodeText, errorText, useT } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import { glyphSlop, gutter, icon, radius, space, typography } from '@/ui/tokens';
import { Button, Header, Loading, Row, Screen, Segmented, Sheet, Toast } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

type Tab = 'record' | 'edit' | 'export';

/**
 * エピソードの作業画面。録音 / 編集 / 書き出し の 3 タブを 1 画面に持つ
 * （REQUIREMENTS.md FR-EP-5、docs/ux-restructure.md §3）。
 * 工程ごとに画面を分けない。同じエピソードの中で切り替わるだけにする。
 */
export default function EpisodeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const episodeId = id ?? '';
  const c = useAppTheme();
  const t = useT();
  const router = useRouter();
  const services = useServices();
  const ws = useWorkspace(episodeId);
  const { state } = ws;
  const { toast, show: showToast, act, dismiss } = useToast();
  const [tab, setTab] = useState<Tab>('record');
  const [menu, setMenu] = useState(false);
  const [retake, setRetake] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRec = state.recording === 'recording' || state.recording === 'paused';
  const interrupted = state.recording === 'interrupted';

  const toast1 = useCallback(
    (text: string, undo?: () => void) =>
      showToast(undo ? { text, action: t.common.undo, onAction: undo } : { text }),
    [showToast, t],
  );

  useEffect(() => {
    const subs = [
      services.recording.on('error', (e) =>
        setError(e.code ? errorCodeText(t, e.code) : e.message),
      ),
      services.recording.on('diskLow', () => showToast({ text: t.record.diskLow })),
      services.recording.on('interruption', (e) => {
        if (e.type === 'began') showToast({ text: t.record.interrupted });
      }),
      services.recording.on('routeChange', (e) => {
        if (e.reason === 'old_device_unavailable')
          showToast({ text: t.record.routeChanged(e.currentInput?.name ?? t.record.builtInMic) });
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [services.recording, showToast, t]);

  const toggleRec = useCallback(async () => {
    try {
      if (isRec) {
        const r = await ws.stopRecording();
        if (r) showToast({ text: t.record.takeAdded(formatSmp(smp(r.durationSmp))) });
        return;
      }
      if (interrupted) {
        await ws.resumeAfterInterruption();
        return;
      }
      setTab('record');
      await ws.startRecording();
      showToast({ text: t.record.started });
    } catch (e) {
      setError(errorText(t, e));
    }
  }, [interrupted, isRec, showToast, t, ws]);

  /** 言い直す（FR-REC-4）。捨てた分はトーストの「取り消す」で戻せる。 */
  const applyRetake = useCallback(
    (mode: 'chapter' | 'last10') => {
      const dropped = ws.retake(mode);
      if (dropped === null) {
        showToast({ text: t.record.retakeNothing });
        return;
      }
      toast1(t.record.retakeDone(formatSmp(dropped, { tenths: true })), () => {
        ws.undoRetake();
      });
    },
    [showToast, t, toast1, ws],
  );

  const insertAsset = useCallback(
    async (a: AssetRow) => {
      if (isRec) {
        await ws.insertAsset(a, 'recording');
        const mode = services.settings.monitor.jinglePlayback;
        const speaker = await services.recorder.isSpeakerOutput().catch(() => true);
        if (mode === 'always' || (mode === 'headphonesOnly' && !speaker)) {
          try {
            playMonitor(services.root, a.path);
          } catch {
            /* モニター再生の失敗は挿入結果に影響しない */
          }
          showToast({ text: t.record.inserted(a.name) });
        } else {
          showToast({ text: t.record.insertedNoMonitor(a.name) });
        }
        return;
      }
      await ws.insertAsset(a, 'playhead');
      toast1(t.record.insertedAt(a.name, formatSmp(state.playhead)), () => void ws.undo());
    },
    [isRec, services, showToast, state.playhead, t, toast1, ws],
  );

  if (!state.ready || !state.episode) return <Loading label={t.common.loading} />;

  const episode = state.episode;
  const bottomBar =
    tab === 'export' ? null : (
      <View style={[st.bar, { borderTopColor: c.border }]}>
        {tab === 'record' ? (
          <>
            <Pressable
              onPress={() => setRetake(true)}
              disabled={!isRec}
              style={[st.side, { opacity: isRec ? 1 : 0.35 }]}
              accessibilityLabel={t.record.retake}
            >
              <Text style={{ color: c.textPrimary, fontSize: icon.md }}>↺</Text>
              <Text style={[typography.overline, { color: c.textSecondary }]}>
                {t.record.retake}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void toggleRec()}
              accessibilityLabel={isRec ? t.a11y.stopRecording : t.a11y.startRecording}
              style={[
                st.recBtn,
                { backgroundColor: isRec ? c.surface : c.recSolid, borderColor: c.recSolid },
              ]}
            >
              <View
                style={
                  isRec
                    ? [st.recStop, { backgroundColor: c.recSolid }]
                    : [st.recDot, { backgroundColor: c.dangerOnSolid }]
                }
              />
            </Pressable>
            <Pressable
              onPress={() =>
                void (state.recording === 'paused' ? ws.resumeRecording() : ws.pauseRecording())
              }
              disabled={!isRec}
              style={[st.side, { opacity: isRec ? 1 : 0.35 }]}
              accessibilityLabel={state.recording === 'paused' ? t.record.resume : t.record.pause}
            >
              <Text style={{ color: c.textPrimary, fontSize: icon.md }}>
                {state.recording === 'paused' ? '▶' : '❚❚'}
              </Text>
              <Text style={[typography.overline, { color: c.textSecondary }]}>
                {state.recording === 'paused' ? t.record.resume : t.record.pause}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => void ws.undo().then((op) => op && toast1(t.undo.undid(op.label)))}
              disabled={!state.canUndo}
              style={[st.side, { opacity: state.canUndo ? 1 : 0.35 }]}
              accessibilityLabel={t.common.undo}
            >
              <Text style={{ color: c.textPrimary, fontSize: icon.md }}>↶</Text>
              <Text style={[typography.overline, { color: c.textSecondary }]}>{t.common.undo}</Text>
            </Pressable>
            <Pressable
              onPress={() => void ws.togglePlay()}
              disabled={state.total === 0}
              style={[st.playBtn, { borderColor: c.border, opacity: state.total ? 1 : 0.35 }]}
              accessibilityLabel={state.playing ? t.a11y.pause : t.a11y.play}
            >
              <Text style={{ color: c.textPrimary, fontSize: icon.sm }}>
                {state.playing ? '❚❚' : '▶'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void ws.redo().then((op) => op && toast1(t.undo.redid(op.label)))}
              disabled={!state.canRedo}
              style={[st.side, { opacity: state.canRedo ? 1 : 0.35 }]}
              accessibilityLabel={t.common.redo}
            >
              <Text style={{ color: c.textPrimary, fontSize: icon.md }}>↷</Text>
              <Text style={[typography.overline, { color: c.textSecondary }]}>{t.common.redo}</Text>
            </Pressable>
          </>
        )}
      </View>
    );

  return (
    <Screen
      overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}
      {...(bottomBar ? { bottomBar } : {})}
    >
      <Header
        title={`#${episode.episode_number} ${episode.title || t.episode.untitled}`}
        subtitle={
          isRec
            ? t.record.subtitleRecording
            : interrupted
              ? t.record.subtitleInterrupted
              : t.record.subtitleSaved
        }
        onBack={() => (isRec ? showToast({ text: t.record.cannotLeave }) : router.back())}
        right={
          <Pressable
            onPress={() => setMenu(true)}
            hitSlop={glyphSlop}
            accessibilityLabel={t.a11y.menu}
            accessibilityRole="button"
          >
            <Text style={{ color: c.textSecondary, fontSize: icon.md }}>⋮</Text>
          </Pressable>
        }
      />

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'record', label: t.episode.tabs.record },
          { value: 'edit', label: t.episode.tabs.edit },
          { value: 'export', label: t.episode.tabs.export },
        ]}
      />

      {tab === 'record' ? (
        <RecordTab
          ws={ws}
          onInsertAsset={(a) => void insertAsset(a)}
          onOpenAssets={() => router.push('/show')}
          onShowToast={(text) => showToast({ text })}
        />
      ) : tab === 'edit' ? (
        <EditTab
          ws={ws}
          onInsertAsset={(a) => void insertAsset(a)}
          onOpenAssets={() => router.push('/show')}
          onShowToast={toast1}
          onError={setError}
        />
      ) : (
        <ExportTab
          ws={ws}
          onShowToast={toast1}
          onDone={(exportId) =>
            router.push(`/episode/${episodeId}/share?exportId=${exportId}` as never)
          }
        />
      )}

      {/* 言い直す（FR-REC-4）: 直近の範囲を捨てて録音を続ける */}
      <Sheet
        visible={retake}
        onClose={() => setRetake(false)}
        title={t.record.retakeTitle}
        subtitle={t.record.retakeSubtitle}
      >
        <Row
          label={t.record.retakeFromChapter}
          sub={t.record.retakeFromChapterSub}
          onPress={() => {
            setRetake(false);
            applyRetake('chapter');
          }}
        />
        <Row
          label={t.record.retakeLast10}
          sub={t.record.retakeLast10Sub}
          onPress={() => {
            setRetake(false);
            applyRetake('last10');
          }}
        />
      </Sheet>

      <Sheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={episode.title || t.episode.untitled}
      >
        <Row
          label={t.episode.menu.backup}
          onPress={() => {
            setMenu(false);
            router.push(`/episode/${episodeId}/backup` as never);
          }}
        />
        <Row
          label={t.episode.menu.duplicate}
          onPress={() => {
            setMenu(false);
            void services.episodes.duplicate(episodeId).then((d) =>
              showToast({
                text: t.episode.duplicated(d.episode_number),
                action: t.common.open,
                onAction: () => router.push(`/episode/${d.id}` as never),
              }),
            );
          }}
        />
        <Row
          label={t.episode.menu.remove}
          sub={
            episode.status === 'exported'
              ? t.episode.menu.removeExportedNote(episode.episode_number)
              : t.episode.menu.removeSub
          }
          danger
          onPress={() => {
            setMenu(false);
            void services.episodes.remove(episodeId).then(() => router.back());
          }}
        />
      </Sheet>

      <Sheet visible={!!error} onClose={() => setError(null)} title={t.common.error}>
        <Text style={{ color: c.textPrimary, lineHeight: 20 }}>{error}</Text>
        <Button
          label={t.common.close}
          kind="secondary"
          onPress={() => setError(null)}
          style={{ marginTop: space.md }}
        />
      </Sheet>
    </Screen>
  );
}

const st = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingVertical: space.md,
    paddingHorizontal: gutter,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  side: { alignItems: 'center', width: 72, minHeight: 44, justifyContent: 'center' },
  recBtn: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recDot: { width: 26, height: 26, borderRadius: radius.pill },
  recStop: { width: 24, height: 24, borderRadius: radius.xs },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
