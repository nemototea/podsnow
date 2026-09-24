import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { EditableDoc } from '@/domain/editing/doc';
import { currentIndex, nextIndex, type OutlineItem } from '@/domain/outline';
import { smp, ZERO_SMP, type Smp } from '@/domain/time';
import { detectBlocks } from '@/domain/timeline/blocks';
import { placeOverlays, suggestReanchor, type PlacedOverlay } from '@/domain/timeline/overlays';
import type { OverlayClip, Range } from '@/domain/timeline/types';
import {
  deleteRange,
  deleteRanges,
  moveSegment,
  placeVoice,
  resolveSource,
  resolveTimeline,
  totalDuration,
} from '@/domain/timeline/voice';
import { useT } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import { getEpisode, type EpisodeRow } from '@/infra/db/repositories/episodesRepo';
import {
  listRecordingEvents,
  type RecordingEvent,
} from '@/infra/db/repositories/recordingEventsRepo';
import { listSegments, listTakes, type TakeRow } from '@/infra/db/repositories/takesRepo';
import { ensureTakePeaks } from '@/services/audio/PeaksService';
import { planSilenceForTimeline } from '@/services/audio/SilenceService';
import type { EditingService } from '@/services/editing/EditingService';
import type { SessionState } from '@/services/recording/RecordingSession';
import { fileExists } from '@/infra/files/fileSystem';

import type { LevelEvent } from '../../../modules/podsnow-recorder/src/PodsnowRecorder.types';
import { useServices } from '../app/ServicesProvider';
import { LEVEL_STEP_SMP, readPeaksFile, timelineLevels, type TakePeaks } from './peaks';

/** 「言い直す」の既定の範囲（10 秒）。 */
const RETAKE_WINDOW = 10 * 48000;

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
  playing: boolean;
  recording: SessionState;
  recFrames: number;
  level: LevelEvent | null;
  selection: Range | null;
  selectedOverlay: string | null;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  undoTopId: string | null;
  outline: OutlineItem[];
  events: RecordingEvent[];
  ready: boolean;
}

/**
 * エピソード画面（録音 / 編集 / 書き出しの 3 タブ）が共有する状態と操作。
 * EditingService / RecordingSession / PlaybackService / OutlineService を結線する。
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
    playing: false,
    recording: recording.current,
    recFrames: 0,
    level: null,
    selection: null,
    selectedOverlay: null,
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    undoTopId: null,
    outline: [],
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

  const loadOutline = useCallback(async () => {
    const [outline, events] = await Promise.all([
      services.outline.list(episodeId),
      listRecordingEvents(db, episodeId),
    ]);
    patch({ outline, events });
  }, [db, episodeId, patch, services.outline]);

  const reloadAll = useCallback(async () => {
    // RecordingSession は DB に直接書くので、毎回 DB から開き直す（メモリ上の doc を信用しない）
    const e = await services.openEditing(episodeId);
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
    await Promise.all([loadPeaks(takes), loadOutline()]);
    await playback.reload(episodeId).catch(() => {});
  }, [db, episodeId, loadPeaks, loadOutline, playback, services, syncFromEditing]);

  useEffect(() => {
    let alive = true;
    void services.episodes.touch(episodeId);
    // 読み込みはマイクロタスクへ逃がし、アンマウント後や episodeId 切替後には開始しない。
    // （`reloadAll()` は最初の文が await なので setState は同期的には走らないが、
    //   react-hooks/set-state-in-effect は await の先まで追えないため直接呼びは弾かれる）
    void Promise.resolve().then(() => {
      if (!alive) return;
      return reloadAll();
    });
    return () => {
      alive = false;
      void playback.pause();
    };
  }, [episodeId, playback, reloadAll, services.episodes]);

  // ---- 録音・再生イベント ----
  useEffect(() => {
    const subs = [
      recording.on('state', (s) => patch({ recording: s })),
      recording.on('level', (l) => patch({ level: l, recFrames: l.frames })),
      recording.on('takeFinalized', () => void reloadAll()),
      playback.on('state', (e) => patch({ playing: e.playing, playhead: smp(e.frame) })),
      playback.on('position', (e) => patch({ playhead: smp(e.frame) })),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [patch, playback, recording, reloadAll]);

  // ---- 編集の共通ルート ----
  const apply = useCallback(
    async (label: string, mutate: (d: EditableDoc) => EditableDoc, groupKey?: string) => {
      const e = editingRef.current;
      if (!e) return;
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
      void services.episodes.refreshStatus(episodeId);
    },
    [episodeId, playback, services.episodes, syncFromEditing, t],
  );

  const undo = useCallback(async () => {
    const e = editingRef.current;
    if (!e) return null;
    const op = await e.undo();
    syncFromEditing(e);
    await playback.reload(episodeId).catch(() => {});
    return op;
  }, [episodeId, playback, syncFromEditing]);

  const redo = useCallback(async () => {
    const e = editingRef.current;
    if (!e) return null;
    const op = await e.redo();
    syncFromEditing(e);
    await playback.reload(episodeId).catch(() => {});
    return op;
  }, [episodeId, playback, syncFromEditing]);

  // ---- 再生 ----
  const seek = useCallback(
    async (to: Smp) => {
      const t = smp(Math.max(0, Math.min(state.total, to)));
      patch({ playhead: t });
      await playback.seek(t);
      void services.episodes.update(episodeId, { playheadSmp: t });
    },
    [episodeId, patch, playback, services.episodes, state.total],
  );
  const togglePlay = useCallback(() => playback.toggle(), [playback]);

  // ---- 録音 ----
  const startRecording = useCallback(
    async (opts: { punchIn?: Range | null } = {}) => {
      await playback.pause();
      const perm = await services.recorder
        .getInputs()
        .then(() => true)
        .catch(() => true);
      void perm;
      if (opts.punchIn) {
        // 範囲を除去してから、その位置に録る
        await apply(t.undo.punchInPrepare, (d) => ({
          ...d,
          voice: deleteRange(d.voice, opts.punchIn!.start, opts.punchIn!.end),
        }));
        patch({ selection: null });
        await recording.start(episodeId, { insertAtSmp: opts.punchIn.start });
        haptics.play('impact');
        return;
      }
      await recording.start(episodeId, { insertAtSmp: null });
      haptics.play('impact');
    },
    [apply, episodeId, haptics, patch, playback, recording, services.recorder, t],
  );
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
   * 言い直す（FR-REC-4）。録音を止めずに直近を捨てる。
   * `chapter` はいま話している項目の頭から、`last10` は直近 10 秒。
   * 戻り値は捨てた長さ。捨てるものが無ければ null。
   */
  const retake = useCallback(
    (mode: 'chapter' | 'last10'): Smp | null => {
      const pos = recording.currentSourcePosition();
      if (!pos) return null;
      let from = smp(Math.max(0, pos.srcSmp - RETAKE_WINDOW));
      if (mode === 'chapter') {
        const i = currentIndex(state.outline);
        const item = i === null ? null : state.outline[i];
        from =
          item && item.recordedTakeId === pos.takeId && item.recordedSrcSmp !== null
            ? item.recordedSrcSmp
            : ZERO_SMP;
      }
      const dropped = recording.retake(from);
      if (dropped !== null) haptics.play('warning');
      return dropped;
    },
    [haptics, recording, state.outline],
  );

  const undoRetake = useCallback(() => recording.undoRetake(), [recording]);

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

  // ---- チャプター（トークテーマ由来）と録音中の出来事 ----

  /** 声トラック上のチャプター。カットされた項目は落ちる（FR-OUT-4）。 */
  const chaptersOnTimeline = useMemo(
    () =>
      state.outline
        .map((item) =>
          item.recordedTakeId !== null && item.recordedSrcSmp !== null
            ? {
                item,
                at: resolveTimeline(state.doc.voice, item.recordedTakeId, item.recordedSrcSmp),
              }
            : { item, at: null },
        )
        .filter((x): x is { item: OutlineItem; at: Smp } => x.at !== null)
        .sort((a, b) => a.at - b.at),
    [state.doc.voice, state.outline],
  );

  /**
   * チャプター 1 つ分の範囲（次のチャプターの手前まで。最後なら末尾まで）。
   * 長押しで丸ごと選ぶのに使う（docs/ux-restructure.md §6.3）。
   */
  const chapterRange = useCallback(
    (itemId: string): Range | null => {
      const i = chaptersOnTimeline.findIndex((ch) => ch.item.id === itemId);
      if (i < 0) return null;
      const start = chaptersOnTimeline[i]!.at;
      const end = chaptersOnTimeline[i + 1]?.at ?? state.total;
      return end > start ? { start, end } : null;
    },
    [chaptersOnTimeline, state.total],
  );

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
  /** 塊をそのまま選ぶ（タップ）。無音の位置なら選択を外す。 */
  const selectBlockAt = useCallback(
    (at: Smp) => {
      const b = blocks.find((x) => at >= x.start && at < x.end) ?? null;
      patch({ selection: b, selectedOverlay: null });
      if (b) haptics.play('selection');
      return b;
    },
    [blocks, haptics, patch],
  );

  /** ハンドルのドラッグ後に確定する。隣の塊の境界へ吸い付かせる。 */
  const setSelection = useCallback(
    (sel: Range | null) => patch({ selection: sel, selectedOverlay: null }),
    [patch],
  );

  const clearSelection = useCallback(
    () => patch({ selection: null, selectedOverlay: null }),
    [patch],
  );

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

  // ---- テイク ----
  const moveTake = useCallback(
    (fromIndex: number, toIndex: number) =>
      apply(t.undo.reorderTakes, (d) => ({
        ...d,
        voice: moveSegment(d.voice, fromIndex, toIndex),
      })),
    [apply, t],
  );
  const removeVoiceSegment = useCallback(
    (index: number) =>
      apply(t.undo.removeFromTimeline, (d) => {
        const p = placeVoice(d.voice)[index];
        return p ? { ...d, voice: deleteRange(d.voice, p.start, p.end) } : d;
      }),
    [apply, t],
  );
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
   */
  const insertAsset = useCallback(
    async (asset: AssetRow, at: 'playhead' | 'recording' | Smp) => {
      let anchor: OverlayClip['anchor'];
      if (at === 'recording') {
        const pos = recording.currentSourcePosition();
        if (!pos) return;
        anchor = { type: 'source', takeId: pos.takeId, srcSmp: pos.srcSmp };
      } else {
        const tl = at === 'playhead' ? state.playhead : at;
        const src = resolveSource(state.doc.voice, tl);
        anchor = src
          ? { type: 'source', takeId: src.takeId, srcSmp: src.srcSmp }
          : { type: 'timeline_abs', smp: tl };
      }
      const clip: OverlayClip = {
        id: services.newId(),
        assetId: asset.id,
        kind: asset.kind,
        anchor,
        srcStart: ZERO_SMP,
        srcEnd: null,
        gainDb: asset.default_gain_db,
        fadeIn: ZERO_SMP,
        fadeOut: ZERO_SMP,
        duck: asset.kind === 'bgm',
        loop: asset.kind === 'bgm',
        endMode: asset.kind === 'bgm' ? 'timeline_end' : 'asset_end',
      };
      if (at === 'recording') {
        const e = editingRef.current;
        if (!e) return;
        await e.writeWithoutHistory((d) => ({ ...d, overlays: [...d.overlays, clip] }));
        syncFromEditing(e);
      } else {
        await apply(t.undo.insertAsset(asset.name), (d) => ({
          ...d,
          overlays: [...d.overlays, clip],
        }));
      }
    },
    [apply, recording, services, state.doc.voice, state.playhead, syncFromEditing, t],
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

  // ---- トークテーマと台本 ----

  const saveOutline = useCallback(
    async (items: readonly OutlineItem[]) => {
      await services.outline.save(episodeId, items);
      await loadOutline();
    },
    [episodeId, loadOutline, services.outline],
  );

  const addOutlineFromText = useCallback(
    async (text: string) => {
      await services.outline.addFromText(episodeId, text);
      await loadOutline();
    },
    [episodeId, loadOutline, services.outline],
  );

  /** 次の項目へ進む。録音中ならその位置がチャプターになる（FR-OUT-4）。 */
  const advanceOutline = useCallback(async () => {
    const item = await services.outline.advance(episodeId, recording.currentSourcePosition());
    await loadOutline();
    if (item) haptics.play('selection');
    return item;
  }, [episodeId, haptics, loadOutline, recording, services.outline]);

  const outlineCurrent = useMemo(() => currentIndex(state.outline), [state.outline]);
  const outlineNext = useMemo(() => nextIndex(state.outline), [state.outline]);

  return {
    state,
    undoTopRef,
    blocks,
    chaptersOnTimeline,
    chapterRange,
    eventsOnTimeline,
    apply,
    undo,
    redo,
    seek,
    togglePlay,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    resumeAfterInterruption,
    retake,
    undoRetake,
    setSelectionStart,
    setSelectionEnd,
    selectBlockAt,
    setSelection,
    clearSelection,
    deleteSelection,
    planSilence,
    applySilencePlan,
    moveTake,
    removeVoiceSegment,
    setVoiceGain,
    insertAsset,
    updateOverlay,
    removeOverlay,
    moveOverlayTo,
    selectOverlay: (id: string | null) => patch({ selectedOverlay: id, selection: null }),
    saveOutline,
    addOutlineFromText,
    advanceOutline,
    outlineCurrent,
    outlineNext,
    reloadAll,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
