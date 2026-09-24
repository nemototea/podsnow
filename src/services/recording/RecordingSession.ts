import { AppError, type AppErrorCode } from '@/domain/errors';
import { smp, type Smp } from '@/domain/time';
import type { Range } from '@/domain/timeline/types';
import { insertAt, keptIntervals } from '@/domain/timeline/voice';
import type { SqlExecutor } from '@/infra/db/executor';
import { loadDoc, saveDoc } from '@/infra/db/repositories/editableDocRepo';
import {
  insertRecordingEvent,
  type RecordingEvent,
  type RecordingEventKind,
} from '@/infra/db/repositories/recordingEventsRepo';
import {
  closeJournal,
  closeSegment,
  countTakes,
  finalizeTake,
  heartbeatJournal,
  insertSegment,
  insertTake,
  openJournal,
  type SegmentCloseReason,
} from '@/infra/db/repositories/takesRepo';
import { joinRoot, relPaths } from '@/infra/files/layout';

import type { ServiceLabels } from '../app/labels';

import type {
  InterruptionEvent,
  LevelEvent,
  RouteChangeEvent,
  SegmentClosedEvent,
} from '../../../modules/podsnow-recorder/src/PodsnowRecorder.types';
import type { RecorderPort, Subscription } from './RecorderPort';

export type SessionState =
  'idle' | 'preparing' | 'recording' | 'paused' | 'interrupted' | 'stopping';

export interface RecordingSettings {
  sampleRate: number;
  channels: 1 | 2;
  inputUid: string | null;
  /** 割り込み終了後に OS が再開を推奨していれば自動で再開する。 */
  autoResumeAfterInterruption: boolean;
  /** 録音前に必要とみなす想定時間（分）。 */
  expectedMinutes: number;
  /** この空き容量を下回ったら開始を拒否 / 停止する（bytes）。 */
  diskLowThresholdBytes: number;
  androidAudioSource?: 'mic' | 'voice_recognition' | 'unprocessed' | 'camcorder';
}

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  sampleRate: 48000,
  channels: 2,
  inputUid: null,
  autoResumeAfterInterruption: false,
  expectedMinutes: 60,
  diskLowThresholdBytes: 30 * 1024 * 1024,
};

export interface RecordingSessionDeps {
  db: SqlExecutor;
  recorder: RecorderPort;
  /** データルートの絶対パス。 */
  root: string;
  ensureDir: (absDir: string) => void;
  newId: () => string;
  now: () => number;
  settings: () => RecordingSettings;
  /** DB に書き込む文言（割り込みマーカー）。UI 層が i18n から渡す（Issue #80）。 */
  labels: () => ServiceLabels;
  /** 1 秒ごとのハートビート用タイマー。テストで差し替える。 */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

export interface SessionEvents {
  state: (s: SessionState) => void;
  level: (e: LevelEvent) => void;
  /** Take が確定して声トラックに追加された。 */
  takeFinalized: (e: { takeId: string; episodeId: string; durationSmp: Smp }) => void;
  interruption: (e: InterruptionEvent) => void;
  routeChange: (e: RouteChangeEvent) => void;
  /** `code` があれば UI は i18n から文言を引く。無ければ `message` をそのまま出す。 */
  error: (e: { message: string; code?: AppErrorCode }) => void;
  diskLow: (e: { availableBytes: number }) => void;
}

interface ActiveTake {
  episodeId: string;
  takeId: string;
  /** 声トラック上の挿入位置。null = 末尾。 */
  insertAtSmp: Smp | null;
  segmentId: string;
  seq: number;
  /** 先行 Segment の合計フレーム。 */
  offsetSmp: number;
  path: string;
  /** 「言い直す」で捨てた Take 内の範囲（FR-REC-4）。確定時に声の並びから外す。 */
  drops: Range[];
}

/**
 * 録音セッションの状態機械（ARCHITECTURE.md §8.1）。
 * Take / Segment / recovery_journal を DB に書き、ネイティブ録音モジュールのイベントに応じて
 * Segment の確定・割り込み後の再開・Take の確定（声トラックへの追加）を行う。
 */
export class RecordingSession {
  private state: SessionState = 'idle';
  private active: ActiveTake | null = null;
  private subs: Subscription[] = [];
  private listeners = new Map<keyof SessionEvents, Set<(p: never) => void>>();
  private heartbeat: unknown = null;

  constructor(private readonly deps: RecordingSessionDeps) {
    const r = deps.recorder;
    this.subs.push(
      r.on('onLevel', (e) => this.dispatch('level', e)),
      r.on('onSegmentClosed', (e) => void this.handleSegmentClosed(e)),
      r.on('onInterruption', (e) => void this.handleInterruption(e)),
      r.on('onRouteChange', (e) => this.dispatch('routeChange', e)),
      r.on('onError', (e) => this.dispatch('error', { message: e.message })),
      r.on('onDiskLow', (e) => this.dispatch('diskLow', e)),
    );
  }

  get current(): SessionState {
    return this.state;
  }
  get activeTakeId(): string | null {
    return this.active?.takeId ?? null;
  }

  on<K extends keyof SessionEvents>(event: K, fn: SessionEvents[K]): Subscription {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as (p: never) => void);
    return { remove: () => set.delete(fn as (p: never) => void) };
  }

  private dispatch<K extends keyof SessionEvents>(
    event: K,
    payload: Parameters<SessionEvents[K]>[0],
  ) {
    this.listeners.get(event)?.forEach((fn) => (fn as (p: unknown) => void)(payload));
  }

  private setState(s: SessionState) {
    if (this.state !== s) {
      this.state = s;
      this.dispatch('state', s);
    }
  }

  /** 録音に必要な空き容量（bytes）。 */
  requiredBytes(): number {
    const s = this.deps.settings();
    return s.expectedMinutes * 60 * s.sampleRate * s.channels * 2 + 200 * 1024 * 1024;
  }

  async checkDiskSpace(): Promise<{ ok: boolean; availableBytes: number; requiredBytes: number }> {
    const availableBytes = await this.deps.recorder.getAvailableDiskBytes(this.deps.root);
    const requiredBytes = this.requiredBytes();
    return { ok: availableBytes >= requiredBytes, availableBytes, requiredBytes };
  }

  /**
   * 新しい Take の録音を開始する。insertAtSmp を渡すと停止時にその位置へ挿入（パンチイン）、
   * null なら末尾に追加。
   */
  async start(
    episodeId: string,
    opts: { insertAtSmp?: Smp | null; name?: string } = {},
  ): Promise<string> {
    if (this.state !== 'idle') throw new Error(`start: invalid state ${this.state}`);
    this.setState('preparing');
    try {
      const s = this.deps.settings();
      const disk = await this.checkDiskSpace();
      if (!disk.ok) {
        throw new AppError('disk_space_insufficient', {
          requiredMb: Math.round(disk.requiredBytes / 1048576),
          availableMb: Math.round(disk.availableBytes / 1048576),
        });
      }
      await this.deps.recorder.prepare({
        sampleRate: s.sampleRate,
        channels: s.channels,
        inputUid: s.inputUid,
        diskLowThresholdBytes: s.diskLowThresholdBytes,
        // 通知の文言は表示言語を知っている UI 層から来る（Issue #80）。
        androidNotification: this.deps.labels().androidNotification,
        ...(s.androidAudioSource ? { androidAudioSource: s.androidAudioSource } : {}),
      });
      const input = await this.deps.recorder.getCurrentInput();
      const now = this.deps.now();
      const takeId = this.deps.newId();
      const n = (await countTakes(this.deps.db, episodeId)) + 1;
      await insertTake(this.deps.db, {
        id: takeId,
        episodeId,
        name: opts.name ?? this.deps.labels().takeName(n),
        sampleRate: s.sampleRate,
        channels: s.channels,
        inputLabel: input?.name ?? null,
        now,
      });
      this.active = {
        episodeId,
        takeId,
        insertAtSmp: opts.insertAtSmp ?? null,
        segmentId: '',
        seq: 0,
        offsetSmp: 0,
        path: '',
        drops: [],
      };
      await this.openSegment();
      this.setState('recording');
      return takeId;
    } catch (e) {
      this.active = null;
      this.setState('idle');
      throw e;
    }
  }

  private async openSegment(): Promise<void> {
    const a = this.active!;
    const seq = a.seq + 1;
    const rel = relPaths.segmentFile(a.episodeId, a.takeId, seq);
    const abs = joinRoot(this.deps.root, rel);
    this.deps.ensureDir(joinRoot(this.deps.root, relPaths.takeDir(a.episodeId, a.takeId)));
    const segmentId = this.deps.newId();
    const now = this.deps.now();
    await this.deps.db.transaction(async () => {
      await insertSegment(this.deps.db, {
        id: segmentId,
        takeId: a.takeId,
        seq,
        path: rel,
        offsetSmp: a.offsetSmp,
      });
      await openJournal(this.deps.db, { id: this.deps.newId(), takeId: a.takeId, segmentId, now });
    });
    a.segmentId = segmentId;
    a.seq = seq;
    a.path = abs;
    await this.deps.recorder.start(abs);
    this.startHeartbeat();
  }

  async pause(): Promise<void> {
    if (this.state !== 'recording') return;
    await this.deps.recorder.pause();
    this.setState('paused');
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    await this.deps.recorder.resume();
    this.setState('recording');
  }

  /** 停止して Take を確定する。戻り値は Take の総フレーム数。 */
  async stop(): Promise<{ takeId: string; durationSmp: Smp } | null> {
    if (!this.active) return null;
    if (this.state === 'interrupted') {
      // 割り込みで Segment はすでに閉じている。Take を確定するだけ。
      return this.finalizeTake();
    }
    if (this.state !== 'recording' && this.state !== 'paused') return null;
    this.setState('stopping');
    this.stopHeartbeat();
    // onSegmentClosed イベントと stop() の解決はどちらが先か保証されないので、両方から冪等に閉じる。
    const result = await this.deps.recorder.stop();
    await this.closeActiveSegment(result.frames, 'stop');
    return this.finalizeTake();
  }

  /** 割り込み後に手動で再開する（新しい Segment を開く）。 */
  async resumeAfterInterruption(): Promise<void> {
    if (this.state !== 'interrupted' || !this.active) return;
    await this.openSegment();
    await this.recordEvent('interruption', this.deps.labels().interruptionNote);
    this.setState('recording');
  }

  async release(): Promise<void> {
    this.stopHeartbeat();
    if (this.active) await this.stop();
    await this.deps.recorder.release();
    this.subs.forEach((s) => s.remove());
    this.subs = [];
  }

  // ---- ネイティブイベント ----

  private closedSegments = new Set<string>();
  private closing: Promise<void> = Promise.resolve();

  /** 現在の Segment を DB 上で確定する（冪等）。 */
  private closeActiveSegment(frames: number, reason: SegmentCloseReason): Promise<void> {
    const a = this.active;
    if (!a || this.closedSegments.has(a.segmentId)) return this.closing;
    this.closedSegments.add(a.segmentId);
    const segmentId = a.segmentId;
    this.stopHeartbeat();
    this.closing = this.closing.then(async () => {
      await this.deps.db.transaction(async () => {
        await closeSegment(this.deps.db, segmentId, frames, reason);
        await closeJournal(this.deps.db, segmentId);
      });
      a.offsetSmp += frames;
    });
    return this.closing;
  }

  private async handleSegmentClosed(e: SegmentClosedEvent): Promise<void> {
    if (!this.active) return;
    const reason: SegmentCloseReason =
      e.reason === 'media_reset' ? 'interruption' : (e.reason as SegmentCloseReason);
    await this.closeActiveSegment(e.frames, reason);
    if (reason === 'disk_low' || reason === 'error') {
      // ネイティブが安全停止した。Take を確定する。
      await this.finalizeTake();
    }
  }

  private async handleInterruption(e: InterruptionEvent): Promise<void> {
    this.dispatch('interruption', e);
    if (!this.active) return;
    if (e.type === 'began') {
      if (this.state === 'recording' || this.state === 'paused') this.setState('interrupted');
      return;
    }
    if (
      this.state === 'interrupted' &&
      e.shouldResume &&
      this.deps.settings().autoResumeAfterInterruption
    ) {
      try {
        await this.resumeAfterInterruption();
      } catch (err) {
        this.dispatch('error', {
          code: 'recording_resume_failed',
          message: `recording_resume_failed: ${(err as Error).message}`,
        });
      }
    }
  }

  // ---- Take の確定 ----

  private async finalizeTake(): Promise<{ takeId: string; durationSmp: Smp } | null> {
    await this.closing;
    const a = this.active;
    if (!a) return null;
    this.active = null;
    this.stopHeartbeat();
    const durationSmp = smp(a.offsetSmp);
    const now = this.deps.now();
    await this.deps.db.transaction(async () => {
      await finalizeTake(
        this.deps.db,
        a.takeId,
        durationSmp > 0 ? 'ready' : 'failed',
        durationSmp,
        now,
      );
      if (durationSmp > 0) {
        const doc = await loadDoc(this.deps.db, a.episodeId);
        // 「言い直す」で捨てた範囲は声の並びに載せない。録音ファイルはそのまま残る（非破壊）。
        const kept = keptIntervals(durationSmp, a.drops);
        let voice = doc.voice;
        let offset = 0;
        for (const k of kept) {
          const seg = {
            id: this.deps.newId(),
            takeId: a.takeId,
            srcStart: k.start,
            srcEnd: k.end,
            gainDb: 0,
            fadeIn: smp(0),
            fadeOut: smp(0),
          };
          if (a.insertAtSmp === null) {
            voice = [...voice, seg];
          } else {
            voice = insertAt(voice, smp(a.insertAtSmp + offset), seg);
            offset += k.end - k.start;
          }
        }
        await saveDoc(this.deps.db, a.episodeId, { ...doc, voice }, now);
      }
    });
    this.setState('idle');
    if (durationSmp > 0) {
      this.dispatch('takeFinalized', { takeId: a.takeId, episodeId: a.episodeId, durationSmp });
    }
    return { takeId: a.takeId, durationSmp };
  }

  /**
   * 現在の録音位置（Take 座標）に「録音中の出来事」を記録する（DATA_MODEL.md §4.10）。
   * アプリが自動で記録するものだけで、ユーザーが打つマーカーは持たない（FR-REC-4 廃止）。
   */
  async recordEvent(kind: RecordingEventKind, label = ''): Promise<RecordingEvent | null> {
    const a = this.active;
    if (!a) return null;
    const e: RecordingEvent = {
      id: this.deps.newId(),
      takeId: a.takeId,
      srcSmp: smp(a.offsetSmp + this.deps.recorder.getFrames()),
      label,
      kind,
      createdAt: this.deps.now(),
    };
    await insertRecordingEvent(this.deps.db, a.episodeId, e);
    return e;
  }

  /**
   * 言い直す（FR-REC-4）。`fromSrcSmp` から今までを声の並びから外し、録音は止めない。
   * 録音ファイルには残るので非破壊で、`undoRetake()` で戻せる。
   * 戻り値は捨てた長さ。録音中でない、または長さが 0 なら null。
   */
  retake(fromSrcSmp: Smp): Smp | null {
    const a = this.active;
    if (!a) return null;
    const now = smp(a.offsetSmp + this.deps.recorder.getFrames());
    const from = smp(Math.max(0, Math.min(now, fromSrcSmp)));
    if (now - from <= 0) return null;
    a.drops.push({ start: from, end: now });
    return smp(now - from);
  }

  /** 直前の「言い直す」を取り消す。 */
  undoRetake(): boolean {
    const a = this.active;
    if (!a || !a.drops.length) return false;
    a.drops.pop();
    return true;
  }

  /** 現在の録音位置（Take 座標）。録音中でなければ null。 */
  currentSourcePosition(): { takeId: string; srcSmp: Smp } | null {
    const a = this.active;
    if (!a) return null;
    return { takeId: a.takeId, srcSmp: smp(a.offsetSmp + this.deps.recorder.getFrames()) };
  }

  // ---- ハートビート ----

  private startHeartbeat() {
    this.stopHeartbeat();
    const set = this.deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.heartbeat = set(() => {
      const a = this.active;
      if (!a) return;
      const s = this.deps.settings();
      const bytes = 44 + this.deps.recorder.getFrames() * s.channels * 2;
      void heartbeatJournal(this.deps.db, a.segmentId, this.deps.now(), bytes).catch(() => {});
    }, 1000);
  }

  private stopHeartbeat() {
    if (this.heartbeat !== null) {
      const clear =
        this.deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
      clear(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
