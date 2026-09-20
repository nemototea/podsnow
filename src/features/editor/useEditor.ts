import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { EditableDoc, Marker } from '@/domain/editing/doc';
import { smp, ZERO_SMP, type Smp } from '@/domain/time';
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
import { listSegments, listTakes, type TakeRow } from '@/infra/db/repositories/takesRepo';
import { ensureTakePeaks } from '@/services/audio/PeaksService';
import { planSilenceForTimeline } from '@/services/audio/SilenceService';
import type { EditingService } from '@/services/editing/EditingService';
import type { SessionState } from '@/services/recording/RecordingSession';
import { fileExists } from '@/infra/files/fileSystem';

import type { LevelEvent } from '../../../modules/podsnow-recorder/src/PodsnowRecorder.types';
import { useServices } from '../app/ServicesProvider';
import { readPeaksFile, type TakePeaks } from './peaks';

export interface Topic {
  id: string;
  position: number;
  text: string;
  checkedAt: number | null;
}

export interface EditorState {
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
  topics: Topic[];
  ready: boolean;
}

/**
 * Editor 画面の状態と操作。EditingService / RecordingSession / PlaybackService を結線する。
 * 画面はこのフックだけを使う（ARCHITECTURE.md §2）。
 */
export function useEditor(episodeId: string) {
  const services = useServices();
  const t = useT();
  const { db, root, recording, playback, engine, settings } = services;
  const editingRef = useRef<EditingService | null>(null);
  const [state, setState] = useState<EditorState>({
    episode: null,
    doc: { voice: [], overlays: [], markers: [] },
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
    topics: [],
    ready: false,
  });
  const patch = useCallback(
    (p: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) => {
      setState((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));
    },
    [],
  );

  // ---- 読み込み ----
  const syncFromEditing = useCallback(
    (e: EditingService, extra: Partial<EditorState> = {}) => {
      const doc = e.current;
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

  const loadTopics = useCallback(async () => {
    const rows = await db.all<{
      id: string;
      position: number;
      text: string;
      checked_at: number | null;
    }>('SELECT id, position, text, checked_at FROM topics WHERE episode_id = ? ORDER BY position', [
      episodeId,
    ]);
    patch({
      topics: rows.map((r) => ({
        id: r.id,
        position: r.position,
        text: r.text,
        checkedAt: r.checked_at,
      })),
    });
  }, [db, episodeId, patch]);

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
    await Promise.all([loadPeaks(takes), loadTopics()]);
    await playback.reload(episodeId).catch(() => {});
  }, [db, episodeId, loadPeaks, loadTopics, playback, services, syncFromEditing]);

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
        return recording.start(episodeId, { insertAtSmp: opts.punchIn.start });
      }
      return recording.start(episodeId, { insertAtSmp: null });
    },
    [apply, episodeId, patch, playback, recording, services.recorder, t],
  );
  const stopRecording = useCallback(() => recording.stop(), [recording]);
  const pauseRecording = useCallback(() => recording.pause(), [recording]);
  const resumeRecording = useCallback(() => recording.resume(), [recording]);
  const resumeAfterInterruption = useCallback(
    () => recording.resumeAfterInterruption(),
    [recording],
  );

  // ---- マーカー ----
  const addMarker = useCallback(
    async (kind: Marker['kind'], label = '') => {
      if (state.recording === 'recording' || state.recording === 'paused') {
        const m = await recording.addMarker(kind, label);
        if (m) {
          const e = editingRef.current;
          if (e) {
            await e.writeWithoutHistory((d) => ({
              ...d,
              markers: [...d.markers.filter((x) => x.id !== m.id), m],
            }));
            syncFromEditing(e);
          }
        }
        return;
      }
      const src = resolveSource(state.doc.voice, state.playhead);
      if (!src) return;
      await apply(kind === 'mistake' ? t.undo.addMistakeMarker : t.undo.addMarker, (d) => ({
        ...d,
        markers: [
          ...d.markers,
          {
            id: services.newId(),
            takeId: src.takeId,
            srcSmp: src.srcSmp,
            label,
            kind,
            resolved: false,
          },
        ],
      }));
    },
    [
      apply,
      recording,
      services,
      state.doc.voice,
      state.playhead,
      state.recording,
      syncFromEditing,
      t,
    ],
  );

  const markersOnTimeline = useMemo(
    () =>
      state.doc.markers
        .map((m) => ({ marker: m, at: resolveTimeline(state.doc.voice, m.takeId, m.srcSmp) }))
        .filter((x): x is { marker: Marker; at: Smp } => x.at !== null)
        .sort((a, b) => a.at - b.at),
    [state.doc.markers, state.doc.voice],
  );

  const nextMarker = useCallback(async () => {
    const list = markersOnTimeline.filter((m) => !m.marker.resolved);
    if (!list.length) return null;
    const next = list.find((m) => m.at > state.playhead + 4800) ?? list[0]!;
    await seek(next.at);
    return next.marker;
  }, [markersOnTimeline, seek, state.playhead]);

  const resolveMarker = useCallback(
    (id: string) =>
      apply(t.undo.resolveMarker, (d) => ({
        ...d,
        markers: d.markers.map((m) => (m.id === id ? { ...m, resolved: true } : m)),
      })),
    [apply, t],
  );
  const removeMarker = useCallback(
    (id: string) =>
      apply(t.undo.removeMarker, (d) => ({ ...d, markers: d.markers.filter((m) => m.id !== id) })),
    [apply, t],
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
  const insertAsset = useCallback(
    async (asset: AssetRow, at: 'playhead' | 'recording') => {
      let anchor: OverlayClip['anchor'];
      if (at === 'recording') {
        const pos = recording.currentSourcePosition();
        if (!pos) return;
        anchor = { type: 'source', takeId: pos.takeId, srcSmp: pos.srcSmp };
      } else {
        const src = resolveSource(state.doc.voice, state.playhead);
        anchor = src
          ? { type: 'source', takeId: src.takeId, srcSmp: src.srcSmp }
          : { type: 'timeline_abs', smp: state.playhead };
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

  // ---- トークテーマ ----
  const saveTopics = useCallback(
    async (topics: Topic[]) => {
      await db.transaction(async () => {
        await db.run('DELETE FROM topics WHERE episode_id = ?', [episodeId]);
        let i = 0;
        for (const t of topics) {
          await db.run(
            'INSERT INTO topics (id, episode_id, position, text, checked_at) VALUES (?,?,?,?,?)',
            [t.id, episodeId, i++, t.text, t.checkedAt],
          );
        }
      });
      await loadTopics();
    },
    [db, episodeId, loadTopics],
  );
  const toggleTopic = useCallback(
    async (id: string) => {
      const t = state.topics.find((x) => x.id === id);
      if (!t) return;
      const checkedAt = t.checkedAt ? null : services.now();
      const pos = recording.currentSourcePosition();
      await db.run(
        'UPDATE topics SET checked_at = ?, checked_take_id = ?, checked_src_smp = ? WHERE id = ?',
        [checkedAt, pos?.takeId ?? null, pos?.srcSmp ?? null, id],
      );
      if (checkedAt && pos) await addMarker('topic', t.text);
      await loadTopics();
    },
    [addMarker, db, loadTopics, recording, services, state.topics],
  );

  return {
    state,
    markersOnTimeline,
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
    addMarker,
    nextMarker,
    resolveMarker,
    removeMarker,
    setSelectionStart,
    setSelectionEnd,
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
    saveTopics,
    toggleTopic,
    reloadAll,
  };
}

export type Editor = ReturnType<typeof useEditor>;
