import type { SqlExecutor, SqlRow } from '@/infra/db/executor';
import type { FsPort } from '@/infra/files/fsPort';
import { joinRoot, relPaths } from '@/infra/files/layout';
import {
  bytesSink,
  fileSink,
  readZip,
  utf8Decode,
  utf8Encode,
  writeZip,
  type ZipEntrySource,
} from '@/infra/files/zip';

/*
 * エピソードのバックアップ（.podsnow = zip）と復元（DATA_MODEL.md §7、FR-EXP-9）。
 *
 * manifest.json  { formatVersion: 1, app: 'podsnow', createdAt, episodeId, showId }
 * episode.json   各テーブルの行（SELECT * の JSON）
 * takes/<takeId>/seg-NNNN.wav   録音 Segment（無圧縮）
 * assets/<assetId>.wav          オーバーレイが参照する素材（無圧縮）
 */

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_EXTENSION = 'podsnow';

export interface BackupManifest {
  formatVersion: number;
  app: 'podsnow';
  createdAt: number;
  episodeId: string;
  showId: string;
}

export interface BackupPayload {
  episode: SqlRow;
  takes: SqlRow[];
  take_segments: SqlRow[];
  voice_segments: SqlRow[];
  overlay_clips: SqlRow[];
  markers: SqlRow[];
  topics: SqlRow[];
  exports: SqlRow[];
  assets: SqlRow[];
}

export interface BackupProgress {
  phase: 'collect' | 'zip' | 'unzip' | 'db';
  /** 0..1 */
  progress: number;
  detail?: string;
}

export interface BackupDeps {
  db: SqlExecutor;
  fs: FsPort;
  root: string;
  newId: () => string;
  now: () => number;
}

const AUDIO_EXT = '.wav';

/** エピソードを .podsnow に書き出す。戻り値は zip の絶対パス。 */
export async function exportEpisodeBackup(
  deps: BackupDeps,
  episodeId: string,
  outAbsPath: string,
  onProgress?: (p: BackupProgress) => void,
): Promise<{ path: string; bytes: number; missingFiles: string[] }> {
  const { db, fs, root } = deps;
  onProgress?.({ phase: 'collect', progress: 0 });
  const episode = await db.get('SELECT * FROM episodes WHERE id = ?', [episodeId]);
  if (!episode) throw new Error('episode not found');
  const takes = await db.all('SELECT * FROM takes WHERE episode_id = ?', [episodeId]);
  const takeIds = takes.map((t) => t.id as string);
  const take_segments = takeIds.length
    ? await db.all(
        `SELECT * FROM take_segments WHERE take_id IN (${takeIds.map(() => '?').join(',')}) ORDER BY take_id, seq`,
        takeIds,
      )
    : [];
  const voice_segments = await db.all(
    'SELECT * FROM voice_segments WHERE episode_id = ? ORDER BY position',
    [episodeId],
  );
  const overlay_clips = await db.all('SELECT * FROM overlay_clips WHERE episode_id = ?', [
    episodeId,
  ]);
  const markers = await db.all('SELECT * FROM markers WHERE episode_id = ?', [episodeId]);
  const topics = await db.all('SELECT * FROM topics WHERE episode_id = ? ORDER BY position', [
    episodeId,
  ]);
  const exports = await db.all(
    'SELECT id, episode_id, format, preset, status, progress, duration_smp, measured_lufs, measured_true_peak, created_at, finished_at FROM exports WHERE episode_id = ?',
    [episodeId],
  );
  const assetIds = [...new Set(overlay_clips.map((o) => o.asset_id as string))];
  const assets = assetIds.length
    ? await db.all(
        `SELECT * FROM assets WHERE id IN (${assetIds.map(() => '?').join(',')})`,
        assetIds,
      )
    : [];

  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    app: 'podsnow',
    createdAt: deps.now(),
    episodeId,
    showId: episode.show_id as string,
  };
  const payload: BackupPayload = {
    episode,
    takes,
    take_segments,
    voice_segments,
    overlay_clips,
    markers,
    topics,
    exports,
    assets,
  };

  const entries: ZipEntrySource[] = [
    {
      name: 'manifest.json',
      store: false,
      source: { bytes: utf8Encode(JSON.stringify(manifest)) },
    },
    { name: 'episode.json', store: false, source: { bytes: utf8Encode(JSON.stringify(payload)) } },
  ];
  const missingFiles: string[] = [];
  for (const s of take_segments) {
    const abs = joinRoot(root, s.path as string);
    if (!fs.exists(abs)) {
      missingFiles.push(s.path as string);
      continue;
    }
    entries.push({
      name: `takes/${s.take_id as string}/${(s.path as string).split('/').pop()!}`,
      store: true,
      source: { path: abs },
    });
  }
  for (const a of assets) {
    const abs = joinRoot(root, a.path as string);
    if (!fs.exists(abs)) {
      missingFiles.push(a.path as string);
      continue;
    }
    entries.push({
      name: `assets/${a.id as string}${AUDIO_EXT}`,
      store: true,
      source: { path: abs },
    });
  }

  fs.ensureDir(outAbsPath.slice(0, outAbsPath.lastIndexOf('/')));
  writeZip(fs, outAbsPath, entries, (p) => {
    onProgress?.({
      phase: 'zip',
      progress: p.totalBytes ? p.bytes / p.totalBytes : 1,
      detail: p.entry,
    });
  });
  return { path: outAbsPath, bytes: fs.size(outAbsPath), missingFiles };
}

export interface RestoreResult {
  episodeId: string;
  episodeNumber: number;
  takes: number;
  reusedAssets: number;
  importedAssets: number;
}

/**
 * .podsnow を現在の Show に復元する。ID は全て採番し直す（既存 Show の素材と id が一致すれば再利用）。
 * 音声ファイルは新しい ID のパスへ展開する。
 */
export async function importEpisodeBackup(
  deps: BackupDeps,
  showId: string,
  zipAbsPath: string,
  onProgress?: (p: BackupProgress) => void,
): Promise<RestoreResult> {
  const { db, fs, root, newId, now } = deps;
  // 1 パス目: manifest / episode.json を読んで ID を割り当て、音声エントリの展開先を決める
  const manifestSink = bytesSink();
  const payloadSink = bytesSink();
  onProgress?.({ phase: 'unzip', progress: 0, detail: 'metadata' });
  readZip(fs, zipAbsPath, (name) =>
    name === 'manifest.json' ? manifestSink : name === 'episode.json' ? payloadSink : null,
  );
  const manifestBytes = manifestSink.result();
  if (!manifestBytes.length)
    throw new Error('manifest.json がありません（podsnow のバックアップではありません）');
  const manifest = JSON.parse(utf8Decode(manifestBytes)) as BackupManifest;
  if (manifest.app !== 'podsnow' || manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error(`対応していないバックアップ形式です（version ${manifest.formatVersion}）`);
  }
  const payload = JSON.parse(utf8Decode(payloadSink.result())) as BackupPayload;

  const newEpisodeId = newId();
  const takeMap = new Map<string, string>();
  for (const t of payload.takes) takeMap.set(t.id as string, newId());
  const assetMap = new Map<string, { id: string; reuse: boolean }>();
  for (const a of payload.assets) {
    const existing = await db.get('SELECT id FROM assets WHERE id = ? AND show_id = ?', [
      a.id as string,
      showId,
    ]);
    assetMap.set(
      a.id as string,
      existing ? { id: a.id as string, reuse: true } : { id: newId(), reuse: false },
    );
  }
  const segmentTargets = new Map<string, { rel: string; abs: string }>();
  for (const s of payload.take_segments) {
    const oldTake = s.take_id as string;
    const nt = takeMap.get(oldTake);
    if (!nt) continue;
    const rel = relPaths.segmentFile(newEpisodeId, nt, s.seq as number);
    const abs = joinRoot(root, rel);
    segmentTargets.set(`takes/${oldTake}/${(s.path as string).split('/').pop()!}`, { rel, abs });
  }
  const assetTargets = new Map<string, { rel: string; abs: string }>();
  for (const a of payload.assets) {
    const m = assetMap.get(a.id as string)!;
    if (m.reuse) continue;
    const rel = relPaths.assetFile(showId, m.id);
    assetTargets.set(`assets/${a.id as string}${AUDIO_EXT}`, { rel, abs: joinRoot(root, rel) });
  }

  // 2 パス目: 音声を展開
  for (const t of [...segmentTargets.values(), ...assetTargets.values()]) {
    fs.ensureDir(t.abs.slice(0, t.abs.lastIndexOf('/')));
  }
  readZip(
    fs,
    zipAbsPath,
    (name) => {
      const t = segmentTargets.get(name) ?? assetTargets.get(name);
      return t ? fileSink(fs, t.abs) : null;
    },
    (bytes, total) =>
      onProgress?.({ phase: 'unzip', progress: total ? bytes / total : 1, detail: 'audio' }),
  );

  // 3: DB へ書く
  onProgress?.({ phase: 'db', progress: 0 });
  const t = now();
  const show = await db.get<{ next_episode_number: number }>(
    'SELECT next_episode_number FROM shows WHERE id = ?',
    [showId],
  );
  const episodeNumber = show?.next_episode_number ?? 1;
  const ep = payload.episode;
  await db.transaction(async () => {
    await db.run(
      'INSERT INTO episodes (id, show_id, title, description, description_suggestion, episode_number, season, recorded_at, publish_planned_at, status, last_opened_at, playhead_smp, undo_cursor, sound_settings, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        newEpisodeId,
        showId,
        `${ep.title as string}`,
        ep.description as string,
        (ep.description_suggestion as string | null) ?? null,
        episodeNumber,
        (ep.season as number) ?? 1,
        (ep.recorded_at as number | null) ?? null,
        (ep.publish_planned_at as number | null) ?? null,
        (ep.status as string) === 'exported' ? 'ready' : ((ep.status as string) ?? 'draft'),
        t,
        (ep.playhead_smp as number) ?? 0,
        0,
        (ep.sound_settings as string) ?? '{}',
        t,
        t,
      ],
    );
    await db.run('UPDATE shows SET next_episode_number = ?, updated_at = ? WHERE id = ?', [
      episodeNumber + 1,
      t,
      showId,
    ]);
    for (const [oldId, m] of assetMap) {
      if (m.reuse) continue;
      const a = payload.assets.find((x) => x.id === oldId)!;
      const target = assetTargets.get(`assets/${oldId}${AUDIO_EXT}`)!;
      await db.run(
        'INSERT INTO assets (id, show_id, kind, name, path, original_filename, duration_smp, sample_rate, channels, peaks_path, default_gain_db, is_favorite, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          m.id,
          showId,
          a.kind as string,
          a.name as string,
          target.rel,
          (a.original_filename as string | null) ?? null,
          a.duration_smp as number,
          (a.sample_rate as number) ?? 48000,
          (a.channels as number) ?? 1,
          null,
          (a.default_gain_db as number) ?? 0,
          0,
          (a.sort_order as number) ?? 0,
          t,
          t,
        ],
      );
    }
    for (const tk of payload.takes) {
      const nt = takeMap.get(tk.id as string)!;
      await db.run(
        'INSERT INTO takes (id, episode_id, name, status, sample_rate, channels, bit_depth, input_label, started_at, ended_at, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          nt,
          newEpisodeId,
          tk.name as string,
          (tk.status as string) === 'recording' ? 'ready' : (tk.status as string),
          (tk.sample_rate as number) ?? 48000,
          (tk.channels as number) ?? 1,
          (tk.bit_depth as number) ?? 16,
          (tk.input_label as string | null) ?? null,
          (tk.started_at as number) ?? t,
          (tk.ended_at as number | null) ?? null,
          (tk.duration_smp as number) ?? 0,
          t,
          t,
        ],
      );
    }
    for (const s of payload.take_segments) {
      const nt = takeMap.get(s.take_id as string);
      if (!nt) continue;
      const target = segmentTargets.get(
        `takes/${s.take_id as string}/${(s.path as string).split('/').pop()!}`,
      );
      if (!target) continue;
      await db.run(
        'INSERT INTO take_segments (id, take_id, seq, path, offset_smp, duration_smp, header_valid, reason_closed, peaks_path) VALUES (?,?,?,?,?,?,?,?,?)',
        [
          newId(),
          nt,
          s.seq as number,
          target.rel,
          (s.offset_smp as number) ?? 0,
          (s.duration_smp as number | null) ?? null,
          1,
          (s.reason_closed as string | null) ?? 'stop',
          null,
        ],
      );
    }
    let position = 0;
    for (const v of payload.voice_segments) {
      const nt = takeMap.get(v.take_id as string);
      if (!nt) continue;
      await db.run(
        'INSERT INTO voice_segments (id, episode_id, position, take_id, src_start_smp, src_end_smp, gain_db, fade_in_smp, fade_out_smp, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [
          newId(),
          newEpisodeId,
          position,
          nt,
          v.src_start_smp as number,
          v.src_end_smp as number,
          (v.gain_db as number) ?? 0,
          (v.fade_in_smp as number) ?? 0,
          (v.fade_out_smp as number) ?? 0,
          t,
        ],
      );
      position += 10;
    }
    for (const o of payload.overlay_clips) {
      const am = assetMap.get(o.asset_id as string);
      if (!am) continue;
      const anchorTake = o.anchor_take_id ? takeMap.get(o.anchor_take_id as string) : null;
      if (o.anchor_type === 'source' && !anchorTake) continue;
      await db.run(
        'INSERT INTO overlay_clips (id, episode_id, asset_id, kind, anchor_type, anchor_take_id, anchor_smp, src_start_smp, src_end_smp, gain_db, fade_in_smp, fade_out_smp, duck, loop, end_mode, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          newId(),
          newEpisodeId,
          am.id,
          o.kind as string,
          o.anchor_type as string,
          anchorTake ?? null,
          (o.anchor_smp as number) ?? 0,
          (o.src_start_smp as number) ?? 0,
          (o.src_end_smp as number | null) ?? null,
          (o.gain_db as number) ?? 0,
          (o.fade_in_smp as number) ?? 0,
          (o.fade_out_smp as number) ?? 0,
          (o.duck as number) ?? 0,
          (o.loop as number) ?? 0,
          (o.end_mode as string) ?? 'asset_end',
          t,
        ],
      );
    }
    let i = 0;
    for (const m of payload.markers) {
      const nt = takeMap.get(m.take_id as string);
      if (!nt) continue;
      await db.run(
        'INSERT INTO markers (id, episode_id, take_id, src_smp, label, kind, resolved, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [
          newId(),
          newEpisodeId,
          nt,
          m.src_smp as number,
          (m.label as string) ?? '',
          (m.kind as string) ?? 'edit_point',
          (m.resolved as number) ?? 0,
          t + i++,
        ],
      );
    }
    for (const tp of payload.topics) {
      const ct = tp.checked_take_id ? (takeMap.get(tp.checked_take_id as string) ?? null) : null;
      await db.run(
        'INSERT INTO topics (id, episode_id, position, text, checked_at, checked_take_id, checked_src_smp) VALUES (?,?,?,?,?,?,?)',
        [
          newId(),
          newEpisodeId,
          tp.position as number,
          (tp.text as string) ?? '',
          (tp.checked_at as number | null) ?? null,
          ct,
          ct ? ((tp.checked_src_smp as number | null) ?? null) : null,
        ],
      );
    }
    // exports はファイルを同梱しないので履歴だけ（path なし・status は done のまま）
    for (const ex of payload.exports) {
      await db.run(
        'INSERT INTO exports (id, episode_id, format, preset, status, progress, path, bytes, duration_smp, measured_lufs, measured_true_peak, error, created_at, finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          newId(),
          newEpisodeId,
          ex.format as string,
          (ex.preset as string) ?? '{}',
          (ex.status as string) === 'done' ? 'done' : 'failed',
          1,
          null,
          null,
          (ex.duration_smp as number) ?? 0,
          (ex.measured_lufs as number | null) ?? null,
          (ex.measured_true_peak as number | null) ?? null,
          (ex.status as string) === 'done'
            ? 'バックアップにはファイルを含みません'
            : 'バックアップ復元時に中断扱い',
          (ex.created_at as number) ?? t,
          (ex.finished_at as number | null) ?? null,
        ],
      );
    }
  });
  onProgress?.({ phase: 'db', progress: 1 });
  let reused = 0;
  let imported = 0;
  for (const m of assetMap.values()) {
    if (m.reuse) reused++;
    else imported++;
  }
  return {
    episodeId: newEpisodeId,
    episodeNumber,
    takes: payload.takes.length,
    reusedAssets: reused,
    importedAssets: imported,
  };
}

export function backupFileName(episodeNumber: number, title: string, at: Date): string {
  const safe = title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'episode';
  const d = at.toISOString().slice(0, 10);
  return `podsnow_ep${episodeNumber}_${safe}_${d}.${BACKUP_EXTENSION}`;
}
