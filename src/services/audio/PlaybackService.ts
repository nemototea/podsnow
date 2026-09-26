import { ZERO_SMP, type Smp } from '@/domain/time';
import type { SqlExecutor } from '@/infra/db/executor';

import type { Subscription } from '../recording/RecorderPort';
import type { AudioEnginePort } from './AudioEnginePort';
import { renderDocumentFromDb } from './renderDocumentFromDb';

export interface PlaybackEvents {
  state: (e: { playing: boolean; frame: number; ended?: boolean }) => void;
  position: (e: { frame: number }) => void;
}

/**
 * Editor のタイムライン再生。編集のたびに reload() で RenderDocument を作り直す
 * （書き出しと同じレンダラなので、聴いた通りに書き出せる）。
 */
export class PlaybackService {
  private subs: Subscription[] = [];
  private listeners = new Map<keyof PlaybackEvents, Set<(p: never) => void>>();
  private loadedEpisode: string | null = null;
  /** 読み込んだタイムラインの長さ。 */
  private total = 0;
  private frame = 0;
  private playing = false;

  constructor(private readonly deps: { db: SqlExecutor; engine: AudioEnginePort; root: string }) {
    this.subs.push(
      deps.engine.on('onPlaybackState', (e) => {
        this.playing = e.playing;
        this.frame = e.frame;
        this.dispatch('state', e);
      }),
      deps.engine.on('onPosition', (e) => {
        this.frame = e.frame;
        this.dispatch('position', e);
      }),
    );
  }

  on<K extends keyof PlaybackEvents>(event: K, fn: PlaybackEvents[K]): Subscription {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as (p: never) => void);
    return { remove: () => set.delete(fn as (p: never) => void) };
  }

  private dispatch<K extends keyof PlaybackEvents>(
    event: K,
    payload: Parameters<PlaybackEvents[K]>[0],
  ) {
    this.listeners.get(event)?.forEach((fn) => (fn as (p: unknown) => void)(payload));
  }

  get isPlaying(): boolean {
    return this.playing;
  }
  get position(): Smp {
    return this.frame as Smp;
  }
  /** いま読み込んでいるエピソード。画面が重なっているとき、自分の回かどうかを見分ける。 */
  get loadedEpisodeId(): string | null {
    return this.loadedEpisode;
  }

  /** タイムラインを（再）読み込みする。再生中なら位置を保って続ける。 */
  async reload(episodeId: string): Promise<void> {
    const wasPlaying = this.playing;
    const at = this.frame;
    // 試聴はステレオで鳴らす。ステレオ録音の左右をそのまま聴けるように（モノラル素材は左右同じ）。
    const doc = await renderDocumentFromDb(this.deps.db, this.deps.root, episodeId, {
      channels: 2,
    });
    await this.deps.engine.loadTimeline(JSON.stringify(doc));
    this.loadedEpisode = episodeId;
    this.total = doc.totalFrames;
    await this.deps.engine.seek(Math.min(at, doc.totalFrames));
    if (wasPlaying && doc.totalFrames > 0) await this.deps.engine.play(null);
  }

  async play(at?: Smp): Promise<void> {
    if (!this.loadedEpisode) return;
    await this.deps.engine.play(at ?? null);
  }

  async pause(): Promise<void> {
    await this.deps.engine.pause();
  }

  /**
   * 再生 / 一時停止。末尾にいるときは先頭から鳴らす。収録を止めると再生位置は末尾に
   * 置かれるので、そのまま押すと何も鳴らずに終わってしまう（Issue #134）。
   */
  async toggle(): Promise<void> {
    if (this.playing) await this.pause();
    else await this.play(this.frame >= this.total ? ZERO_SMP : undefined);
  }

  async seek(frame: Smp): Promise<void> {
    this.frame = frame;
    await this.deps.engine.seek(frame);
  }

  async release(): Promise<void> {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    await this.deps.engine.unload();
    this.loadedEpisode = null;
    this.total = 0;
  }
}
