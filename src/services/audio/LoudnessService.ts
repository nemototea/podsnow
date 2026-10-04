import {
  findCachedGain,
  interimGain,
  LOUDNESS_ALGO,
  shiftGain,
} from '@/domain/render/loudnessCache';
import type { SqlExecutor } from '@/infra/db/executor';
import { getLoudnessCache, saveLoudnessMeasure } from '@/infra/db/repositories/loudnessCacheRepo';

import { currentSourceFingerprint } from '../export/sourceFingerprint';
import type { Subscription } from '../recording/RecorderPort';
import type { AudioEnginePort } from './AudioEnginePort';
import type { PlaybackService } from './PlaybackService';
import {
  parseSoundSettings,
  renderDocumentFromDb,
  type SoundSettings,
} from './renderDocumentFromDb';

/** 書き出しタブに出す測定の状態。 */
export interface LoudnessStatus {
  /** 測っている（「音量を測っています」）。 */
  measuring: boolean;
  /** 0〜1。 */
  progress: number;
}

export interface LoudnessDeps {
  db: SqlExecutor;
  root: string;
  engine: AudioEnginePort;
  playback: Pick<PlaybackService, 'setTimelineSound'>;
  now: () => number;
  /** 変更が止まってから測るまでの待ち（ms）。 */
  debounceMs?: number;
}

const IDLE: LoudnessStatus = { measuring: false, progress: 0 };

/**
 * 試聴の正規化のゲイン（AUDIO_DESIGN.md §7.1 / §8.4、Issue #158）。
 *
 * 書き出しタブを開いている間だけ働く（`activate` 〜 `deactivate`）。今の音のゲインが保存してあればそれで鳴らし、
 * 無ければ前回の値（無ければ調整なし）で鳴らしながら裏で測る。測り終わったら保存し、再生を止めずに差し替える。
 */
export class LoudnessService {
  private active: { episodeId: string; channels: 1 | 2 } | null = null;
  private job: { jobId: string; episodeId: string; channels: 1 | 2; fingerprint: string } | null =
    null;
  /** 今の試聴にかけているゲイン（目標だけを変えたときにずらす元）。 */
  private applied: { sound: SoundSettings; gainDb: number | null } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private suspended = false;
  /** 古い refresh の結果で新しい状態を上書きしないよう数える。 */
  private seq = 0;
  private status: LoudnessStatus = IDLE;
  private listeners = new Set<(s: LoudnessStatus) => void>();
  private subs: Subscription[] = [];

  constructor(private readonly deps: LoudnessDeps) {
    const e = deps.engine;
    this.subs.push(
      e.on('onMeasureProgress', (ev) => void this.onProgress(ev)),
      e.on('onMeasureDone', (ev) => void this.onDone(ev)),
      e.on('onMeasureError', (ev) => this.onError(ev)),
    );
  }

  getStatus(): LoudnessStatus {
    return this.status;
  }

  onStatus(fn: (s: LoudnessStatus) => void): Subscription {
    this.listeners.add(fn);
    return { remove: () => this.listeners.delete(fn) };
  }

  /** 書き出しタブを開いた・書き出しのチャンネル数が変わった。すぐ確かめ、要れば測る。 */
  async activate(episodeId: string, channels: 1 | 2): Promise<void> {
    const same = this.active?.episodeId === episodeId && this.active.channels === channels;
    this.active = { episodeId, channels };
    if (!same) this.applied = null;
    await this.refresh();
  }

  /** 書き出しタブを離れた。測定を止め、試聴を調整なしに戻す（編集タブは正規化しない、§7.1 の決めたこと 1）。 */
  async deactivate(): Promise<void> {
    const a = this.active;
    this.active = null;
    this.applied = null;
    this.clearTimer();
    this.cancelJob();
    this.setStatus(IDLE);
    if (!a) return;
    const sound = await this.loadSound(a.episodeId);
    await this.deps.playback.setTimelineSound(a.episodeId, sound, null).catch(() => {});
  }

  /**
   * 音の仕上げが変わった（書き出しタブで設定を変えた）。読み直さずにすぐ反映し、ゲインは測り直す。
   * 目標だけを変えたなら、測り直すまで目標の差だけゲインをずらす（§7.1 の表）。
   */
  async soundChanged(episodeId: string, prev: SoundSettings, next: SoundSettings): Promise<void> {
    const a = this.active;
    if (!a || a.episodeId !== episodeId) {
      // 書き出しタブ以外: ダッキングだけを読み直さずに反映する
      await this.deps.playback.setTimelineSound(episodeId, next, null);
      return;
    }
    const cur = this.applied?.gainDb ?? null;
    const gain =
      cur == null ? null : shiftGain(cur, prev.loudness.targetLufs, next.loudness.targetLufs);
    await this.apply(a, next, gain);
    this.schedule();
  }

  /** 声の並び・素材が変わった（取り消しを含む）。書き出しタブを開いていれば測り直す。 */
  contentChanged(episodeId: string): void {
    if (this.active?.episodeId === episodeId) this.schedule();
  }

  /** 書き出しの間は測らない（書き出しが測ってキャッシュを書く、§8.4）。終わったら測り直しを確かめる。 */
  setExporting(exporting: boolean): void {
    this.suspended = exporting;
    if (exporting) {
      this.clearTimer();
      this.cancelJob();
      this.setStatus(IDLE);
    } else if (this.active) {
      void this.refresh();
    }
  }

  release(): void {
    this.clearTimer();
    this.cancelJob();
    this.subs.forEach((s) => s.remove());
    this.subs = [];
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, this.deps.debounceMs ?? 1000);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private cancelJob(): void {
    if (!this.job) return;
    const id = this.job.jobId;
    this.job = null;
    this.deps.engine.cancelMeasure(id);
  }

  private setStatus(s: LoudnessStatus): void {
    if (s.measuring === this.status.measuring && s.progress === this.status.progress) return;
    this.status = s;
    this.listeners.forEach((fn) => fn(s));
  }

  private async loadSound(episodeId: string): Promise<SoundSettings> {
    const ep = await this.deps.db.get<{ sound_settings: string }>(
      'SELECT sound_settings FROM episodes WHERE id = ?',
      [episodeId],
    );
    return parseSoundSettings(ep?.sound_settings);
  }

  private async apply(
    a: { episodeId: string; channels: 1 | 2 },
    sound: SoundSettings,
    gainDb: number | null,
  ): Promise<void> {
    this.applied = { sound, gainDb };
    await this.deps.playback
      .setTimelineSound(a.episodeId, sound, { channels: a.channels, gainDb })
      .catch(() => {});
  }

  /** 今の音のゲインを確かめる。保存してあれば使い、無ければ仮の値で鳴らしながら測る。 */
  private async refresh(): Promise<void> {
    const a = this.active;
    if (!a) return;
    const seq = ++this.seq;
    const { db, root } = this.deps;
    const [fingerprint, sound, entries] = await Promise.all([
      currentSourceFingerprint(db, a.episodeId),
      this.loadSound(a.episodeId),
      getLoudnessCache(db, a.episodeId),
    ]);
    if (seq !== this.seq || this.active !== a) return;
    const running = this.job;
    if (running && running.fingerprint === fingerprint && running.channels === a.channels) return;
    this.cancelJob();
    if (!sound.loudness.enabled) {
      // 正規化しない: 測らない（ネイティブはゲイン・リミッターをかけない）
      await this.apply(a, sound, null);
      this.setStatus(IDLE);
      return;
    }
    const cached = findCachedGain(entries, fingerprint, a.channels);
    if (cached != null) {
      await this.apply(a, sound, cached);
      this.setStatus(IDLE);
      return;
    }
    // 測り終わるまでは、今かけているゲイン → 無ければ前回の値 → 無ければ調整なし
    const holding = this.applied?.gainDb ?? interimGain(entries, a.channels, sound.loudness);
    await this.apply(a, sound, holding);
    if (this.suspended) return;
    const doc = await renderDocumentFromDb(db, root, a.episodeId, { channels: a.channels });
    if (seq !== this.seq || this.active !== a) return;
    if (doc.totalFrames <= 0) {
      this.setStatus(IDLE);
      return;
    }
    const jobId = this.deps.engine.measureLoudness(JSON.stringify(doc));
    this.job = { jobId, episodeId: a.episodeId, channels: a.channels, fingerprint };
    this.setStatus({ measuring: true, progress: 0 });
  }

  private async onProgress(ev: { jobId: string; progress: number; gainDb?: number | null }) {
    const j = this.job;
    if (!j || j.jobId !== ev.jobId || !this.active) return;
    this.setStatus({ measuring: true, progress: ev.progress });
    if (ev.gainDb != null && this.applied)
      await this.apply(this.active, this.applied.sound, ev.gainDb);
  }

  private async onDone(ev: { jobId: string; gainDb: number; inputLufs: number; algo: number }) {
    const j = this.job;
    if (!j || j.jobId !== ev.jobId) return;
    this.job = null;
    const sound = await this.loadSound(j.episodeId);
    await saveLoudnessMeasure(this.deps.db, j.episodeId, {
      fingerprint: j.fingerprint,
      channels: j.channels,
      algo: ev.algo ?? LOUDNESS_ALGO,
      gainDb: ev.gainDb,
      targetLufs: sound.loudness.targetLufs,
      inputLufs: ev.inputLufs > -70 ? ev.inputLufs : null,
      measuredAt: this.deps.now(),
    });
    const a = this.active;
    if (a && a.episodeId === j.episodeId && a.channels === j.channels) {
      await this.apply(a, this.applied?.sound ?? sound, ev.gainDb);
    }
    this.setStatus(IDLE);
  }

  private onError(ev: { jobId: string }) {
    if (!this.job || this.job.jobId !== ev.jobId) return;
    // 測れなかった: 仮の値のまま鳴らし続ける（次の変更か、タブを開き直したときに測り直す）
    this.job = null;
    this.setStatus(IDLE);
  }
}
