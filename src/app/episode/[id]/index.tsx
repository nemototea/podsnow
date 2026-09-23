import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { formatSmp, smp, type Smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { EditTab } from '@/features/episode/EditTab';
import { ExportTab } from '@/features/episode/ExportTab';
import { playMonitor } from '@/features/episode/monitor';
import { RecordTab } from '@/features/episode/RecordTab';
import { Transport } from '@/features/episode/Transport';
import { useRecordingContext } from '@/features/episode/useRecordingContext';
import { useWorkspace } from '@/features/episode/useWorkspace';
import { errorCodeText, errorText, useT } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import { space, typography } from '@/ui/tokens';
import {
  Button,
  Header,
  IconButton,
  Loading,
  Row,
  Screen,
  Segmented,
  Sheet,
  Text,
  Toast,
} from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

type Tab = 'record' | 'edit' | 'export';
type Permission = null | 'ask' | 'denied';

export default function EpisodeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const episodeId = id ?? '';
  const c = useAppTheme();
  const t = useT();
  const router = useRouter();
  const services = useServices();
  const ws = useWorkspace(episodeId);
  const { state } = ws;
  const recCtx = useRecordingContext(state.recording);
  const { toast, show: showToast, act, dismiss } = useToast();
  const [tab, setTab] = useState<Tab>('record');
  const [menu, setMenu] = useState(false);
  const [retake, setRetake] = useState(false);
  const [permission, setPermission] = useState<Permission>(null);
  const [error, setError] = useState<string | null>(null);
  const undoToastFor = useRef<string | null>(null);

  const isRec = state.recording === 'recording' || state.recording === 'paused';
  const interrupted = state.recording === 'interrupted';
  const busy = state.recording === 'preparing' || state.recording === 'stopping';
  const live = isRec || interrupted || busy;

  const toast1 = useCallback(
    (text: string, undo?: () => void) => {
      if (!undo) {
        undoToastFor.current = null;
        showToast({ text });
        return;
      }
      const top = ws.undoTopRef.current;
      undoToastFor.current = top;
      showToast({
        text,
        action: t.common.undo,
        onAction: () => {
          if (ws.undoTopRef.current === top) undo();
        },
      });
    },
    [showToast, t, ws.undoTopRef],
  );

  useEffect(() => {
    if (undoToastFor.current !== null && undoToastFor.current !== state.undoTopId) {
      undoToastFor.current = null;
      dismiss();
    }
  }, [dismiss, state.undoTopId]);

  useEffect(() => {
    const subs = [
      services.recording.on('error', (e) =>
        setError(e.code ? errorCodeText(t, e.code) : e.message),
      ),
      services.recording.on('diskLow', () => showToast({ text: t.record.diskLow, persist: true })),
      services.recording.on('interruption', (e) => {
        if (e.type === 'began') showToast({ text: t.record.interrupted, persist: true });
      }),
      services.recording.on('routeChange', (e) => {
        if (e.reason === 'old_device_unavailable')
          showToast({
            text: t.record.routeChanged(e.currentInput?.name ?? t.record.builtInMic),
            persist: true,
          });
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [services.recording, showToast, t]);

  const start = useCallback(async () => {
    try {
      setTab('record');
      await ws.startRecording();
    } catch (e) {
      setError(errorText(t, e));
    }
  }, [t, ws]);

  const requestAndStart = useCallback(async () => {
    setPermission(null);
    const r = await services.recorder.requestPermissions().catch(() => null);
    if (r?.microphone === 'granted') await start();
    else setPermission('denied');
  }, [services.recorder, start]);

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
      const perm = await services.recorder.getPermissions().catch(() => null);
      const mic = perm?.microphone ?? 'granted';
      if (mic === 'undetermined') {
        setPermission('ask');
        return;
      }
      if (mic === 'denied') {
        if (Platform.OS === 'android') void requestAndStart();
        else setPermission('denied');
        return;
      }
      await start();
    } catch (e) {
      setError(errorText(t, e));
    }
  }, [interrupted, isRec, requestAndStart, services.recorder, showToast, start, t, ws]);

  const finishFromInterruption = useCallback(async () => {
    try {
      const r = await ws.stopRecording();
      if (r) showToast({ text: t.record.takeAdded(formatSmp(smp(r.durationSmp))) });
    } catch (e) {
      setError(errorText(t, e));
    }
  }, [showToast, t, ws]);

  const applyRetake = useCallback(
    (mode: 'chapter' | 'last10') => {
      const dropped = ws.retake(mode);
      if (dropped === null) {
        showToast({ text: t.record.retakeNothing });
        return;
      }
      undoToastFor.current = null;
      showToast({
        text: t.record.retakeDone(formatSmp(dropped, { tenths: true })),
        action: t.common.undo,
        onAction: () => void ws.undoRetake(),
      });
    },
    [showToast, t, ws],
  );

  const insertAsset = useCallback(
    async (a: AssetRow, at?: Smp) => {
      if (isRec) {
        await ws.insertAsset(a, 'recording');
        const mode = services.settings.monitor.jinglePlayback;
        const speaker = await services.recorder.isSpeakerOutput().catch(() => true);
        if (mode === 'always' || (mode === 'headphonesOnly' && !speaker)) {
          try {
            playMonitor(services.root, a.path);
          } catch {
            void 0;
          }
          showToast({ text: t.record.inserted(a.name) });
        } else {
          showToast({ text: t.record.insertedNoMonitor(a.name) });
        }
        return;
      }
      const where = at ?? state.playhead;
      await ws.insertAsset(a, where);
      toast1(t.record.insertedAt(a.name, formatSmp(where)), () => void ws.undo());
    },
    [isRec, services, showToast, state.playhead, t, toast1, ws],
  );

  const changeTab = (next: Tab) => {
    if (live && next !== 'record') {
      showToast({ text: t.record.finishFirst });
      return;
    }
    setTab(next);
  };

  if (!state.ready || !state.episode) return <Loading label={t.common.loadingEpisode} />;

  const episode = state.episode;

  return (
    <Screen
      overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}
      {...(tab === 'export'
        ? {}
        : {
            bottomBar: (
              <Transport
                tab={tab}
                ws={ws}
                recCtx={recCtx}
                onToggleRec={() => void toggleRec()}
                onFinishInterrupted={() => void finishFromInterruption()}
                onRetake={() => setRetake(true)}
              />
            ),
          })}
    >
      <Header
        title={t.episode.number(episode.episode_number)}
        subtitle={episode.title || t.episode.untitled}
        onBack={() => (live ? showToast({ text: t.record.cannotLeave }) : router.back())}
        right={
          <IconButton
            name="more"
            label={t.episode.a11yMenu}
            onPress={() => setMenu(true)}
            disabled={live}
          />
        }
      />

      <View style={st.tabs}>
        <Segmented
          value={tab}
          onChange={changeTab}
          disabled={() => live}
          options={[
            { value: 'record', label: t.episode.tabs.record },
            { value: 'edit', label: t.episode.tabs.edit },
            { value: 'export', label: t.episode.tabs.export },
          ]}
        />
      </View>

      {tab === 'record' ? (
        <RecordTab
          ws={ws}
          recCtx={recCtx}
          onInsertAsset={(a) => void insertAsset(a)}
          onOpenAssets={() => router.push('/show')}
          onShowToast={(text) => showToast({ text })}
        />
      ) : tab === 'edit' ? (
        <EditTab
          ws={ws}
          onInsertAsset={(a, at) => void insertAsset(a, at)}
          onOpenAssets={() => router.push('/show')}
          onShowToast={toast1}
          onError={setError}
          onGoExport={() => setTab('export')}
        />
      ) : (
        <ExportTab
          ws={ws}
          onShowToast={toast1}
          onGoEdit={() => setTab('edit')}
          onDone={(exportId) =>
            router.push(`/episode/${episodeId}/share?exportId=${exportId}` as never)
          }
        />
      )}

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
          last
          onPress={() => {
            setRetake(false);
            applyRetake('last10');
          }}
        />
      </Sheet>

      <Sheet
        visible={permission !== null}
        onClose={() => setPermission(null)}
        title={permission === 'denied' ? t.record.permDeniedTitle : t.record.permTitle}
      >
        <Text style={[typography.body, { color: c.textPrimary, marginBottom: space.lg }]}>
          {permission === 'denied' ? t.record.permDeniedBody : t.record.permBody}
        </Text>
        <View style={st.sheetActions}>
          {permission === 'denied' ? (
            <Button
              label={t.common.openSettings}
              onPress={() => {
                setPermission(null);
                void Linking.openSettings();
              }}
            />
          ) : (
            <Button label={t.record.permAllow} icon="mic" onPress={() => void requestAndStart()} />
          )}
          <Button label={t.common.later} kind="ghost" onPress={() => setPermission(null)} />
        </View>
      </Sheet>

      <Sheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={episode.title || t.episode.untitled}
      >
        <Row
          icon="archive"
          label={t.episode.menu.backup}
          onPress={() => {
            setMenu(false);
            router.push(`/episode/${episodeId}/backup` as never);
          }}
        />
        <Row
          icon="copy"
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
          icon="trash"
          label={t.episode.menu.remove}
          sub={
            episode.status === 'exported'
              ? t.episode.menu.removeExportedNote(episode.episode_number)
              : t.episode.menu.removeSub
          }
          danger
          last
          onPress={() => {
            setMenu(false);
            void services.episodes.remove(episodeId).then(() => router.back());
          }}
        />
      </Sheet>

      <Sheet visible={!!error} onClose={() => setError(null)} title={t.common.error}>
        <Text style={[typography.body, { color: c.textPrimary }]}>{error}</Text>
        <Button
          label={t.common.close}
          kind="secondary"
          onPress={() => setError(null)}
          style={{ marginTop: space.lg }}
        />
      </Sheet>
    </Screen>
  );
}

const st = StyleSheet.create({
  tabs: { marginTop: space.xs, marginBottom: space.lg },
  sheetActions: { gap: space.sm },
});
