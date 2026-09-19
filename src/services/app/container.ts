import { openAppDatabase } from '@/infra/db';
import type { SqlExecutor } from '@/infra/db/executor';
import { failStaleExports } from '@/infra/db/repositories/exportsRepo';
import { loadSettings, saveSetting, type AppSettings } from '@/infra/db/repositories/settingsRepo';
import { ensureDefaultShow, type ShowRow } from '@/infra/db/repositories/showsRepo';
import { dataRoot, ensureDir, fileExists, fileSize } from '@/infra/files/fileSystem';
import { createNativeAudioEngine } from '@/infra/native/audioEngineAdapter';
import { createNativeRecorder } from '@/infra/native/recorderAdapter';

import { AssetsService } from '../assets/AssetsService';
import type { AudioEnginePort } from '../audio/AudioEnginePort';
import { PlaybackService } from '../audio/PlaybackService';
import { EditingService } from '../editing/EditingService';
import { EpisodeService } from '../episodes/EpisodeService';
import { ExportService } from '../export/ExportService';
import type { RecorderPort } from '../recording/RecorderPort';
import { RecordingSession } from '../recording/RecordingSession';
import { recoverUnfinishedTakes, type RecoveredTake } from '../recording/RecoveryService';
import { newId } from './ids';

/** アプリ全体で共有するサービス群（ARCHITECTURE.md §2）。画面はこれ経由でしか infra に触らない。 */
export interface AppServices {
  db: SqlExecutor;
  root: string;
  show: ShowRow;
  settings: AppSettings;
  recorder: RecorderPort;
  engine: AudioEnginePort;
  recording: RecordingSession;
  playback: PlaybackService;
  exporter: ExportService;
  episodes: EpisodeService;
  assets: AssetsService;
  openEditing: (episodeId: string) => Promise<EditingService>;
  updateSettings: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  /** Show 設定の保存後に services.show を最新化する。 */
  reloadShow: () => Promise<ShowRow>;
  /** 設定変更の購読（テーマの即時反映などに使う）。 */
  onSettingsChange: (fn: (s: AppSettings) => void) => { remove: () => void };
  /** 起動時に復元した Take（UI で通知する）。 */
  recovered: RecoveredTake[];
  newId: () => string;
  now: () => number;
}

export async function bootstrap(
  overrides: { recorder?: RecorderPort; engine?: AudioEnginePort } = {},
): Promise<AppServices> {
  const db = await openAppDatabase();
  const root = dataRoot();
  const now = () => Date.now();
  const show = await ensureDefaultShow(db, newId, now());
  const settings = await loadSettings(db);
  const recorder = overrides.recorder ?? createNativeRecorder();
  const engine = overrides.engine ?? createNativeAudioEngine();

  const recovered = await recoverUnfinishedTakes({ db, recorder, root, fileExists, newId, now });
  await failStaleExports(db, now());

  const live = { settings };
  const settingsListeners = new Set<(s: AppSettings) => void>();
  const recording = new RecordingSession({
    db,
    recorder,
    root,
    ensureDir,
    newId,
    now,
    settings: () => ({
      sampleRate: live.settings.recording.sampleRate,
      channels: live.settings.recording.channels,
      inputUid: live.settings.recording.preferredInputUid,
      autoResumeAfterInterruption: live.settings.recording.autoResumeAfterInterruption,
      expectedMinutes: live.settings.recording.expectedMinutes,
      diskLowThresholdBytes: 30 * 1024 * 1024,
      androidAudioSource: live.settings.recording.androidAudioSource,
    }),
  });
  const playback = new PlaybackService({ db, engine, root });
  const exporter = new ExportService({ db, engine, root, ensureDir, fileSize, newId, now });
  const episodes = new EpisodeService({ db, newId, now });
  const assets = new AssetsService({ db, engine, root, ensureDir, newId, now });

  const services: AppServices = {
    db,
    root,
    show,
    settings,
    recorder,
    engine,
    recording,
    playback,
    exporter,
    episodes,
    assets,
    openEditing: (episodeId) => EditingService.open({ db, newId, now }, episodeId),
    updateSettings: async (key, value) => {
      await saveSetting(db, key, value);
      live.settings = { ...live.settings, [key]: value };
      services.settings = live.settings;
      settingsListeners.forEach((fn) => fn(live.settings));
    },
    reloadShow: async () => {
      const s = await ensureDefaultShow(db, newId, now());
      services.show = s;
      return s;
    },
    onSettingsChange: (fn) => {
      settingsListeners.add(fn);
      return { remove: () => settingsListeners.delete(fn) };
    },
    recovered,
    newId,
    now,
  };
  return services;
}
