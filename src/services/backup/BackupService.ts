import { AppError } from '@/domain/errors';
import type { SqlExecutor, SqlRow } from '@/infra/db/executor';
import {
  episodeGuidTaken,
  episodeNumberTaken,
  nextEpisodeNumber,
  parseEpisodeExportPreset,
} from '@/infra/db/repositories/episodesRepo';
import { getShow, updateShow } from '@/infra/db/repositories/showsRepo';
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
 * manifest.json  { formatVersion: 3, app: 'podsnow', createdAt, episodeId, showId }
 * episode.json   各テーブルの行（SELECT * の JSON）
 * takes/<takeId>/seg-NNNN.wav   録音 Segment（無圧縮）
 * assets/<assetId>.wav          オーバーレイが参照する素材（無圧縮）
 * show/cover.<jpg|png>           番組アートワーク（あるとき）
 */

// 3: 番組アートワークをユーザーデータとして同梱する（Issue #133）。
// 2: markers / topics を recording_events / outline_items に置き換えた（DATA_MODEL.md §4.10 / §4.11）。
//    1 で書かれたファイルも読める（旧 topics は見出しへ、旧 markers はシステム由来のものだけ拾う）。
export const BACKUP_FORMAT_VERSION = 3;
export const BACKUP_EXTENSION = 'podsnow';

export interface BackupManifest {
  formatVersion: number;
  app: 'podsnow';
  createdAt: number;
  episodeId: string;
  showId: string;
}

export interface BackupPayload {
  /** formatVersion 3 以降。Show の他の情報は復元で上書きしない。 */
  show?: { cover_path: string | null };
  episode: SqlRow;
  takes: SqlRow[];
  take_segments: SqlRow[];
  voice_segments: SqlRow[];
  overlay_clips: SqlRow[];
  recording_events: SqlRow[];
  outline_items: SqlRow[];
  /** formatVersion 1 で書かれたファイルにだけ入っている。 */
  markers?: SqlRow[];
  topics?: SqlRow[];
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

function coverExtension(path: string): 'jpg' | 'png' {
  return /\.png$/i.test(path) ? 'png' : 'jpg';
}

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
  const show = await db.get<{ cover_path: string | null }>(
    'SELECT cover_path FROM shows WHERE id = ?',
    [episode.show_id as string],
  );
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
  const recording_events = await db.all('SELECT * FROM recording_events WHERE episode_id = ?', [
    episodeId,
  ]);
  const outline_items = await db.all(
    'SELECT * FROM outline_items WHERE episode_id = ? ORDER BY position',
    [episodeId],
  );
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
    show: { cover_path: show?.cover_path ?? null },
    episode,
    takes,
    take_segments,
    voice_segments,
    overlay_clips,
    recording_events,
    outline_items,
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
  if (show?.cover_path) {
    const abs = joinRoot(root, show.cover_path);
    if (!fs.exists(abs)) missingFiles.push(show.cover_path);
    else {
      const ext = coverExtension(show.cover_path);
      entries.push({ name: `show/cover.${ext}`, store: true, source: { path: abs } });
    }
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
  /** 元の話数が使用中で、別の話数を振り直したか（DATA_MODEL.md §7）。 */
  renumbered: boolean;
  takes: number;
  reusedAssets: number;
  importedAssets: number;
  /** 復元先に画像がなく、バックアップから戻したか。 */
  coverRestored: boolean;
}

/**
 * .podsnow を現在の Show に復元する。ID は全て採番し直す（既存 Show の素材と id が一致すれば再利用）。
 * 音声ファイルは新しい ID のパスへ展開する。
 *
 * 話数はバックアップに入っていた値をそのまま使い、同じ話数が使用中のときだけ振り直す
 * （DATA_MODEL.md §7 / FR-EP-6）。`.podsnow` は「その回の保存」なので、復元で番号が
 * 変わるのは意図に反する。ストレージクリア後に話数の台帳を作り直せるのもこの性質による。
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
  if (!manifestBytes.length) throw new AppError('backup_manifest_missing');
  const manifest = JSON.parse(utf8Decode(manifestBytes)) as BackupManifest;
  if (manifest.app !== 'podsnow' || manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new AppError('backup_unsupported_version', { version: manifest.formatVersion });
  }
  const payload = JSON.parse(utf8Decode(payloadSink.result())) as BackupPayload;
  const targetShow = await getShow(db, showId);

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
  const coverTarget =
    !targetShow?.cover_path && payload.show?.cover_path
      ? (() => {
          const ext = coverExtension(payload.show.cover_path);
          const rel = relPaths.coverFile(showId, `restore-${newEpisodeId}`, ext);
          return { rel, abs: joinRoot(root, rel), entry: `show/cover.${ext}` };
        })()
      : null;

  // 2 パス目: 音声とアートワークを展開
  for (const t of [
    ...segmentTargets.values(),
    ...assetTargets.values(),
    ...(coverTarget ? [coverTarget] : []),
  ]) {
    fs.ensureDir(t.abs.slice(0, t.abs.lastIndexOf('/')));
  }
  readZip(
    fs,
    zipAbsPath,
    (name) => {
      const t = segmentTargets.get(name) ?? assetTargets.get(name);
      if (t) return fileSink(fs, t.abs);
      return coverTarget && name === coverTarget.entry ? fileSink(fs, coverTarget.abs) : null;
    },
    (bytes, total) =>
      onProgress?.({ phase: 'unzip', progress: total ? bytes / total : 1, detail: 'audio' }),
  );

  // 3: DB へ書く
  onProgress?.({ phase: 'db', progress: 0 });
  const t = now();
  const coverRestored = !!coverTarget && fs.exists(coverTarget.abs);
  const ep = payload.episode;
  const backedUpNumber = Number(ep.episode_number ?? 0);
  const renumbered =
    !Number.isFinite(backedUpNumber) ||
    backedUpNumber <= 0 ||
    (await episodeNumberTaken(db, showId, backedUpNumber));
  const episodeNumber = renumbered ? await nextEpisodeNumber(db, showId) : backedUpNumber;
  // RSS の guid は配信済みの回を指すので引き継ぐ。0005 より前のバックアップには無いので新しい id を使う。
  // 同じ番組に同じ guid の回が既にあれば（同じバックアップを 2 回復元した等）、別の回として新しい id を振る。
  const backedUpGuid = typeof ep.guid === 'string' && ep.guid ? ep.guid : null;
  const guid =
    backedUpGuid && !(await episodeGuidTaken(db, showId, backedUpGuid))
      ? backedUpGuid
      : newEpisodeId;
  const commit = db.transaction(async () => {
    if (coverRestored && coverTarget) {
      await updateShow(db, showId, { coverPath: coverTarget.rel, coverSourceUrl: null }, t);
    }
    await db.run(
      'INSERT INTO episodes (id, show_id, title, description, description_suggestion, episode_number, season, recorded_at, publish_planned_at, status, last_opened_at, playhead_smp, undo_cursor, sound_settings, export_preset, guid, episode_type, explicit, website_url, published_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
        // 値の無い古い .podsnow や知らない値は NULL（= 設定の既定で開く。DATA_MODEL.md §4.5.1）
        parseEpisodeExportPreset(ep.export_preset),
        guid,
        (ep.episode_type as string | undefined) ?? 'full',
        (ep.explicit as number | null | undefined) ?? null,
        (ep.website_url as string | undefined) ?? '',
        (ep.published_at as number | null | undefined) ?? null,
        t,
        t,
      ],
    );
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
    // formatVersion 1 の markers からは、システムが記録したものだけを拾う。
    // ユーザーが打った edit_point / mistake は機能ごと廃止（FR-REC-4）。topic は項目側が持つ。
    const events = [
      ...(payload.recording_events ?? []),
      ...(payload.markers ?? []).filter(
        (m) => m.kind === 'interruption' || m.kind === 'route_change',
      ),
    ];
    for (const e of events) {
      const nt = takeMap.get(e.take_id as string);
      if (!nt) continue;
      await db.run(
        'INSERT INTO recording_events (id, episode_id, take_id, src_smp, label, kind, created_at) VALUES (?,?,?,?,?,?,?)',
        [
          newId(),
          newEpisodeId,
          nt,
          e.src_smp as number,
          (e.label as string) ?? '',
          e.kind as string,
          t + i++,
        ],
      );
    }
    // formatVersion 1 の topics は、見出しだけの項目として読む。
    const outline =
      payload.outline_items ??
      (payload.topics ?? []).map((tp) => ({
        position: tp.position,
        heading: tp.text,
        body: '',
        recorded_take_id: tp.checked_take_id,
        recorded_src_smp: tp.checked_src_smp,
        done_at: tp.checked_at,
      }));
    for (const tp of outline) {
      const ct = tp.recorded_take_id ? (takeMap.get(tp.recorded_take_id as string) ?? null) : null;
      await db.run(
        'INSERT INTO outline_items (id, episode_id, position, heading, body, recorded_take_id, recorded_src_smp, done_at) VALUES (?,?,?,?,?,?,?,?)',
        [
          newId(),
          newEpisodeId,
          tp.position as number,
          (tp.heading as string) ?? '',
          (tp.body as string) ?? '',
          ct,
          ct ? ((tp.recorded_src_smp as number | null) ?? null) : null,
          (tp.done_at as number | null) ?? null,
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
          // error 列には AppErrorCode を入れる（表示文言は UI 層が i18n から引く）。
          (ex.status as string) === 'done' ? 'export_not_in_backup' : 'export_cancelled_on_restore',
          (ex.created_at as number) ?? t,
          (ex.finished_at as number | null) ?? null,
        ],
      );
    }
  });
  await commit.catch((cause: unknown) => {
    if (coverRestored && coverTarget) {
      try {
        fs.delete(coverTarget.abs);
      } catch {
        // DB がロールバックされたら、参照されない展開済み画像も best effort で片付ける。
      }
    }
    throw cause;
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
    renumbered,
    takes: payload.takes.length,
    reusedAssets: reused,
    importedAssets: imported,
    coverRestored,
  };
}

export function backupFileName(episodeNumber: number, title: string, at: Date): string {
  const safe = title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'episode';
  const d = at.toISOString().slice(0, 10);
  return `podsnow_ep${episodeNumber}_${safe}_${d}.${BACKUP_EXTENSION}`;
}
