import { smp, type Smp } from '@/domain/time';
import { planSilenceRemoval } from '@/domain/timeline/silence';
import type { Range, VoiceSegment } from '@/domain/timeline/types';
import { sourceRangeToTimeline } from '@/domain/timeline/voice';
import type { SqlExecutor } from '@/infra/db/executor';
import { listSegments } from '@/infra/db/repositories/takesRepo';
import { joinRoot } from '@/infra/files/layout';

import type { AudioEnginePort } from './AudioEnginePort';

export interface SilenceSettings {
  minDurationMs: number;
  thresholdDb: number;
  padMs: number;
}

export const DEFAULT_SILENCE_SETTINGS: SilenceSettings = {
  minDurationMs: 1500,
  thresholdDb: -45,
  padMs: 250,
};

/**
 * 声トラック上の無音区間を検出して削除計画を返す（FR-EDIT-3）。
 * 各 Take の Segment ファイルを解析し、Take 座標 → 声トラック座標へ写像してから余白を引く。
 */
export async function planSilenceForTimeline(
  deps: { db: SqlExecutor; engine: AudioEnginePort; root: string },
  voice: readonly VoiceSegment[],
  settings: SilenceSettings,
  sampleRate = 48000,
): Promise<{ ranges: Range[]; totalRemoved: Smp }> {
  const takeIds = [...new Set(voice.map((v) => v.takeId))];
  const tlSilences: Range[] = [];
  for (const takeId of takeIds) {
    for (const s of await listSegments(deps.db, takeId)) {
      if (!s.header_valid || !s.duration_smp) continue;
      const found = await deps.engine.detectSilence(joinRoot(deps.root, s.path), {
        minDurationMs: settings.minDurationMs,
        thresholdDb: settings.thresholdDb,
      });
      for (const r of found) {
        tlSilences.push(
          ...sourceRangeToTimeline(
            voice,
            takeId,
            smp(s.offset_smp + r.start),
            smp(s.offset_smp + r.end),
          ),
        );
      }
    }
  }
  const padSmp = smp((settings.padMs * sampleRate) / 1000);
  const ranges = planSilenceRemoval(tlSilences, { padSmp, minRemoveSmp: smp(1) });
  const totalRemoved = smp(ranges.reduce((a, r) => a + (r.end - r.start), 0));
  return { ranges, totalRemoved };
}
