import { useEffect, useState } from 'react';

import { useServices } from '@/features/app/ServicesProvider';
import type { HomeEpisodeItem } from '@/services/home/HomeService';

/**
 * 再生中の回の Home の行を読む（Issue #188）。プレーヤー画面の日付・概要に使う。
 * 再生の状態は変えない（読むだけ）。
 */
export function usePlayerItem(homeKey: string | null): HomeEpisodeItem | null {
  const { home, show } = useServices();
  const [item, setItem] = useState<HomeEpisodeItem | null>(null);
  useEffect(() => {
    if (!homeKey) return;
    let alive = true;
    void home
      .list(show.id)
      .then((list) => {
        if (alive) setItem(list.find((i) => i.key === homeKey) ?? null);
      })
      .catch(() => {
        if (alive) setItem(null);
      });
    return () => {
      alive = false;
    };
  }, [home, show.id, homeKey]);
  return homeKey && item?.key === homeKey ? item : null;
}
