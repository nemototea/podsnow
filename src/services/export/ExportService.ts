import { AppError } from '@/domain/errors';
import type { SqlExecutor } from '@/infra/db/executor';
import {
  failExport,
  finishExport,
  insertExport,
  updateExportProgress,
  type ExportFormat,
} from '@/infra/db/repositories/exportsRepo';
import { joinRoot, relPaths } from '@/infra/files/layout';

import type { AudioEnginePort } from '../audio/AudioEnginePort';
import { renderDocumentFromDb } from '../audio/renderDocumentFromDb';
import type { Subscription } from '../recording/RecorderPort';

export interface ExportPreset {
  format: ExportFormat;
  /** AAC のみ。 */
  bitrate: number;
  channels: 1 | 2;
  sampleRate: number;
}

export const EXPORT_PRESETS: Record<'podcast' | 'high' | 'wav', ExportPreset> = {
  podcast: { format: 'm4a', bitrate: 128_000, channels: 1, sampleRate: 48000 },
  high: { format: 'm4a', bitrate: 256_000, channels: 2, sampleRate: 48000 },
  wav: { format: 'wav', bitrate: 0, channels: 1, sampleRate: 48000 },
};

/** 推定ファイルサイズ（bytes）。 */
export function estimateExportBytes(preset: ExportPreset, durationSmp: number): number {
  const sec = durationSmp / preset.sampleRate;
  if (preset.format === 'wav')
    return Math.round(sec * preset.sampleRate * preset.channels * 2) + 44;
  return Math.round((sec * preset.bitrate) / 8);
}

export interface ExportDeps {
  db: SqlExecutor;
  engine: AudioEnginePort;
  root: string;
  ensureDir: (absDir: string) => void;
  fileSize: (absPath: string) => number;
  newId: () => string;
  now: () => number;
}

export interface ExportEvents {
  progress: (e: { exportId: string; progress: number; phase: string }) => void;
  done: (e: {
    exportId: string;
    path: string;
    bytes: number;
    measuredLufs: number;
    measuredTruePeakDb: number;
    appliedGainDb: number;
  }) => void;
  failed: (e: { exportId: string; message: string; cancelled: boolean }) => void;
}

/**
 * 書き出しジョブ（ARCHITECTURE.md §8.2）。exports テーブルに状態を書き、ネイティブのレンダを起動する。
 */
export class ExportService {
  private jobs = new Map<string, { exportId: string; episodeId: string; relPath: string }>();
  private subs: Subscription[] = [];
  private listeners = new Map<keyof ExportEvents, Set<(p: never) => void>>();

  constructor(private readonly deps: ExportDeps) {
    const e = deps.engine;
    this.subs.push(
      e.on('onRenderProgress', (ev) => void this.onProgress(ev)),
      e.on('onRenderDone', (ev) => void this.onDone(ev)),
      e.on('onRenderError', (ev) => void this.onError(ev)),
    );
  }

  on<K extends keyof ExportEvents>(event: K, fn: ExportEvents[K]): Subscription {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as (p: never) => void);
    return { remove: () => set.delete(fn as (p: never) => void) };
  }

  private dispatch<K extends keyof ExportEvents>(
    event: K,
    payload: Parameters<ExportEvents[K]>[0],
  ) {
    this.listeners.get(event)?.forEach((fn) => (fn as (p: unknown) => void)(payload));
  }

  /** 書き出しを開始し exportId を返す。 */
  async start(episodeId: string, preset: ExportPreset): Promise<string> {
    const doc = await renderDocumentFromDb(this.deps.db, this.deps.root, episodeId, {
      channels: preset.channels,
      sampleRate: preset.sampleRate,
    });
    if (doc.totalFrames <= 0) throw new AppError('voice_timeline_empty');
    const exportId = this.deps.newId();
    const relPath = relPaths.exportFile(episodeId, exportId, preset.format);
    const abs = joinRoot(this.deps.root, relPath);
    this.deps.ensureDir(joinRoot(this.deps.root, `${relPaths.episodeDir(episodeId)}/exports`));
    await insertExport(this.deps.db, {
      id: exportId,
      episodeId,
      format: preset.format,
      preset,
      durationSmp: doc.totalFrames,
      now: this.deps.now(),
    });
    const jobId = this.deps.engine.startRender(JSON.stringify(doc), {
      path: abs,
      format: preset.format === 'wav' ? 'wav' : 'm4a',
      bitrate: preset.bitrate,
    });
    this.jobs.set(jobId, { exportId, episodeId, relPath });
    await updateExportProgress(this.deps.db, exportId, 'rendering', 0);
    return exportId;
  }

  cancel(exportId: string): void {
    for (const [jobId, j] of this.jobs) {
      if (j.exportId === exportId) this.deps.engine.cancelRender(jobId);
    }
  }

  release(): void {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
  }

  private async onProgress(ev: { jobId: string; progress: number; phase: string }) {
    const j = this.jobs.get(ev.jobId);
    if (!j) return;
    const status = ev.phase === 'measuring' ? 'rendering' : 'encoding';
    await updateExportProgress(this.deps.db, j.exportId, status, ev.progress).catch(() => {});
    this.dispatch('progress', { exportId: j.exportId, progress: ev.progress, phase: ev.phase });
  }

  private async onDone(ev: {
    jobId: string;
    path: string;
    measuredLufs: number;
    measuredTruePeakDb: number;
    appliedGainDb: number;
  }) {
    const j = this.jobs.get(ev.jobId);
    if (!j) return;
    this.jobs.delete(ev.jobId);
    const bytes = this.deps.fileSize(ev.path);
    await finishExport(this.deps.db, j.exportId, {
      path: j.relPath,
      bytes,
      measuredLufs: ev.measuredLufs,
      measuredTruePeak: ev.measuredTruePeakDb,
      now: this.deps.now(),
    });
    await this.deps.db.run("UPDATE episodes SET status = 'exported', updated_at = ? WHERE id = ?", [
      this.deps.now(),
      j.episodeId,
    ]);
    this.dispatch('done', {
      exportId: j.exportId,
      path: ev.path,
      bytes,
      measuredLufs: ev.measuredLufs,
      measuredTruePeakDb: ev.measuredTruePeakDb,
      appliedGainDb: ev.appliedGainDb,
    });
  }

  private async onError(ev: { jobId: string; message: string; cancelled: boolean }) {
    const j = this.jobs.get(ev.jobId);
    if (!j) return;
    this.jobs.delete(ev.jobId);
    await failExport(
      this.deps.db,
      j.exportId,
      ev.cancelled ? 'cancelled' : 'failed',
      ev.cancelled ? null : ev.message,
      this.deps.now(),
    );
    this.dispatch('failed', { exportId: j.exportId, message: ev.message, cancelled: ev.cancelled });
  }
}
