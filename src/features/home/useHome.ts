import { useCallback, useEffect, useState } from 'react';

import type { EpisodeListItem } from '@/infra/db/repositories/episodesRepo';

import { useServices } from '../app/ServicesProvider';

export function useHome() {
  const { episodes, show } = useServices();
  const [list, setList] = useState<EpisodeListItem[]>([]);
  const [cont, setCont] = useState<EpisodeListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const [l, c] = await Promise.all([episodes.list(show.id), episodes.continueCandidate(show.id)]);
    setList(l);
    setCont(c);
    setLoading(false);
  }, [episodes, show.id]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) void reload();
    });
    return () => {
      alive = false;
    };
  }, [reload]);
  return { list, cont, loading, reload };
}
