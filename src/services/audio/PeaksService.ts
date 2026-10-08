import type { SqlExecutor } from '@/infra/db/executor';
import { listSegments } from '@/infra/db/repositories/takesRepo';
import { joinRoot, relPaths } from '@/infra/files/layout';

import type { AudioEnginePort } from './AudioEnginePort';

export const PEAKS_PER_SECOND = 100;

/** Take の全 Segment について .peaks を生成し、take_segments.peaks_path に記録する。 */
export async function ensureTakePeaks(
  deps: {
    db: SqlExecutor;
    engine: AudioEnginePort;
    root: string;
    fileExists: (abs: string) => boolean;
  },
  episodeId: string,
  takeId: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const s of await listSegments(deps.db, takeId)) {
    if (!s.header_valid) continue;
    const rel = relPaths.segmentPeaks(episodeId, takeId, s.seq);
    const abs = joinRoot(deps.root, rel);
    if (!s.peaks_path || !deps.fileExists(abs)) {
      await deps.engine.generatePeaks(joinRoot(deps.root, s.path), abs, PEAKS_PER_SECOND);
      await deps.db.run('UPDATE take_segments SET peaks_path = ? WHERE id = ?', [rel, s.id]);
    }
    out.push(rel);
  }
  return out;
}
