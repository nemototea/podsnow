import { ZERO_SMP, type Smp } from '@/domain/time';
import type { SqlExecutor } from '@/infra/db/executor';

import type { HomeEpisodeItem } from '../home/HomeService';
import type { Subscription } from '../recording/RecorderPort';
import type { AudioEnginePort } from './AudioEnginePort';
import type { FilePlaybackPort } from './FilePlaybackPort';
import { renderDocumentFromDb } from './renderDocumentFromDb';

export interface PlaybackEvents {
  state: (e: { playing: boolean; frame: number; ended?: boolean }) => void;
  position: (e: { frame: number }) => void;
}

export interface ExportPlaybackItem {
  kind: 'export';
  homeKey: string;
  episodeId: string;
  exportId: string;
  title: string;
  episodeNumber: number;
  duration: Smp;
}

export interface RssPlaybackItem {
  kind: 'rss';
  homeKey: string;
  episodeId: string | null;
  feedEpisodeId: string;
  title: string;
  episodeNumber: number | null;
  duration: Smp;
}

export interface TimelinePlaybackItem {
  kind: 'timeline';
  episodeId: string;
  homeKey?: string;
  title?: string;
  episodeNumber?: number | null;
}

export type PlaybackSource = TimelinePlaybackItem | ExportPlaybackItem | RssPlaybackItem;
type PlaybackMode = 'timeline' | 'file' | null;

/** タイムラインと完成ファイルの再生状態をアプリ全体で 1 つだけ所有する。 */
export class PlaybackService {
  private subs: Subscription[] = [];
  private listeners = new Map<keyof PlaybackEvents, Set<(p: never) => void>>();
  private loadedEpisode: string | null = null;
  private total = 0;
  private frame = 0;
  private timelineTotal = 0;
  private timelineFrame = 0;
  private playing = false;
  private mode: PlaybackMode = null;
  private fileItem: ExportPlaybackItem | RssPlaybackItem | null = null;
  private timelineItem: TimelinePlaybackItem | null = null;

  constructor(
    private readonly deps: {
      db: SqlExecutor;
      engine: AudioEnginePort;
      filePlayer: FilePlaybackPort;
      fileExists: (path: string) => boolean;
      root: string;
    },
  ) {
    this.subs.push(
      deps.engine.on('onPlaybackState', (e) => {
        this.timelineFrame = e.frame;
        if (this.mode !== 'timeline') return;
        this.playing = e.playing;
        this.frame = e.frame;
        this.dispatch('state', e);
      }),
      deps.engine.on('onPosition', (e) => {
        this.timelineFrame = e.frame;
        if (this.mode !== 'timeline') return;
        this.frame = e.frame;
        this.dispatch('position', e);
      }),
      deps.filePlayer.onStatus((e) => {
        if (this.mode !== 'file') return;
        this.playing = e.playing;
        this.frame = e.position;
        this.total = e.duration;
        this.dispatch('state', { playing: e.playing, frame: e.position, ended: e.ended });
        this.dispatch('position', { frame: e.position });
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
  get duration(): Smp {
    return this.total as Smp;
  }
  get source(): PlaybackSource | null {
    if (this.mode === 'file') return this.fileItem;
    if (this.mode === 'timeline' && this.loadedEpisode) {
      return this.timelineItem ?? { kind: 'timeline', episodeId: this.loadedEpisode };
    }
    return null;
  }
  get loadedEpisodeId(): string | null {
    return this.loadedEpisode;
  }

  /** タイムラインを（再）読み込みする。ファイル再生中はその状態を奪わない。 */
  async reload(episodeId: string): Promise<void> {
    const wasPlaying = this.mode === 'timeline' && this.playing;
    const at = this.loadedEpisode === episodeId ? this.timelineFrame : 0;
    const doc = await renderDocumentFromDb(this.deps.db, this.deps.root, episodeId, {
      channels: 2,
    });
    await this.deps.engine.loadTimeline(JSON.stringify(doc));
    this.loadedEpisode = episodeId;
    this.timelineTotal = doc.totalFrames;
    if (this.mode !== 'file') {
      this.mode = 'timeline';
      this.total = doc.totalFrames;
      this.frame = Math.min(at, doc.totalFrames);
    }
    await this.deps.engine.seek(Math.min(at, doc.totalFrames));
    if (wasPlaying && doc.totalFrames > 0) await this.deps.engine.play(null);
  }

  async play(at?: Smp): Promise<void> {
    if (!this.loadedEpisode) return;
    this.deps.filePlayer.pause();
    this.mode = 'timeline';
    this.total = this.timelineTotal;
    this.frame = at ?? (this.timelineFrame as Smp);
    await this.deps.engine.play(at ?? null);
  }

  async pause(): Promise<void> {
    if (this.mode === 'file') this.deps.filePlayer.pause();
    else await this.deps.engine.pause();
  }

  async pauseTimeline(): Promise<void> {
    if (this.mode === 'timeline') await this.deps.engine.pause();
  }

  async stopForRecording(): Promise<void> {
    await this.pause();
  }

  /** 書き出しタブ・編集画面からの操作は常にタイムラインへ切り替える。 */
  async toggle(): Promise<void> {
    this.timelineItem = null;
    if (this.mode === 'timeline' && this.playing) await this.pauseTimeline();
    else await this.play(this.timelineFrame >= this.timelineTotal ? ZERO_SMP : undefined);
  }

  async seek(frame: Smp): Promise<void> {
    this.timelineFrame = frame;
    if (this.mode !== 'file') this.frame = frame;
    await this.deps.engine.seek(frame);
  }

  async seekHome(frame: Smp): Promise<void> {
    if (this.mode === 'timeline' && this.timelineItem?.homeKey) {
      await this.seek(frame);
      return;
    }
    if (this.mode !== 'file') return;
    const clamped = Math.max(0, Math.min(this.total, frame)) as Smp;
    this.frame = clamped;
    await this.deps.filePlayer.seek(clamped);
    this.dispatch('position', { frame: clamped });
  }

  private async exportForEpisode(
    episodeId: string,
  ): Promise<(Omit<ExportPlaybackItem, 'homeKey'> & { path: string }) | null> {
    const rows = await this.deps.db.all<{
      export_id: string;
      path: string;
      duration_smp: number;
      title: string;
      episode_number: number;
    }>(
      `SELECT x.id AS export_id, x.path, x.duration_smp, e.title, e.episode_number
         FROM exports x JOIN episodes e ON e.id = x.episode_id
        WHERE x.episode_id = ? AND x.status = 'done' AND x.path IS NOT NULL
        ORDER BY x.created_at DESC`,
      [episodeId],
    );
    for (const row of rows) {
      const abs = `${this.deps.root}/${row.path}`;
      if (this.deps.fileExists(abs)) {
        return {
          kind: 'export',
          episodeId,
          exportId: row.export_id,
          title: row.title,
          episodeNumber: row.episode_number,
          duration: row.duration_smp as Smp,
          path: abs,
        };
      }
    }
    return null;
  }

  async availableHomeItemKeys(items: readonly HomeEpisodeItem[]): Promise<Set<string>> {
    const keys = new Set<string>();
    for (const item of items) {
      if (item.local && (await this.exportForEpisode(item.local.id))) keys.add(item.key);
      else if (item.feed?.enclosure_url) keys.add(item.key);
      else if (item.local && item.local.duration_smp > 0) keys.add(item.key);
    }
    return keys;
  }

  /** Home の 1 行を、書き出し → 対応する RSS → タイムラインの順で再生する。 */
  async toggleHome(item: HomeEpisodeItem): Promise<boolean> {
    if (this.source?.homeKey === item.key) {
      return this.toggleCurrentHome();
    }
    const exported = item.local ? await this.exportForEpisode(item.local.id) : null;
    if (exported) {
      const { path, ...source } = exported;
      return this.startFile({ ...source, homeKey: item.key }, `file://${path}`);
    }
    if (item.feed?.enclosure_url) {
      return this.startFile(
        {
          kind: 'rss',
          homeKey: item.key,
          episodeId: item.local?.id ?? null,
          feedEpisodeId: item.feed.id,
          title: item.title,
          episodeNumber: item.episodeNumber,
          duration: (item.feed.duration_smp ?? 0) as Smp,
        },
        item.feed.enclosure_url,
      );
    }
    if (item.local && item.local.duration_smp > 0) {
      await this.deps.filePlayer.pause();
      await this.reload(item.local.id);
      this.timelineItem = {
        kind: 'timeline',
        homeKey: item.key,
        episodeId: item.local.id,
        title: item.title,
        episodeNumber: item.episodeNumber,
      };
      await this.play(this.timelineFrame >= this.timelineTotal ? ZERO_SMP : undefined);
      return true;
    }
    return false;
  }

  async toggleCurrentHome(): Promise<boolean> {
    if (!this.source?.homeKey) return false;
    if (this.playing) await this.pause();
    else if (this.mode === 'timeline') {
      await this.play(this.timelineFrame >= this.timelineTotal ? ZERO_SMP : undefined);
    } else {
      if (this.frame >= this.total) await this.deps.filePlayer.seek(ZERO_SMP);
      this.deps.filePlayer.play();
    }
    return true;
  }

  private async startFile(
    source: ExportPlaybackItem | RssPlaybackItem,
    uri: string,
  ): Promise<boolean> {
    await this.deps.engine.pause();
    await this.deps.filePlayer.load(uri, source.duration);
    this.fileItem = source;
    this.mode = 'file';
    this.frame = 0;
    this.total = source.duration;
    this.playing = true;
    this.deps.filePlayer.play();
    this.dispatch('state', { playing: true, frame: 0 });
    return true;
  }

  async release(): Promise<void> {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    await this.deps.engine.unload();
    this.deps.filePlayer.release();
    this.loadedEpisode = null;
    this.fileItem = null;
    this.timelineItem = null;
    this.mode = null;
    this.total = 0;
    this.timelineTotal = 0;
    this.timelineFrame = 0;
  }
}
