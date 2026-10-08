import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/features/app/ServicesProvider';
import type { SqlExecutor } from '@/infra/db/executor';
import type { EpisodeRow } from '@/infra/db/repositories/episodesRepo';

/** エピソード 1 件の読み込み。reload で再取得。 */
export function useEpisode(episodeId: string) {
  const { episodes } = useServices();
  const [episode, setEpisode] = useState<EpisodeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const e = await episodes.get(episodeId);
    setEpisode(e);
    setLoading(false);
  }, [episodes, episodeId]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) void reload();
    });
    return () => {
      alive = false;
    };
  }, [reload]);
  return { episode, loading, reload };
}

/** 声トラックの総尺（サンプル数）。 */
export async function voiceDurationSmp(db: SqlExecutor, episodeId: string): Promise<number> {
  const r = await db.get<{ n: number | null }>(
    'SELECT SUM(src_end_smp - src_start_smp) AS n FROM voice_segments WHERE episode_id = ?',
    [episodeId],
  );
  return r?.n ?? 0;
}
