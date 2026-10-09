import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { EditableDoc } from '@/domain/editing/doc';
import { smp, ZERO_SMP, type Smp } from '@/domain/time';
import { detectBlocks } from '@/domain/timeline/blocks';
import { placeOverlays, suggestReanchor, type PlacedOverlay } from '@/domain/timeline/overlays';
import type { OverlayClip, Range } from '@/domain/timeline/types';
import {
  deleteRange,
  deleteRanges,
  resolveSource,
  resolveTimeline,
  totalDuration,
} from '@/domain/timeline/voice';
import { useT } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import {
  getEpisode,
  type EpisodeExportPreset,
  type EpisodeRow,
} from '@/infra/db/repositories/episodesRepo';
import {
  listRecordingEvents,
  type RecordingEvent,
} from '@/infra/db/repositories/recordingEventsRepo';
import { listSegments, listTakes, type TakeRow } from '@/infra/db/repositories/takesRepo';
import { ensureTakePeaks } from '@/services/audio/PeaksService';
import { type SoundSettings } from '@/services/audio/renderDocumentFromDb';
import { planSilenceForTimeline } from '@/services/audio/SilenceService';
import type { EditingService } from '@/services/editing/EditingService';
import type { SessionState } from '@/services/recording/RecordingSession';
import { fileExists } from '@/infra/files/fileSystem';

import type { LevelEvent } from '../../../modules/podsnow-recorder/src/PodsnowRecorder.types';
import { useServices } from '../app/ServicesProvider';
import { tapBlock } from './blockTap';
import { newInsertedClip } from './insertClip';
import { LEVEL_STEP_SMP, readPeaksFile, timelineLevels, type TakePeaks } from './peaks';

export interface WorkspaceState {
  episode: EpisodeRow | null;
  doc: EditableDoc;
  takes: TakeRow[];
  assets: AssetRow[];
  assetDurations: Map<string, Smp>;
  placedOverlays: PlacedOverlay[];
  peaksByTake: Map<string, TakePeaks>;
  total: Smp;
  playhead: Smp;
  /**
   * シーク・編集・取り消し / やり直しのたびに 1 増える。波形はこれが変わったとき、
   * 再生位置が画面外なら見える位置へスクロールする（Issue #176）。
   */
  revealSeq: number;
  /** 見せたい位置。null なら再生位置（素材を入れた直後だけ、入れた位置を見せる。Issue #178）。 */
  revealAt: Smp | null;
  playing: boolean;
  recording: SessionState;
  recFrames: number;
  /** 録音を差し込んでいる位置（null = 末尾に足している）。 */
  recAt: Smp | null;
  level: LevelEvent | null;
  selection: Range | null;
  selectedOverlay: string | null;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  undoTopId: string | null;
  /** カンペ（FR-OUT-1）。空ならカンペなし。 */
  notes: string;
  events: RecordingEvent[];
  ready: boolean;
}

/**
 * エピソード画面（収録 / 書き出しの 2 タブ）が共有する状態と操作。
 * EditingService / RecordingSession / PlaybackService / NotesService を結線する。
 * 画面はこのフックだけを使う（ARCHITECTURE.md §2 / §12）。
 */
export function useWorkspace(episodeId: string) {
  const services = useServices();
  const t = useT();
  const { db, root, recording, playback, engine, settings, haptics } = services;
  const editingRef = useRef<EditingService | null>(null);
  const undoTopRef = useRef<string | null>(null);
  const [state, setState] = useState<WorkspaceState>({
    episode: null,
    doc: { voice: [], overlays: [] },
    takes: [],
    assets: [],
    assetDurations: new Map(),
    placedOverlays: [],
    peaksByTake: new Map(),
    total: ZERO_SMP,
    playhead: ZERO_SMP,
    revealSeq: 0,
    revealAt: null,
    playing: false,
    recording: recording.current,
    recFrames: 0,
    recAt: null,
    level: null,
    selection: null,
    selectedOverlay: null,
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    undoTopId: null,
    notes: '',
    events: [],
    ready: false,
  });
  const patch = useCallback(
    (p: Partial<WorkspaceState> | ((s: WorkspaceState) => Partial<WorkspaceState>)) => {
      setState((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));
    },
    [],
  );

  // ---- 読み込み ----
  const syncFromEditing = useCallback(
    (e: EditingService, extra: Partial<WorkspaceState> = {}) => {
      const doc = e.current;
      undoTopRef.current = e.undoTopId;
      patch((s) => {
        const durations = extra.assetDurations ?? s.assetDurations;
        return {
          doc,
          revealSeq: s.revealSeq + 1,
          revealAt: null,
          total: totalDuration(doc.voice),
          placedOverlays: placeOverlays(doc.voice, doc.overlays, durations),
          canUndo: e.canUndo,
          canRedo: e.canRedo,
          undoLabel: e.undoLabel,
          redoLabel: e.redoLabel,
          undoTopId: e.undoTopId,
          ...extra,
        };
      });
    },
    [patch],
  );

  const loadPeaks = useCallback(
    async (takes: TakeRow[]) => {
      const map = new Map<string, TakePeaks>();
      for (const t of takes) {
        if (t.status !== 'ready' && t.status !== 'recovered') continue;
        await ensureTakePeaks({ db, engine, root, fileExists }, episodeId, t.id).catch(() => []);
        const segs = await listSegments(db, t.id);
        const parts: TakePeaks['parts'] = [];
        let perSecond = 100;
        for (const sg of segs) {
          if (!sg.peaks_path || !sg.duration_smp) continue;
          const pk = await readPeaksFile(root, sg.peaks_path);
          if (!pk) continue;
          perSecond = pk.perSecond;
          parts.push({ offsetSmp: sg.offset_smp, durationSmp: sg.duration_smp, data: pk.data });
        }
        map.set(t.id, { perSecond, sampleRate: t.sample_rate, parts });
      }
      patch({ peaksByTake: map });
    },
    [db, engine, root, episodeId, patch],
  );

  const loadNotesAndEvents = useCallback(async () => {
    const [notes, events] = await Promise.all([
      services.notes.get(episodeId),
      listRecordingEvents(db, episodeId),
    ]);
    patch({ notes, events });
  }, [db, episodeId, patch, services.notes]);

  const reloadAll = useCallback(
    async (opts: { open?: boolean; refocus?: boolean } = {}) => {
      // RecordingSession は DB に直接書くので、毎回 DB から読み直す（メモリ上の doc を信用しない）。
      // 画面を開いたときだけ取り消しの履歴を空にする（Issue #122）。
      const e = opts.open
        ? await services.openEditing(episodeId)
        : await services.resumeEditing(episodeId);
      editingRef.current = e;
      const [episode, takes, assets] = await Promise.all([
        getEpisode(db, episodeId),
        listTakes(db, episodeId),
        services.assets.list(services.show.id),
      ]);
      const assetDurations = new Map(assets.map((a) => [a.id, a.duration_smp as Smp]));
      syncFromEditing(e, {
        episode,
        takes,
        assets,
        assetDurations,
        ready: true,
        playhead: smp(episode?.playhead_smp ?? 0),
      });
      await Promise.all([loadPeaks(takes), loadNotesAndEvents()]);
      await playback.reload(episodeId).catch(() => {});
      // 開いたとき・戻ってきたときは、再生エンジンの位置をこの回の保存位置に合わせる
      // （エンジンは 1 つなので、直前に開いていた別の回の位置が残っている）
      if ((opts.open || opts.refocus) && episode) {
        await playback.seek(smp(episode.playhead_smp ?? 0)).catch(() => {});
      }
    },
    [db, episodeId, loadPeaks, loadNotesAndEvents, playback, services, syncFromEditing],
  );

  useEffect(() => {
    let alive = true;
    void services.episodes.touch(episodeId);
    // Home から再生していたら止める。鳴ったまま録ると再生音が録音に入る（Issue #164）。
    // 状態は同期的に止まるので、続く `reloadAll()` の読み込み直しで鳴り続けない
    void playback.stopHome();
    // 読み込みはマイクロタスクへ逃がし、アンマウント後や episodeId 切替後には開始しない。
    // （`reloadAll()` は最初の文が await なので setState は同期的には走らないが、
    //   react-hooks/set-state-in-effect は await の先まで追えないため直接呼びは弾かれる）
    void Promise.resolve().then(() => {
      if (!alive) return;
      return reloadAll({ open: true });
    });
    return () => {
      alive = false;
      // 止めて、ロック画面からも消す（画面が無いのにロック画面から鳴らせないように。Issue #184）
      void playback.leaveEpisode();
    };
  }, [episodeId, playback, reloadAll, services.episodes]);

  /**
   * 画面に戻ってきたとき（上に積んだ別の回の画面を閉じたとき）。再生エンジンが別の回を
   * 読み込んでいたら、この回を読み込み直す。取り消しの履歴は残す。
   */
  const refocus = useCallback(async () => {
    if (!editingRef.current) return;
    if (playback.loadedEpisodeId === episodeId) return;
    patch({ playing: false });
    await reloadAll({ refocus: true });
  }, [episodeId, patch, playback, reloadAll]);

  // 画面を抜けたら取り消しの履歴を捨てる。編集そのものは保存済み（Issue #122）。
  useEffect(
    () => () => void services.discardEditHistory(episodeId).catch(() => {}),
    [episodeId, services],
  );

  /** 再生位置を置く（保存もする）。範囲の確認は呼び出し側で済ませる。 */
  const placePlayhead = useCallback(
    async (to: Smp) => {
      patch((s) => ({ playhead: to, revealSeq: s.revealSeq + 1, revealAt: null }));
      await playback.seek(to).catch(() => {});
      void services.episodes.update(episodeId, { playheadSmp: to });
    },
    [episodeId, patch, playback, services.episodes],
  );

  // ---- 録音・再生イベント ----
  useEffect(() => {
    const subs = [
      recording.on('state', (s) => patch({ recording: s })),
      recording.on('level', (l) => patch({ level: l, recFrames: l.frames })),
      // 止めたら、今録った部分の直後に再生位置を置く。続けて押せば続きから録れる。
      // 別のエピソードの画面が下に積まれていても、自分の回の録音だけを受ける。
      recording.on('takeFinalized', (e) => {
        if (e.episodeId !== episodeId) return;
        void reloadAll().then(() => placePlayhead(e.endSmp));
      }),
      // 再生エンジンは 1 つ。下に積まれた別の回の画面は、その回を読み込んでいる間だけ受ける
      playback.on('state', (e) => {
        if (playback.loadedEpisodeId !== episodeId || playback.source?.kind !== 'timeline') return;
        patch({ playing: e.playing, playhead: smp(e.frame) });
      }),
      playback.on('position', (e) => {
        if (playback.loadedEpisodeId !== episodeId || playback.source?.kind !== 'timeline') return;
        patch({ playhead: smp(e.frame) });
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [episodeId, patch, placePlayhead, playback, recording, reloadAll]);

  // ---- 編集の共通ルート ----
  // 録音中（割り込みで止まっている間も含む）は履歴に積まない。録音中の変更は
  // 止めたときに録音の追加と 1 つの操作にまとまる（Issue #122）。
  const apply = useCallback(
    async (label: string, mutate: (d: EditableDoc) => EditableDoc, groupKey?: string) => {
      const e = editingRef.current;
      if (!e || !recording.isIdle) return;
      const before = e.current;
      const op = await e.apply(label, mutate, { groupKey: groupKey ?? null });
      if (!op) return;
      // 孤立したオーバーレイを最寄りへ付け替える提案（自動適用）
      const after = e.current;
      const fixed = after.overlays.map((o) => suggestReanchor(before.voice, after.voice, o) ?? o);
      if (fixed.some((o, i) => o !== after.overlays[i])) {
        await e.apply(t.undo.reanchored(label), (d) => ({ ...d, overlays: fixed }), {
          groupKey: `reanchor:${op.id}`,
        });
      }
      syncFromEditing(e);
      await playback.reload(episodeId).catch(() => {});
      services.loudness.contentChanged(episodeId);
      void services.episodes.refreshStatus(episodeId);
    },
    [episodeId, playback, recording, services.episodes, services.loudness, syncFromEditing, t],
  );

  // 録音中（準備・停止処理を含む）は取り消せない。トーストの「取り消す」もここを通る。
  const undo = useCallback(async () => {
    const e = editingRef.current;
    if (!e || !recording.isIdle) return null;
    const op = await e.undo();
    syncFromEditing(e);
    await playback.reload(episodeId).catch(() => {});
    services.loudness.contentChanged(episodeId);
    return op;
  }, [episodeId, playback, recording, services.loudness, syncFromEditing]);

  const redo = useCallback(async () => {
    const e = editingRef.current;
    if (!e || !recording.isIdle) return null;
    const op = await e.redo();
    syncFromEditing(e);
    await playback.reload(episodeId).catch(() => {});
    services.loudness.contentChanged(episodeId);
    return op;
  }, [episodeId, playback, recording, services.loudness, syncFromEditing]);

  // ---- 再生 ----
  const seek = useCallback(
    async (to: Smp) => {
      const t = smp(Math.max(0, Math.min(state.total, to)));
      patch((s) => ({ playhead: t, revealSeq: s.revealSeq + 1, revealAt: null }));
      await playback.seek(t);
      void services.episodes.update(episodeId, { playheadSmp: t });
    },
    [episodeId, patch, playback, services.episodes, state.total],
  );
  const togglePlay = useCallback(() => playback.toggle(), [playback]);

  /**
   * DB に書いた episodes の列を、メモリ上の `state.episode` にも反映する。
   * 書き出しタブはタブを切り替えるたびに作り直され `state.episode` から読み直すので、
   * これを忘れると変更前の値に戻って見える（Issue #136）。
   */
  const patchEpisode = useCallback(
    (fields: Partial<Pick<EpisodeRow, 'sound_settings' | 'export_preset'>>) =>
      patch((s) => (s.episode ? { episode: { ...s.episode, ...fields } } : {})),
    [patch],
  );

  /**
   * 音の仕上げを保存する。試聴に効く変更（ダッキング）なら再生を読み直し、
   * 聴いている位置のまま新しい設定で鳴らす（Issue #134）。
   */
  const updateSound = useCallback(
    async (prev: SoundSettings, next: SoundSettings) => {
      const soundSettings = JSON.stringify(next);
      await services.episodes.update(episodeId, { soundSettings });
      patchEpisode({ sound_settings: soundSettings });
      // 読み直さずに試聴へ反映する。正規化のゲインは裏で測り直す（AUDIO_DESIGN.md §7.1、Issue #158）
      await services.loudness.soundChanged(episodeId, prev, next).catch(() => {});
    },
    [episodeId, patchEpisode, services.episodes, services.loudness],
  );

  /** 書き出しプリセットの選択をこの回に保存する（DATA_MODEL.md §4.5.1）。 */
  const updateExportPreset = useCallback(
    async (key: EpisodeExportPreset) => {
      await services.episodes.update(episodeId, { exportPreset: key });
      patchEpisode({ export_preset: key });
    },
    [episodeId, patchEpisode, services.episodes],
  );

  // ---- 録音 ----
  /**
   * 再生位置から録る。途中なら挿入し、後ろの声はずれる。末尾なら足す（FR-REC-1）。
   * 声を置き換えたいときは、先に塊を選んで削除し、空いた位置から録る。
   */
  const startRecording = useCallback(async () => {
    await playback.stopForRecording();
    const at = state.playhead < state.total ? state.playhead : null;
    await recording.start(episodeId, { insertAtSmp: at });
    patch({ selection: null, selectedOverlay: null, recAt: at, recFrames: 0 });
    haptics.play('impact');
  }, [episodeId, haptics, patch, playback, recording, state.playhead, state.total]);
  const stopRecording = useCallback(async () => {
    const r = await recording.stop();
    haptics.play('impact');
    return r;
  }, [haptics, recording]);
  const pauseRecording = useCallback(async () => {
    await recording.pause();
    haptics.play('light');
  }, [haptics, recording]);
  const resumeRecording = useCallback(async () => {
    await recording.resume();
    haptics.play('light');
  }, [haptics, recording]);
  const resumeAfterInterruption = useCallback(
    () => recording.resumeAfterInterruption(),
    [recording],
  );

  /**
   * 無音で区切られた声の塊（FR-EDIT-2）。編集の選択単位。
   * しきい値は無音カットと同じ設定を使うので、見え方と挙動が一致する。
   */
  const blocks = useMemo(
    () =>
      detectBlocks(
        timelineLevels(state.doc.voice, state.peaksByTake, state.total),
        LEVEL_STEP_SMP,
        state.total,
        {
          thresholdDb: settings.silence.thresholdDb,
          minSilenceSmp: smp((settings.silence.minDurationMs * 48000) / 1000),
        },
      ),
    [state.doc.voice, state.peaksByTake, state.total, settings.silence],
  );

  // ---- 録音中の出来事 ----

  /** 割り込みなど、アプリが自動で記録した位置。ユーザーは打てない。 */
  const eventsOnTimeline = useMemo(
    () =>
      state.events
        .map((event) => ({
          event,
          at: resolveTimeline(state.doc.voice, event.takeId, event.srcSmp),
        }))
        .filter((x): x is { event: RecordingEvent; at: Smp } => x.at !== null)
        .sort((a, b) => a.at - b.at),
    [state.doc.voice, state.events],
  );

  // ---- 選択・削除 ----
  const setSelectionStart = useCallback(() => {
    patch((s) => ({
      selection: {
        start: s.playhead,
        end:
          s.selection && s.selection.end > s.playhead
            ? s.selection.end
            : smp(Math.min(s.total, s.playhead + 48000)),
      },
    }));
  }, [patch]);
  const setSelectionEnd = useCallback(() => {
    patch((s) => ({
      selection: {
        start:
          s.selection && s.selection.start < s.playhead
            ? s.selection.start
            : smp(Math.max(0, s.playhead - 48000)),
        end: s.playhead,
      },
    }));
  }, [patch]);
  /**
   * 波形を押した（Issue #177）。再生位置はいつも押した位置へ移す。選択は同じ塊への 2 回目のタップか
   * 長押しで作り、選択の中をもう一度押すと外す（`tapBlock`）。
   */
  const lastTapRef = useRef<Range | null>(null);
  const tapAt = useCallback(
    async (at: Smp, longPress = false) => {
      const r = tapBlock({
        at,
        blocks,
        selection: state.selection,
        last: lastTapRef.current,
        longPress,
      });
      lastTapRef.current = r.last;
      patch({ selection: r.selection, selectedOverlay: null });
      if (r.selection) haptics.play('selection');
      await seek(at);
    },
    [blocks, haptics, patch, seek, state.selection],
  );

  /** 選択部分を試聴する。選択の先頭から鳴らし、終わりで止める（Issue #177）。 */
  const playSelection = useCallback(async () => {
    const sel = state.selection;
    if (!sel) return;
    patch((s) => ({ playhead: sel.start, revealSeq: s.revealSeq + 1, revealAt: null }));
    await playback.playRange(sel.start, sel.end);
  }, [patch, playback, state.selection]);

  /** ハンドルのドラッグ後に確定する。隣の塊の境界へ吸い付かせる。 */
  const setSelection = useCallback(
    (sel: Range | null) => patch({ selection: sel, selectedOverlay: null }),
    [patch],
  );

  const clearSelection = useCallback(() => {
    lastTapRef.current = null;
    patch({ selection: null, selectedOverlay: null });
  }, [patch]);

  const deleteSelection = useCallback(async () => {
    const sel = state.selection;
    if (!sel) return;
    await apply(t.undo.deleteRange, (d) => ({
      ...d,
      voice: deleteRange(d.voice, sel.start, sel.end),
    }));
    patch({ selection: null });
    await seek(sel.start);
  }, [apply, patch, seek, state.selection, t]);

  // ---- 無音 ----
  const planSilence = useCallback(
    () => planSilenceForTimeline({ db, engine, root }, state.doc.voice, settings.silence),
    [db, engine, root, settings.silence, state.doc.voice],
  );
  const applySilencePlan = useCallback(
    async (ranges: Range[]) => {
      await apply(t.undo.deleteSilence, (d) => ({ ...d, voice: deleteRanges(d.voice, ranges) }));
    },
    [apply, t],
  );

  // ---- 声 ----
  const setVoiceGain = useCallback(
    (index: number, gainDb: number) =>
      apply(
        t.undo.changeGain,
        (d) => ({ ...d, voice: d.voice.map((v, i) => (i === index ? { ...v, gainDb } : v)) }),
        `gain:v:${index}`,
      ),
    [apply, t],
  );

  // ---- オーバーレイ ----
  /**
   * 素材を入れる。位置は録音中なら発言位置、そうでなければ再生位置か、
   * 呼び出し側が指定した時刻（選択の前 / 後 に入れるときに使う）。
   * 入れた素材の id を返す（入れられなかったら null）。編集中は呼び出し側がその素材を選ぶ（Issue #178）。
   */
  const insertAsset = useCallback(
    async (asset: AssetRow, at: 'playhead' | 'recording' | Smp): Promise<string | null> => {
      const id = services.newId();
      if (at === 'recording') {
        const pos = recording.currentSourcePosition();
        const e = editingRef.current;
        if (!pos || !e) return null;
        const clip = newInsertedClip({ id, asset, at: pos });
        await e.writeWithoutHistory((d) => ({ ...d, overlays: [...d.overlays, clip] }));
        syncFromEditing(e);
        return id;
      }
      const tl = at === 'playhead' ? state.playhead : at;
      const clip = newInsertedClip({ id, asset, at: { timeline: tl, voice: state.doc.voice } });
      await apply(t.undo.insertAsset(asset.name), (d) => ({
        ...d,
        overlays: [...d.overlays, clip],
      }));
      // 入れた位置が画面外なら、波形をそこへ送る（Issue #176 の仕組み）
      patch((s) => ({ revealAt: tl, revealSeq: s.revealSeq + 1 }));
      return id;
    },
    [apply, patch, recording, services, state.doc.voice, state.playhead, syncFromEditing, t],
  );

  const updateOverlay = useCallback(
    (id: string, label: string, mutate: (o: OverlayClip) => OverlayClip, groupKey?: string) =>
      apply(
        label,
        (d) => ({ ...d, overlays: d.overlays.map((o) => (o.id === id ? mutate(o) : o)) }),
        groupKey,
      ),
    [apply],
  );
  const removeOverlay = useCallback(
    async (id: string) => {
      await apply(t.undo.removeAsset, (d) => ({
        ...d,
        overlays: d.overlays.filter((o) => o.id !== id),
      }));
      patch({ selectedOverlay: null });
    },
    [apply, patch, t],
  );
  const moveOverlayTo = useCallback(
    (id: string, tl: Smp) =>
      updateOverlay(id, t.undo.moveAsset, (o) => {
        const src = resolveSource(state.doc.voice, tl);
        return {
          ...o,
          anchor: src
            ? { type: 'source', takeId: src.takeId, srcSmp: src.srcSmp }
            : { type: 'timeline_abs', smp: tl },
        };
      }),
    [state.doc.voice, updateOverlay, t],
  );

  // ---- カンペ（FR-OUT-1..2）。編集画面で書き、録音中は読むだけ ----

  const saveNotes = useCallback(
    async (notes: string) => {
      await services.notes.save(episodeId, notes);
      patch({ notes });
    },
    [episodeId, patch, services.notes],
  );

  return {
    state,
    undoTopRef,
    blocks,
    eventsOnTimeline,
    apply,
    undo,
    redo,
    seek,
    togglePlay,
    updateSound,
    updateExportPreset,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    resumeAfterInterruption,
    setSelectionStart,
    setSelectionEnd,
    tapAt,
    playSelection,
    setSelection,
    clearSelection,
    deleteSelection,
    planSilence,
    applySilencePlan,
    setVoiceGain,
    insertAsset,
    updateOverlay,
    removeOverlay,
    moveOverlayTo,
    selectOverlay: (id: string | null) => patch({ selectedOverlay: id, selection: null }),
    saveNotes,
    reloadAll,
    refocus,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
