import type { LanguagePreference } from '@/domain/locale';

import type { SqlExecutor } from '../executor';

/** アプリ全般設定（DATA_MODEL.md §4.16）。型付きの既定値と JSON 値。 */
export interface AppSettings {
  /** 表示言語。`'system'` は端末のロケールに従う（FR-I18N-3）。 */
  language: LanguagePreference;
  theme: 'dark' | 'light' | 'system';
  recording: {
    sampleRate: number;
    channels: 1 | 2;
    preferredInputUid: string | null;
    autoResumeAfterInterruption: boolean;
    expectedMinutes: number;
    androidAudioSource: 'mic' | 'voice_recognition' | 'unprocessed' | 'camcorder';
  };
  silence: { minDurationMs: number; thresholdDb: number; padMs: number; autoApply: boolean };
  haptics: boolean;
  export: {
    defaultPreset: 'podcast' | 'high' | 'wav' | 'custom';
    /** カスタム書き出しの項目。読み出し側で `normalizeCustomExport` を通す。 */
    custom: { format: 'm4a' | 'wav'; bitrate: number; channels: 1 | 2 };
  };
  monitor: { jinglePlayback: 'always' | 'headphonesOnly' | 'never' };
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'system',
  theme: 'dark',
  recording: {
    sampleRate: 48000,
    channels: 2,
    preferredInputUid: null,
    autoResumeAfterInterruption: false,
    expectedMinutes: 60,
    androidAudioSource: 'voice_recognition',
  },
  silence: { minDurationMs: 1500, thresholdDb: -45, padMs: 250, autoApply: false },
  haptics: true,
  export: { defaultPreset: 'podcast', custom: { format: 'm4a', bitrate: 192_000, channels: 1 } },
  monitor: { jinglePlayback: 'headphonesOnly' },
};

export async function loadSettings(db: SqlExecutor): Promise<AppSettings> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM app_settings');
  const out: AppSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value) as unknown;
      const k = r.key as keyof AppSettings;
      if (k in out) {
        const cur = out[k];
        (out as unknown as Record<string, unknown>)[k] =
          typeof cur === 'object' && cur !== null && typeof v === 'object' && v !== null
            ? { ...cur, ...v }
            : v;
      }
    } catch {
      /* 壊れた値は既定にフォールバック */
    }
  }
  return out;
}

export async function saveSetting<K extends keyof AppSettings>(
  db: SqlExecutor,
  key: K,
  value: AppSettings[K],
): Promise<void> {
  await db.run(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
}
