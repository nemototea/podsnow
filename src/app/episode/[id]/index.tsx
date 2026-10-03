import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { isAppError } from '@/domain/errors';
import { formatSmp, smp, type Smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { ExportTab } from '@/features/episode/ExportTab';
import { playMonitor } from '@/features/episode/monitor';
import { StudioTab } from '@/features/episode/StudioTab';
import { Transport } from '@/features/episode/Transport';
import { useRecordingContext } from '@/features/episode/useRecordingContext';
import { handToHome } from '@/features/home/handToHome';
import { useWorkspace } from '@/features/episode/useWorkspace';
import { errorCodeText, errorText, useT } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import { space } from '@/ui/tokens';
import { ask, confirmDestructive, notify } from '@/ui/alerts';
import { Loading, Screen, Segmented, Toast } from '@/ui/components';
import { HeaderMenu } from '@/ui/HeaderMenu';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { undoToastFate, useToast, type UndoToast } from '@/ui/useToast';

/** 収録（録音と編集）と書き出しの 2 タブ（Issue #122）。 */
type Tab = 'studio' | 'export';

export default function EpisodeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const episodeId = id ?? '';
  const t = useT();
  const router = useRouter();
  const services = useServices();
  const ws = useWorkspace(episodeId);
  const { state } = ws;
  const recCtx = useRecordingContext(state.recording);
  const { toast, show: showToast, act, dismiss } = useToast();
  const [tab, setTab] = useState<Tab>('studio');
  const undoToast = useRef<UndoToast | null>(null);

  // 開いて何も入れずに離れた回は捨てる（FR-EP-10、Issue #168）。Home は捨て終わってから一覧を読む
  const { episodes } = services;
  useEffect(
    () => () =>
      handToHome(async () => {
        await episodes.discardIfEmpty(episodeId);
        return null;
      }),
    [episodeId, episodes],
  );

  // 複製を「開く」と、この画面の上に別の回の画面が積まれる。戻ってきたらこの回を読み込み直す
  const { refocus } = ws;
  useFocusEffect(
    useCallback(() => {
      void refocus();
    }, [refocus]),
  );

  const isRec = state.recording === 'recording' || state.recording === 'paused';
  const interrupted = state.recording === 'interrupted';
  const busy = state.recording === 'preparing' || state.recording === 'stopping';
  const live = isRec || interrupted || busy;

  const showError = useCallback(
    (message: string, title: string = t.common.error) =>
      notify({ title, message, okLabel: t.common.close }),
    [t],
  );

  const toast1 = useCallback(
    (text: string, undo?: () => void) => {
      if (!undo) {
        showToast({ text });
        return;
      }
      const top = ws.undoTopRef.current;
      const next = {
        text,
        action: t.common.undo,
        onAction: () => {
          if (ws.undoTopRef.current === top) undo();
        },
      };
      undoToast.current = { toast: next, top };
      showToast(next);
    },
    [showToast, t, ws.undoTopRef],
  );

  useEffect(() => {
    const fate = undoToastFate(undoToast.current, toast, state.undoTopId);
    if (fate === 'keep') return;
    undoToast.current = null;
    if (fate === 'dismiss') dismiss();
  }, [dismiss, state.undoTopId, toast]);

  useEffect(() => {
    const subs = [
      services.recording.on('error', (e) =>
        showError(e.code ? errorCodeText(t, e.code) : e.message),
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
  }, [services.recording, showError, showToast, t]);

  const start = useCallback(async () => {
    try {
      setTab('studio');
      await ws.startRecording();
    } catch (e) {
      showError(errorText(t, e));
    }
  }, [showError, t, ws]);

  const askOpenSettings = useCallback(
    () =>
      ask({
        title: t.record.permDeniedTitle,
        message: t.record.permDeniedBody,
        confirmLabel: t.common.openSettings,
        cancelLabel: t.common.later,
        onConfirm: () => void Linking.openSettings(),
      }),
    [t],
  );

  const requestAndStart = useCallback(async () => {
    const r = await services.recorder.requestPermissions().catch(() => null);
    if (r?.microphone === 'granted') await start();
    else askOpenSettings();
  }, [askOpenSettings, services.recorder, start]);

  /** 録音を止める。途中に差し込んだときは、その位置を伝える。 */
  const finish = useCallback(async () => {
    const at = state.recAt;
    const r = await ws.stopRecording();
    if (!r || r.durationSmp === 0) return;
    const duration = formatSmp(smp(r.durationSmp));
    showToast({
      text:
        at === null ? t.record.takeAdded(duration) : t.record.takeInserted(duration, formatSmp(at)),
    });
  }, [showToast, state.recAt, t, ws]);

  const toggleRec = useCallback(async () => {
    try {
      if (isRec) {
        await finish();
        return;
      }
      if (interrupted) {
        await ws.resumeAfterInterruption();
        return;
      }
      const perm = await services.recorder.getPermissions().catch(() => null);
      const mic = perm?.microphone ?? 'granted';
      if (mic === 'undetermined') {
        ask({
          title: t.record.permTitle,
          message: t.record.permBody,
          confirmLabel: t.record.permAllow,
          cancelLabel: t.common.later,
          onConfirm: () => void requestAndStart(),
        });
        return;
      }
      if (mic === 'denied') {
        if (Platform.OS === 'android') void requestAndStart();
        else askOpenSettings();
        return;
      }
      await start();
    } catch (e) {
      // 容量不足は「エラー」ではなく、何ができないかを題にする（Issue #165）
      const diskFull = isAppError(e) && e.code === 'disk_space_insufficient';
      showError(errorText(t, e), diskFull ? t.record.cannotStartTitle : undefined);
    }
  }, [
    askOpenSettings,
    finish,
    interrupted,
    isRec,
    requestAndStart,
    services.recorder,
    showError,
    start,
    t,
    ws,
  ]);

  const finishFromInterruption = useCallback(async () => {
    try {
      await finish();
    } catch (e) {
      showError(errorText(t, e));
    }
  }, [finish, showError, t]);

  const insertAsset = useCallback(
    async (a: AssetRow, at?: Smp) => {
      // 割り込みで止まっている間も録音中のテイクに付ける（履歴には止めたときに積む）
      if (isRec || interrupted) {
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
    [interrupted, isRec, services, showToast, state.playhead, t, toast1, ws],
  );

  const changeTab = (next: Tab) => {
    if (live && next !== 'studio') {
      showToast({ text: t.record.finishFirst });
      return;
    }
    if (next !== tab) services.haptics.play('selection');
    setTab(next);
  };

  if (!state.ready || !state.episode) return <Loading label={t.common.loadingEpisode} />;

  const episode = state.episode;

  /**
   * 削除・音声を削除は Home に引き継いで戻る。結果（失敗を含む）は Home のトーストで出す
   * （Issue #168 E5。エピソードの削除は取り消せないので、取り消しは出さない。FR-EP-4）。
   */
  const leaveAfter = (kind: 'remove' | 'purge') => {
    const code = t.episode.number(episode.episode_number);
    handToHome(async () => {
      try {
        if (kind === 'remove') {
          await episodes.remove(episodeId);
          return t.home.removed(code);
        }
        await episodes.purgeAudio(episodeId);
        return t.home.audioPurged(code);
      } catch (err) {
        return errorText(t, err);
      }
    });
    router.back();
  };

  return (
    <Screen
      overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}
      {...(tab === 'export'
        ? {}
        : {
            bottomBar: (
              <Transport
                ws={ws}
                recCtx={recCtx}
                onToggleRec={() => void toggleRec()}
                onFinishInterrupted={() => void finishFromInterruption()}
              />
            ),
          })}
    >
      <ScreenHeader
        title={t.episode.number(episode.episode_number)}
        // 題が未設定なら 2 行目は出さない。括弧書きの仮の題は未完成に見える（Issue #195）
        {...(episode.title ? { subtitle: episode.title } : {})}
        lockBack={live}
        onLockedBack={() => showToast({ text: t.record.cannotLeave })}
      />
      <HeaderMenu
        label={t.episode.a11yMenu}
        title={episode.title || t.episode.number(episode.episode_number)}
        disabled={live}
        // 取り消しはどのタブからも使える。録音中は押せない（FR-EDIT-7、Issue #122）
        buttons={[
          {
            key: 'undo',
            icon: 'undo',
            label: state.undoLabel ? t.edit.a11yUndo(state.undoLabel) : t.common.undo,
            disabled: live || !state.canUndo,
            onPress: () => void ws.undo().then((op) => op && toast1(t.undo.undid(op.label))),
          },
          {
            key: 'redo',
            icon: 'redo',
            label: state.redoLabel ? t.edit.a11yRedo(state.redoLabel) : t.common.redo,
            disabled: live || !state.canRedo,
            onPress: () => void ws.redo().then((op) => op && toast1(t.undo.redid(op.label))),
          },
        ]}
        actions={[
          {
            key: 'duplicate',
            icon: 'copy',
            label: t.episode.menu.duplicate,
            onPress: () =>
              void services.episodes.duplicate(episodeId).then((d) =>
                showToast({
                  text: t.episode.duplicated(t.episode.number(d.episode_number)),
                  action: t.common.open,
                  onAction: () => router.push(`/episode/${d.id}` as never),
                }),
              ),
          },
          // 「…」の項目は Home と同じ（Issue #168 E5）。削除の結果は Home へ戻って Home で出す
          ...(episode.audio_purged_at
            ? []
            : [
                {
                  key: 'purge',
                  icon: 'noAudio' as const,
                  label: t.episode.menu.purgeAudio,
                  onPress: () =>
                    confirmDestructive({
                      title: t.episode.menu.purgeAudio,
                      message: t.episode.menu.purgeAudioSub,
                      confirmLabel: t.common.delete,
                      cancelLabel: t.common.cancel,
                      onConfirm: () => leaveAfter('purge'),
                    }),
                },
              ]),
          {
            key: 'remove',
            icon: 'trash',
            label: t.episode.menu.remove,
            destructive: true,
            onPress: () => {
              confirmDestructive({
                title: t.episode.menu.remove,
                message: t.episode.menu.removeMessage,
                confirmLabel: t.common.delete,
                cancelLabel: t.common.cancel,
                onConfirm: () => leaveAfter('remove'),
              });
            },
          },
        ]}
      />

      <View style={st.tabs}>
        <Segmented
          value={tab}
          onChange={changeTab}
          disabled={() => live}
          options={[
            { value: 'studio', label: t.episode.tabs.studio },
            { value: 'export', label: t.episode.tabs.export },
          ]}
        />
      </View>

      {tab === 'studio' ? (
        <StudioTab
          ws={ws}
          recCtx={recCtx}
          onInsertAsset={(a, at) => void insertAsset(a, at)}
          onOpenAssets={() => router.push('/show')}
          onShowToast={toast1}
          onError={showError}
          onGoExport={() => setTab('export')}
        />
      ) : (
        <ExportTab
          ws={ws}
          onShowToast={toast1}
          onGoEdit={() => setTab('studio')}
          onDone={(exportId) =>
            router.push(`/episode/${episodeId}/share?exportId=${exportId}` as never)
          }
        />
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  tabs: { marginTop: space.xs, marginBottom: space.lg },
  sheetActions: { gap: space.sm },
});
