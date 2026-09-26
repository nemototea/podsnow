import { useCallback, useEffect, useState } from 'react';

import type { HomeEpisodeItem } from '@/services/home/HomeService';

import { useServices } from '../app/ServicesProvider';

export function useHome() {
  const { home, playback, show } = useServices();
  const [list, setList] = useState<HomeEpisodeItem[]>([]);
  const [playable, setPlayable] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const nextList = await home.list(show.id);
    const nextPlayable = await playback.availableHomeItemKeys(nextList);
    setList(nextList);
    setPlayable(nextPlayable);
    setLoading(false);
  }, [home, playback, show.id]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) void reload();
    });
    return () => {
      alive = false;
    };
  }, [reload]);
  return { list, playable, loading, reload };
}
