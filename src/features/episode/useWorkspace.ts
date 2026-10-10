import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { EditableDoc } from '@/domain/editing/doc';
import { smp, ZERO_SMP, type Smp } from '@/domain/time';
import { detectBlocks } from '@/domain/timeline/blocks';
import {
  overlaySourceLength,
  placeOverlays,
  suggestReanchor,
  timelineBounds,
  type PlacedOverlay,
} from '@/domain/timeline/overlays';
import type { OverlayClip, Range, VoiceSegment } from '@/domain/timeline/types';
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

/**
 * 録音前（本編が空）の回で、構成を並べて見せるための仮の本編の長さ（Issue #254）。
 * 「録音するとここに入ります」の枠の長さで、エンディングと BGM はこの後ろ・下に並ぶ。
 * 帯を動かしたときのずれも、この仮の本編に対して数える（本編に付くので、録れば追従する）。
 */
export const PLACEHOLDER_VOICE = smp(30 * 48000);

/** 構成を並べるときの本編。空なら仮の本編。 */
export function layoutVoice(voice: readonly VoiceSegment[]): readonly VoiceSegment[] {
  if (voice.length) return voice;
  return [
    {
      id: 'placeholder',
      takeId: 'placeholder',
      srcStart: ZERO_SMP,
      srcEnd: PLACEHOLDER_VOICE,
      gainDb: 0,
      fadeIn: ZERO_SMP,
      fadeOut: ZERO_SMP,
    },
  ];
}

export interface WorkspaceState {
  episode: EpisodeRow | null;
  doc: EditableDoc;
  takes: TakeRow[];
  assets: AssetRow[];
  assetDurations: Map<string, Smp>;
  placedOverlays: PlacedOverlay[];
  /**
   * 書き出す範囲（本編の始まりを 0 とした位置。Issue #254）。`start` は 0 以下で、オープニングを
   * 本編の前に置いていれば負になる。再生エンジンの位置は `start` を 0 とした位置なので、
   * やり取りのたびに `-start`（= 出力の 0 から本編の始まりまで）を足し引きする。
   */
  bounds: Range;
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
    bounds: { start: ZERO_SMP, end: ZERO_SMP },
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

  /** 出力の 0 から本編の始まりまで（サンプル）。再生エンジンとのやり取りで足し引きする（Issue #254）。 */
  const originRef = useRef(0);
  const durationsRef = useRef<Map<string, Smp>>(new Map());

  // ---- 読み込み ----
  const syncFromEditing = useCallback(
    (e: EditingService, extra: Partial<WorkspaceState> = {}, reveal = true) => {
      const doc = e.current;
      undoTopRef.current = e.undoTopId;
      // 再生エンジンとのやり取りに使うので、state の更新を待たずにここで求める
      if (extra.assetDurations) durationsRef.current = extra.assetDurations;
      const placed = placeOverlays(layoutVoice(doc.voice), doc.overlays, durationsRef.current);
      const bounds = timelineBounds(layoutVoice(doc.voice), placed);
      originRef.current = -bounds.start;
      patch((s) => {
        return {
          doc,
          // 素材の帯を動かしたときは画面を動かさない（指で触っている所から離れないように）
          revealSeq: reveal ? s.revealSeq + 1 : s.revealSeq,
          revealAt: reveal ? null : s.revealAt,
          total: totalDuration(doc.voice),
          placedOverlays: placed,
          bounds,
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
      // 保存してある再生位置は出力の位置（Home の再生と同じ）。編集画面は本編の位置で持つ
      syncFromEditing(e, { episode, takes, assets, assetDurations, ready: true });
      const saved = episode?.playhead_smp ?? 0;
      patch((s) => ({ playhead: smp(saved + s.bounds.start) }));
      await Promise.all([loadPeaks(takes), loadNotesAndEvents()]);
      await playback.reload(episodeId).catch(() => {});
      // 開いたとき・戻ってきたときは、再生エンジンの位置をこの回の保存位置に合わせる
      // （エンジンは 1 つなので、直前に開いていた別の回の位置が残っている）
      if ((opts.open || opts.refocus) && episode) {
        await playback.seek(smp(episode.playhead_smp ?? 0)).catch(() => {});
      }
    },
    [db, episodeId, loadPeaks, loadNotesAndEvents, patch, playback, services, syncFromEditing],
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
      const out = smp(to + originRef.current);
      await playback.seek(out).catch(() => {});
      void services.episodes.update(episodeId, { playheadSmp: out });
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
        patch({ playing: e.playing, playhead: smp(e.frame - originRef.current) });
      }),
      playback.on('position', (e) => {
        if (playback.loadedEpisodeId !== episodeId || playback.source?.kind !== 'timeline') return;
        patch({ playhead: smp(e.frame - originRef.current) });
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [episodeId, patch, placePlayhead, playback, recording, reloadAll]);

  // ---- 編集の共通ルート ----
  /**
   * 編集のあとに再生エンジンを読み直す。オープニングを動かすなどで本編の始まりの出力上の位置が
   * 変わったら、エンジンの位置も同じだけずらし、聴いている本編の位置を保つ（Issue #254）。
   */
  const reloadPlayback = useCallback(
    async (prevOrigin: number) => {
      await playback.reload(episodeId).catch(() => {});
      const delta = originRef.current - prevOrigin;
      if (delta !== 0 && playback.loadedEpisodeId === episodeId) {
        await playback.seek(smp(Math.max(0, playback.position + delta))).catch(() => {});
      }
    },
    [episodeId, playback],
  );

  // 録音中（割り込みで止まっている間も含む）は履歴に積まない。録音中の変更は
  // 止めたときに録音の追加と 1 つの操作にまとまる（Issue #122）。
  const apply = useCallback(
    async (
      label: string,
      mutate: (d: EditableDoc) => EditableDoc,
      groupKey?: string,
      opts: { reveal?: boolean } = {},
    ) => {
      const e = editingRef.current;
      if (!e || !recording.isIdle) return;
      const prevOrigin = originRef.current;
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
      syncFromEditing(e, {}, opts.reveal ?? true);
      await reloadPlayback(prevOrigin);
      services.loudness.contentChanged(episodeId);
      void services.episodes.refreshStatus(episodeId);
    },
    [
      episodeId,
      recording,
      reloadPlayback,
      services.episodes,
      services.loudness,
      syncFromEditing,
      t,
    ],
  );

  // 録音中（準備・停止処理を含む）は取り消せない。トーストの「取り消す」もここを通る。
  const undo = useCallback(async () => {
    const e = editingRef.current;
    if (!e || !recording.isIdle) return null;
    const prevOrigin = originRef.current;
    const op = await e.undo();
    syncFromEditing(e);
    await reloadPlayback(prevOrigin);
    services.loudness.contentChanged(episodeId);
    return op;
  }, [episodeId, recording, reloadPlayback, services.loudness, syncFromEditing]);

  const redo = useCallback(async () => {
    const e = editingRef.current;
    if (!e || !recording.isIdle) return null;
    const prevOrigin = originRef.current;
    const op = await e.redo();
    syncFromEditing(e);
    await reloadPlayback(prevOrigin);
    services.loudness.contentChanged(episodeId);
    return op;
  }, [episodeId, recording, reloadPlayback, services.loudness, syncFromEditing]);

  // ---- 再生 ----
  // 位置は本編の位置。オープニングの上（負）からエンディングの終わりまで動ける（Issue #254）
  const seek = useCallback(
    async (to: Smp) => {
      const t = smp(Math.max(state.bounds.start, Math.min(state.bounds.end, to)));
      patch((s) => ({ playhead: t, revealSeq: s.revealSeq + 1, revealAt: null }));
      const out = smp(t + originRef.current);
      await playback.seek(out);
      void services.episodes.update(episodeId, { playheadSmp: out });
    },
    [episodeId, patch, playback, services.episodes, state.bounds],
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
    // オープニングの上（本編より前）から録るときは、本編の頭に差し込む
    const at =
      state.total > 0 && state.playhead < state.total ? smp(Math.max(0, state.playhead)) : null;
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
    await playback.playRange(smp(sel.start + originRef.current), smp(sel.end + originRef.current));
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
        { reveal: false },
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

  /**
   * 素材の帯を引いて動かした（Issue #254）。`start` は帯の新しい始まり（本編の位置）。
   * オープニング・エンディング・BGM は本編の始まり / 終わりに付けたまま、ずれだけを変える。
   * BGM は長さを保ったまま両端を動かす。ほかの素材は発言に付け直す（`moveOverlayTo` と同じ）。
   */
  const moveOverlay = useCallback(
    (id: string, start: Smp) =>
      updateOverlay(id, t.undo.moveAsset, (o) => {
        const total = totalDuration(layoutVoice(state.doc.voice));
        const placed = state.placedOverlays.find((p) => p.clip.id === o.id);
        if (o.anchor.type === 'timeline_start') {
          const delta = start - o.anchor.offset;
          return {
            ...o,
            anchor: { type: 'timeline_start', offset: start },
            ...(o.endMode === 'timeline_end' ? { endOffset: smp((o.endOffset ?? 0) + delta) } : {}),
          };
        }
        if (o.anchor.type === 'timeline_end') {
          const len = overlaySourceLength(o, state.assetDurations.get(o.assetId) ?? ZERO_SMP);
          return { ...o, anchor: { type: 'timeline_end', offset: smp(start - (total - len)) } };
        }
        if (!placed || placed.status !== 'placed') return o;
        const src = resolveSource(state.doc.voice, start);
        return {
          ...o,
          anchor: src
            ? { type: 'source', takeId: src.takeId, srcSmp: src.srcSmp }
            : { type: 'timeline_abs', smp: start },
        };
      }),
    [state.assetDurations, state.doc.voice, state.placedOverlays, t, updateOverlay],
  );

  /** BGM の端を引いた（Issue #254）。始まりは本編の始まりから、終わりは本編の終わりからのずれで持つ。 */
  const resizeOverlay = useCallback(
    (id: string, edge: 'start' | 'end', at: Smp) =>
      updateOverlay(id, t.undo.resizeAsset, (o) => {
        if (o.endMode !== 'timeline_end' || o.anchor.type !== 'timeline_start') return o;
        if (edge === 'start') return { ...o, anchor: { type: 'timeline_start', offset: at } };
        const total = totalDuration(layoutVoice(state.doc.voice));
        return { ...o, endOffset: smp(at - total) };
      }),
    [state.doc.voice, t, updateOverlay],
  );

  /** 帯の上の丸を引いてフェードの長さを変えた（Issue #254）。 */
  const setOverlayFades = useCallback(
    (id: string, fadeIn: Smp, fadeOut: Smp) =>
      updateOverlay(id, t.undo.changeFade, (o) => ({ ...o, fadeIn, fadeOut })),
    [t, updateOverlay],
  );

  /** この回のオープニング・エンディング・BGM の並びを番組の既定にする（Issue #254）。 */
  const saveStructureAsDefault = useCallback(
    () => services.episodes.saveStructureAsDefault(episodeId),
    [episodeId, services.episodes],
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
    moveOverlay,
    resizeOverlay,
    setOverlayFades,
    saveStructureAsDefault,
    /** 本編の位置を、出力（書き出し・再生）の位置に直す。画面に出す時刻に使う（Issue #254）。 */
    toOutput: (at: Smp) => smp(at - state.bounds.start),
    selectOverlay: (id: string | null) => patch({ selectedOverlay: id, selection: null }),
    saveNotes,
    reloadAll,
    refocus,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
