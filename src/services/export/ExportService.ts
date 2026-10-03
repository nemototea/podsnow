import { AppError } from '@/domain/errors';
import { exportFileName } from '@/domain/metadata/fileName';
import type { SqlExecutor } from '@/infra/db/executor';
import { parseEpisodeExportPreset } from '@/infra/db/repositories/episodesRepo';
import {
  deleteExportRow,
  failExport,
  finishExport,
  getExport,
  insertExport,
  isExportRunning,
  updateExportProgress,
  type ExportFormat,
} from '@/infra/db/repositories/exportsRepo';
import { joinRoot, relPaths } from '@/infra/files/layout';

import type { AudioEnginePort } from '../audio/AudioEnginePort';
import { renderDocumentFromDb } from '../audio/renderDocumentFromDb';
import type { Subscription } from '../recording/RecorderPort';

import { currentSourceFingerprint } from './sourceFingerprint';

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

/** 固定プリセットに「カスタム」を足した選択肢（FR-EXP-3）。 */
export type ExportPresetKey = keyof typeof EXPORT_PRESETS | 'custom';

/**
 * カスタム書き出しでユーザーが選べる項目。
 * サンプルレートは選ばせない: 素材もタイムラインも 48 kHz 前提で、レンダラはリサンプルしない。
 */
export interface CustomExportSettings {
  format: 'm4a' | 'wav';
  /** bps。M4A のときだけ使う。 */
  bitrate: number;
  channels: 1 | 2;
}

/** AAC-LC で iOS / Android のエンコーダが受け付ける範囲に収める【仮説】（実機未検証）。 */
export const CUSTOM_BITRATES: readonly number[] = [
  64_000, 96_000, 128_000, 160_000, 192_000, 256_000,
];

export const DEFAULT_CUSTOM_EXPORT: CustomExportSettings = {
  format: 'm4a',
  bitrate: 192_000,
  channels: 1,
};

/** 保存値（JSON 由来で型が信用できない）を正規化する。壊れた項目は既定値に戻す。 */
export function normalizeCustomExport(v: unknown): CustomExportSettings {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  return {
    format: o.format === 'wav' || o.format === 'm4a' ? o.format : DEFAULT_CUSTOM_EXPORT.format,
    bitrate:
      typeof o.bitrate === 'number' && CUSTOM_BITRATES.includes(o.bitrate)
        ? o.bitrate
        : DEFAULT_CUSTOM_EXPORT.bitrate,
    channels: o.channels === 1 || o.channels === 2 ? o.channels : DEFAULT_CUSTOM_EXPORT.channels,
  };
}

/**
 * 書き出しタブで最初に選ばれているプリセット（DATA_MODEL.md §4.5.1 / Issue #136）。
 * その回で最後に選んだもの → なければ（NULL・知らない値）設定の既定。
 */
export function episodeExportPreset(
  episodeValue: unknown,
  defaultPreset: ExportPresetKey,
): ExportPresetKey {
  return parseEpisodeExportPreset(episodeValue) ?? defaultPreset;
}

/** プリセットのキー（カスタムなら保存済みの項目も）からレンダに渡す設定を作る。 */
export function resolveExportPreset(key: ExportPresetKey, custom: unknown): ExportPreset {
  if (key !== 'custom') return EXPORT_PRESETS[key];
  const c = normalizeCustomExport(custom);
  return {
    format: c.format,
    bitrate: c.format === 'wav' ? 0 : c.bitrate,
    channels: c.channels,
    sampleRate: 48000,
  };
}

/** 書き出したファイルの音量（履歴・配信の準備での表示用）。 */
export interface ExportLoudness {
  /** 出力の統合ラウドネス（LUFS）。 */
  lufs: number;
  /** 音量調整が有効で、出力が目標より 1 LU 以上小さいときの目標値。録音が小さすぎて上げきれなかった。 */
  shortOfTarget: number | null;
}

/**
 * exports の行から、書き出したファイルの音量を取り出す。
 * preset に loudness が無い行は、measured_lufs が調整前の値だった頃の記録なので出さない。
 */
export function exportLoudness(row: {
  preset: string;
  measured_lufs: number | null;
}): ExportLoudness | null {
  if (row.measured_lufs == null || row.measured_lufs <= -70) return null;
  let loudness: { enabled?: unknown; targetLufs?: unknown } | undefined;
  try {
    loudness = (JSON.parse(row.preset) as { loudness?: typeof loudness }).loudness;
  } catch {
    return null;
  }
  if (!loudness) return null;
  const target = typeof loudness.targetLufs === 'number' ? loudness.targetLufs : null;
  const short =
    loudness.enabled === true && target != null && row.measured_lufs < target - 1 ? target : null;
  return { lufs: row.measured_lufs, shortOfTarget: short };
}

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
  fileExists: (absPath: string) => boolean;
  /** 絶対パスのファイルを消す（無ければ何もしない）。書き出しの削除に使う。 */
  deleteFile: (absPath: string) => void;
  /**
   * `absSrc` を `absDir/name` へコピーし、コピーの file:// URI を返す。`absDir` は先に空にする。
   * 共有の別名コピーに使う（Issue #166）。
   */
  copyAsNamed: (absSrc: string, absDir: string, name: string) => Promise<string>;
  newId: () => string;
  now: () => number;
}

/** 共有シートへ渡すファイル（Issue #166）。 */
export interface SharedExportFile {
  /** 別名コピーの file:// URI。 */
  uri: string;
  /** 共有先で見えるファイル名（配信の準備画面の表示と同じ）。 */
  fileName: string;
  format: ExportFormat;
}

/** 書き出しを消したときに起きること（確認の文言を選ぶため）。 */
export interface ExportRemovalImpact {
  /**
   * これが、この回を聴ける最後の手段か。ほかに書き出しが無く、声のタイムラインも空で
   * （録音を消した回）、配信済みの音声（RSS の enclosure）も無い。消すとどこからも聴けない。
   */
  lastListenable: boolean;
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
    // 書き出す音の指紋。Home が「今の編集と同じ書き出し」かを見分ける（Issue #168）
    const sourceFingerprint = await currentSourceFingerprint(this.deps.db, episodeId);
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
      // 書き出し時のラウドネス設定も残す（結果の表示で目標と比べる。DATA_MODEL.md §4.13）
      preset: { ...preset, loudness: doc.loudness },
      durationSmp: doc.totalFrames,
      sourceFingerprint,
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

  /**
   * 書き出しを履歴ごと消す（Issue #152）。書き出しはアプリの内部にあり、ユーザーは「ファイル」
   * アプリから消せない（共有・保存で外に出るのはコピー）。進行中の書き出しは消さない。
   *
   * 順序は **ファイルを先に消し、消せたら行を消す**（ユーザー判断 2026-09-29）。行だけ消えて
   * ファイルが残ると、ユーザーには消す手段が無い。ファイルが消せなければ `file_delete_failed`。
   */
  async remove(exportId: string): Promise<void> {
    const row = await getExport(this.deps.db, exportId);
    if (!row) return;
    if (isExportRunning(row.status)) throw new Error('export is running');
    if (row.path) {
      try {
        this.deps.deleteFile(joinRoot(this.deps.root, row.path));
      } catch (e) {
        throw new AppError('file_delete_failed', {}, e);
      }
    }
    await deleteExportRow(this.deps.db, exportId);
  }

  /** 書き出しを消したときに起きること。`remove` の前の確認に使う。 */
  async removalImpact(exportId: string): Promise<ExportRemovalImpact> {
    const { db } = this.deps;
    const row = await getExport(db, exportId);
    if (!row || row.status !== 'done' || !row.path) return { lastListenable: false };
    const others = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM exports
        WHERE episode_id = ? AND id <> ? AND status = 'done' AND path IS NOT NULL`,
      [row.episode_id, exportId],
    );
    if ((others?.n ?? 0) > 0) return { lastListenable: false };
    const voice = await db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM voice_segments WHERE episode_id = ?',
      [row.episode_id],
    );
    if ((voice?.n ?? 0) > 0) return { lastListenable: false };
    // Home と同じ対応付け: 明示リンク、または同じ番組の GUID 完全一致（FR-EP-7）。
    const feed = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM feed_episodes f JOIN episodes e ON e.id = ?
        WHERE f.enclosure_url IS NOT NULL
          AND (f.episode_id = e.id OR (f.show_id = e.show_id AND f.guid = e.guid))`,
      [row.episode_id],
    );
    return { lastListenable: (feed?.n ?? 0) === 0 };
  }

  /**
   * 共有・保存するときのファイル名（Issue #166）。番組名・話数・タイトルから作る。
   * 画面の表示と `prepareShare` の実物で同じ名前になるよう、どちらもここを通す。
   */
  async shareFileName(exportId: string): Promise<string | null> {
    const row = await this.deps.db.get<{
      format: ExportFormat;
      title: string;
      episode_number: number;
      show_name: string | null;
    }>(
      `SELECT x.format, e.title, e.episode_number, s.name AS show_name
         FROM exports x
         JOIN episodes e ON e.id = x.episode_id
         LEFT JOIN shows s ON s.id = e.show_id
        WHERE x.id = ?`,
      [exportId],
    );
    if (!row) return null;
    return exportFileName({
      showName: row.show_name ?? '',
      episodeNumber: row.episode_number,
      title: row.title,
      ext: row.format,
    });
  }

  /**
   * 書き出したファイルを、分かる名前のコピーにして共有シートへ渡せるようにする（Issue #166）。
   *
   * 書き出しの実物は `<exportId>.<ext>` のまま動かさない（履歴・試聴・削除が path で指している）。
   * コピーは `tmp/share/` に 1 つだけ置き、次の共有と起動時の tmp/ の掃除で消える。
   * 共有シートを閉じた直後に消さないのは、Android では受け取る側のアプリが後から読むことがあるため。
   *
   * 書き出しが無い・終わっていない・ファイルが無いときは null。コピーできなければ `share_prepare_failed`
   * （WAV は大きく、空き容量が足りないことがある）。
   */
  async prepareShare(exportId: string): Promise<SharedExportFile | null> {
    const row = await getExport(this.deps.db, exportId);
    if (!row || row.status !== 'done' || !row.path) return null;
    const src = joinRoot(this.deps.root, row.path);
    if (!this.deps.fileExists(src)) return null;
    const fileName = await this.shareFileName(exportId);
    if (!fileName) return null;
    try {
      const uri = await this.deps.copyAsNamed(
        src,
        joinRoot(this.deps.root, relPaths.shareDir()),
        fileName,
      );
      return { uri, fileName, format: row.format };
    } catch (e) {
      throw new AppError('share_prepare_failed', {}, e);
    }
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
