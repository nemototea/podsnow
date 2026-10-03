import type { AppErrorCode } from '@/domain/errors';
import { ZERO_SMP, type Smp } from '@/domain/time';
import type { SqlExecutor } from '@/infra/db/executor';
import { joinRoot } from '@/infra/files/layout';

import type { HomeEpisodeItem } from '../home/HomeService';
import type { Subscription } from '../recording/RecorderPort';
import type { AudioEnginePort } from './AudioEnginePort';
import type { FilePlaybackPort } from './FilePlaybackPort';
import type { PlaybackSessionPort } from './PlaybackSessionPort';
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

/**
 * 番組の素材の試聴（Issue #174、AUDIO_DESIGN.md §10）。ほかの再生と同じプレイヤーで鳴らすので、
 * 試聴を始めるとほかの再生は止まる。ミニプレーヤーには出さない（`source` は null）。
 */
interface AssetPreviewItem {
  kind: 'asset';
  assetId: string;
  duration: Smp;
}
type FileItem = ExportPlaybackItem | RssPlaybackItem | AssetPreviewItem;
type PlaybackMode = 'timeline' | 'file' | null;
/** ファイル再生の読み込み状態（Issue #185）。 */
type FileLoadState = 'loading' | 'ready' | 'failed';

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
  private fileItem: FileItem | null = null;
  private fileUri: string | null = null;
  private fileLoad: FileLoadState = 'ready';
  /** 後から始めた読み込みが先の読み込みの結果で上書きされないように数える。 */
  private fileLoadSeq = 0;
  private timelineItem: TimelinePlaybackItem | null = null;
  /** タイムラインを鳴らすチャンネル数。書き出しタブは書き出し設定に合わせる（Issue #174）。 */
  private timelineChannels: 1 | 2 = 2;
  /**
   * 割り込みで止めた再生（AUDIO_DESIGN.md §10.3）。割り込みの終了で OS が再開を勧めたら、これを再開する。
   * 利用者の操作・録音・別の回の再生で捨てる（`userAction()`）。出力が外れたときは覚えない。
   */
  private interruptedMode: PlaybackMode = null;
  /**
   * ファイル再生を鳴らしたいか（こちらの操作で決まる）。`playing` は expo-audio の状態通知で変わるが、
   * これは変わらない。expo-audio は割り込みの終了で、利用者が途中で止めた・閉じたプレイヤーまで
   * 自分で鳴らし直すので（AUDIO_DESIGN.md §10.3）、これが偽のときに鳴り出したら止め返す。
   */
  private fileWanted = false;

  constructor(
    private readonly deps: {
      db: SqlExecutor;
      engine: AudioEnginePort;
      filePlayer: FilePlaybackPort;
      fileExists: (path: string) => boolean;
      root: string;
      /** 再生の音声モード（AUDIO_DESIGN.md §10.2）。再生を始める直前に毎回当て直す。 */
      session: PlaybackSessionPort;
      /** 録音側が音声セッションを持っている（入力モニター・録音中など。§10.1）。その間は再生を始めない。 */
      recorderBusy: () => boolean;
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
        if (e.playing && (this.mode !== 'file' || !this.fileWanted)) {
          // 頼んでいないのに鳴り出した（expo-audio の割り込み後の再開）。止め返し、状態は変えない
          deps.filePlayer.pause();
          return;
        }
        if (this.mode !== 'file') return;
        if (e.ended) this.fileWanted = false;
        if (e.failed) {
          this.fileLoad = 'failed';
          this.playing = false;
          this.fileWanted = false;
        } else if (e.loading) {
          // 読み込み中・バッファ待ちの間は、押された操作（再生したいか）をそのまま保つ
          if (this.fileLoad !== 'failed') this.fileLoad = 'loading';
        } else {
          this.fileLoad = 'ready';
          this.playing = e.playing;
        }
        this.frame = e.position;
        this.total = e.duration;
        this.dispatch('state', { playing: e.playing, frame: e.position, ended: e.ended });
        this.dispatch('position', { frame: e.position });
      }),
      // ネイティブはこれらを送ってからタイムラインを止める。だからここでは「割り込みの時点で鳴っていたか」が分かる
      deps.engine.on('onPlaybackInterruption', (e) => {
        if (e.type === 'began') void this.onInterruptionBegan();
        else void this.onInterruptionEnded(e.shouldResume);
      }),
      deps.engine.on('onOutputDisconnected', () => {
        void this.onOutputDisconnected();
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
    if (this.mode === 'file') return this.fileItem?.kind === 'asset' ? null : this.fileItem;
    if (this.mode === 'timeline' && this.loadedEpisode) {
      return this.timelineItem ?? { kind: 'timeline', episodeId: this.loadedEpisode };
    }
    return null;
  }
  /** 再生したいのに、音声の読み込み・バッファ待ちで音が出ていない（Issue #185）。 */
  get isLoading(): boolean {
    return this.mode === 'file' && this.fileLoad === 'loading' && this.playing;
  }
  /** ファイル再生の読み込みに失敗した理由。次に再生を押すと読み込み直す（Issue #185）。 */
  get error(): AppErrorCode | null {
    if (this.mode !== 'file' || this.fileLoad !== 'failed' || !this.fileItem) return null;
    return this.fileItem.kind === 'rss' ? 'playback_stream_failed' : 'playback_file_failed';
  }
  get loadedEpisodeId(): string | null {
    return this.loadedEpisode;
  }
  /** 試聴中（読み込み中を含む）の素材。止まったら null。 */
  get previewingAssetId(): string | null {
    if (this.mode !== 'file' || this.fileItem?.kind !== 'asset' || !this.fileWanted) return null;
    return this.fileItem.assetId;
  }

  /**
   * 素材を試聴する。同じ素材を試聴中なら止める。録音側が音声セッションを持っている間は始めない（§10.1）。
   * `path` はデータの置き場（root）からの相対パス。始めたら true。
   */
  async toggleAssetPreview(asset: {
    assetId: string;
    path: string;
    duration: Smp;
  }): Promise<boolean> {
    this.userAction();
    if (this.previewingAssetId === asset.assetId) {
      this.releaseFile();
      return false;
    }
    if (this.deps.recorderBusy()) return false;
    return this.startFile(
      { kind: 'asset', assetId: asset.assetId, duration: asset.duration },
      `file://${joinRoot(this.deps.root, asset.path)}`,
    );
  }

  /** 試聴を止めて手放す。素材の画面を離れたとき・素材を消すときに呼ぶ。試聴していなければ何もしない。 */
  stopAssetPreview(): void {
    if (this.mode === 'file' && this.fileItem?.kind === 'asset') this.releaseFile();
  }

  /** タイムラインを（再）読み込みする。ファイル再生中はその状態を奪わない。 */
  async reload(episodeId: string): Promise<void> {
    const wasPlaying = this.mode === 'timeline' && this.playing;
    const at = this.loadedEpisode === episodeId ? this.timelineFrame : 0;
    const doc = await renderDocumentFromDb(this.deps.db, this.deps.root, episodeId, {
      channels: this.timelineChannels,
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

  /**
   * タイムラインを鳴らすチャンネル数を変える。読み込み済みなら、聴いている位置のまま読み直す。
   * 書き出しタブは書き出し設定のチャンネルにし、離れたらステレオ（編集の既定。AUDIO_DESIGN.md §8.1）に戻す。
   * サンプルレートは試聴に反映しない（変換は書き出しの最後だけ。ユーザー判断 2026-10-03）。
   */
  async setTimelineChannels(channels: 1 | 2): Promise<void> {
    if (channels === this.timelineChannels) return;
    this.timelineChannels = channels;
    if (this.loadedEpisode) await this.reload(this.loadedEpisode);
  }

  async play(at?: Smp): Promise<void> {
    this.userAction();
    await this.playTimeline(at);
  }

  private async playTimeline(at?: Smp): Promise<void> {
    if (!this.loadedEpisode || this.deps.recorderBusy()) return;
    this.deps.filePlayer.pause();
    await this.enterPlayback();
    this.mode = 'timeline';
    this.total = this.timelineTotal;
    this.frame = at ?? (this.timelineFrame as Smp);
    await this.deps.engine.play(at ?? null);
  }

  async pause(): Promise<void> {
    this.userAction();
    await this.pauseCurrent();
  }

  private async pauseCurrent(): Promise<void> {
    if (this.mode === 'file') {
      this.fileWanted = false;
      this.deps.filePlayer.pause();
      // 読み込み中は状態の通知が来ないことがあるので、止めたことを自分で流す
      if (this.playing) {
        this.playing = false;
        this.dispatch('state', { playing: false, frame: this.frame });
      }
    } else await this.deps.engine.pause();
  }

  async pauseTimeline(): Promise<void> {
    this.userAction();
    if (this.mode === 'timeline') await this.deps.engine.pause();
  }

  async stopForRecording(): Promise<void> {
    await this.pause();
  }

  /** 書き出しタブ・編集画面からの操作は常にタイムラインへ切り替える。 */
  async toggle(): Promise<void> {
    this.userAction();
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
    this.userAction();
    if (this.deps.recorderBusy()) return false;
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
    this.userAction();
    if (!this.source?.homeKey) return false;
    if (this.mode === 'file' && this.fileLoad === 'failed' && this.fileItem && this.fileUri) {
      // 失敗した読み込みをやり直す（Issue #185）
      return this.startFile(this.fileItem, this.fileUri, this.frame as Smp);
    }
    if (this.playing) await this.pauseCurrent();
    else if (this.mode === 'timeline') {
      await this.playTimeline(this.timelineFrame >= this.timelineTotal ? ZERO_SMP : undefined);
    } else {
      if (this.total > 0 && this.frame >= this.total) await this.deps.filePlayer.seek(ZERO_SMP);
      await this.resumeFile();
    }
    return true;
  }

  /** 読み込み済みのファイル再生を続きから鳴らす。 */
  private async resumeFile(): Promise<void> {
    if (this.deps.recorderBusy()) return;
    this.fileWanted = true;
    this.playing = true;
    this.dispatch('state', { playing: true, frame: this.frame });
    await this.enterPlayback();
    if (this.mode !== 'file' || !this.fileWanted) return;
    this.deps.filePlayer.play();
  }

  /**
   * 音声モードを再生用に当て直す（AUDIO_DESIGN.md §10.1）。当たらなくても再生は止めない
   * （前の設定のまま鳴るだけで、録音データには触れない）。
   */
  private async enterPlayback(): Promise<void> {
    await this.deps.session.enterPlayback().catch(() => undefined);
  }

  /** 利用者の操作（と録音の開始）。割り込みのあとの自動再開をやめる（§10.3）。 */
  private userAction(): void {
    this.interruptedMode = null;
  }

  private async onInterruptionBegan(): Promise<void> {
    // ファイル再生は expo-audio が先に止めて状態通知が先に届くことがあるので、鳴らしたいかで見る
    const active = this.mode === 'file' ? this.fileWanted : this.playing;
    if (!active || this.mode === null) return;
    this.interruptedMode = this.mode;
    await this.pauseCurrent();
  }

  private async onInterruptionEnded(shouldResume: boolean): Promise<void> {
    const mode = this.interruptedMode;
    this.interruptedMode = null;
    if (!shouldResume || mode === null || mode !== this.mode || this.playing) return;
    if (this.deps.recorderBusy()) return;
    if (mode === 'timeline') await this.playTimeline();
    else if (this.fileLoad !== 'failed') await this.resumeFile();
  }

  /** イヤホン・Bluetooth が外れた。止めて、自動では再開しない（§10.3）。 */
  private async onOutputDisconnected(): Promise<void> {
    this.interruptedMode = null;
    if (this.playing || this.fileWanted) await this.pauseCurrent();
  }

  /**
   * 完成ファイル・配信の音声を読み込んで再生する。読み込みを待つ前に「読み込み中」を流し、
   * 失敗しても例外は投げず「失敗」の状態にする（Issue #185）。配信の音声は通信するので遅れることがある。
   */
  private async startFile(source: FileItem, uri: string, at: Smp = ZERO_SMP): Promise<boolean> {
    if (this.deps.recorderBusy()) return false;
    const seq = ++this.fileLoadSeq;
    await this.deps.engine.pause();
    this.fileItem = source;
    this.fileUri = uri;
    this.mode = 'file';
    this.fileLoad = 'loading';
    this.frame = at;
    this.total = source.duration;
    this.playing = true;
    this.fileWanted = true;
    this.dispatch('state', { playing: true, frame: at });
    try {
      await this.deps.filePlayer.load(uri, source.duration);
      if (seq !== this.fileLoadSeq || this.mode !== 'file') return true;
      // 位置合わせの失敗は読み込みの失敗とはみなさない（その場合は先頭から鳴る）
      if (at > 0) await this.deps.filePlayer.seek(at).catch(() => undefined);
      if (seq !== this.fileLoadSeq || this.mode !== 'file' || !this.fileWanted) return true;
      await this.enterPlayback();
      if (seq !== this.fileLoadSeq || this.mode !== 'file' || !this.fileWanted) return true;
      this.deps.filePlayer.play();
    } catch {
      if (seq !== this.fileLoadSeq || this.mode !== 'file') return true;
      this.fileLoad = 'failed';
      this.playing = false;
      this.fileWanted = false;
      this.dispatch('state', { playing: false, frame: this.frame });
    }
    return true;
  }

  /**
   * 書き出しを消す前に呼ぶ（Issue #152）。その書き出しを Home から再生中なら止めて手放す。
   * 次に Home で再生するときは、残っている書き出し → RSS → タイムラインの順で選び直す。
   */
  async forgetExport(exportId: string): Promise<void> {
    if (this.mode !== 'file') return;
    const item = this.fileItem;
    if (item?.kind !== 'export' || item.exportId !== exportId) return;
    this.releaseFile();
  }

  /**
   * Home から始めた再生を止めて手放す（Issue #164）。ミニプレーヤーの「閉じる」と、
   * エピソード画面を開いたとき（再生音が録音に入らないように）に呼ぶ。
   * 状態は await の前に書き換える。直後の `reload()` が再生を続けないように。
   */
  async stopHome(): Promise<void> {
    this.userAction();
    if (!this.source?.homeKey) return;
    if (this.mode === 'file') {
      this.releaseFile();
      return;
    }
    this.timelineItem = null;
    this.playing = false;
    this.dispatch('state', { playing: false, frame: this.frame });
    await this.deps.engine.pause();
  }

  private releaseFile(): void {
    this.deps.filePlayer.pause();
    this.fileLoadSeq++;
    this.fileItem = null;
    this.fileUri = null;
    this.fileLoad = 'ready';
    this.mode = null;
    this.playing = false;
    this.fileWanted = false;
    this.frame = 0;
    this.total = 0;
    this.dispatch('state', { playing: false, frame: 0 });
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
