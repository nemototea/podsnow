import {
  buildRenderDocument,
  type AssetFile,
  type TakeFile,
} from '@/domain/render/buildRenderDocument';
import {
  DEFAULT_DUCKING,
  DEFAULT_LOUDNESS,
  type DuckingSettings,
  type LoudnessSettings,
  type RenderDocument,
} from '@/domain/render/types';
import type { Smp } from '@/domain/time';
import type { SqlExecutor } from '@/infra/db/executor';
import { getAssetsByIds } from '@/infra/db/repositories/assetsRepo';
import { loadDoc } from '@/infra/db/repositories/editableDocRepo';
import { listSegments } from '@/infra/db/repositories/takesRepo';
import { joinRoot } from '@/infra/files/layout';

export interface SoundSettings {
  loudness: LoudnessSettings;
  ducking: DuckingSettings;
}

export function parseSoundSettings(json: string | null | undefined): SoundSettings {
  let parsed: Partial<SoundSettings> = {};
  try {
    parsed = json ? (JSON.parse(json) as Partial<SoundSettings>) : {};
  } catch {
    parsed = {};
  }
  return {
    loudness: { ...DEFAULT_LOUDNESS, ...(parsed.loudness ?? {}) },
    ducking: { ...DEFAULT_DUCKING, ...(parsed.ducking ?? {}) },
  };
}

/**
 * 新しいエピソードの音の仕上げ。番組の既定（BGM を下げる量）を写し、ほかはアプリの既定値。
 * 写した後はエピソードの値で、番組の既定を変えても作成済みのエピソードは変わらない（Issue #174）。
 */
export function soundSettingsFromShow(bgmDuckDb: number): string {
  const base = parseSoundSettings(null);
  return JSON.stringify({ ...base, ducking: { ...base.ducking, depthDb: bgmDuckDb } });
}

/**
 * 試聴へ送る音の仕上げ（`updateTimelineSound` の JSON。AUDIO_DESIGN.md §7.1）。
 * `gainDb` が null なら未測定で、ネイティブは調整なし（ゲイン 0 dB・リミッター素通し）で鳴らす。
 */
export function timelineSoundJson(sound: SoundSettings, gainDb: number | null): string {
  return JSON.stringify({
    ducking: sound.ducking,
    loudness: gainDb == null ? sound.loudness : { ...sound.loudness, gainDb },
  });
}

/** DB からエピソードの RenderDocument を組み立てる（ネイティブは DB を読まない）。 */
export async function renderDocumentFromDb(
  db: SqlExecutor,
  root: string,
  episodeId: string,
  opts: {
    channels?: 1 | 2;
    sampleRate?: number;
    /** 求めてあるゲイン（AUDIO_DESIGN.md §8.4）。試聴はこれで鳴らし、書き出しは測定を飛ばす。 */
    loudnessGainDb?: number | null;
  } = {},
): Promise<RenderDocument> {
  const doc = await loadDoc(db, episodeId);
  const ep = await db.get<{ sound_settings: string }>(
    'SELECT sound_settings FROM episodes WHERE id = ?',
    [episodeId],
  );
  const sound = parseSoundSettings(ep?.sound_settings);
  const takeIds = [...new Set(doc.voice.map((v) => v.takeId))];
  const takeFiles: TakeFile[] = [];
  for (const takeId of takeIds) {
    for (const s of await listSegments(db, takeId)) {
      if (!s.header_valid || !s.duration_smp) continue;
      takeFiles.push({
        takeId,
        offset: s.offset_smp,
        duration: s.duration_smp,
        path: joinRoot(root, s.path),
      });
    }
  }
  const assetIds = [...new Set(doc.overlays.map((o) => o.assetId))];
  const assets: AssetFile[] = (await getAssetsByIds(db, assetIds)).map((a) => ({
    assetId: a.id,
    path: joinRoot(root, a.path),
    duration: a.duration_smp as Smp,
  }));
  const rendered = buildRenderDocument({
    sampleRate: opts.sampleRate ?? 48000,
    channels: opts.channels ?? 1,
    voice: doc.voice,
    overlays: doc.overlays,
    takeFiles,
    assets,
    ducking: sound.ducking,
    loudness: sound.loudness,
  });
  if (opts.loudnessGainDb != null)
    rendered.loudness = { ...rendered.loudness, gainDb: opts.loudnessGainDb };
  return rendered;
}
