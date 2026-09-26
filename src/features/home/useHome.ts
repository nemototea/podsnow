import { useCallback, useEffect, useState } from 'react';

import type { EpisodeListItem } from '@/infra/db/repositories/episodesRepo';

import { useServices } from '../app/ServicesProvider';

export function useHome() {
  const { episodes, show } = useServices();
  const [list, setList] = useState<EpisodeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setList(await episodes.list(show.id));
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
  return { list, loading, reload };
}
