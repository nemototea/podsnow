import { useSyncExternalStore } from 'react';

import type { HomeEpisodeItem } from '@/services/home/HomeService';

import { episodeStatusKind } from './statusIcon';

/**
 * 下書きバー（DESIGN_SYSTEM.md §8 ミニプレーヤー）に出す回。Home が読み直した一覧から決め、
 * 何も再生していないときにミニプレーヤーが Home の下に出す。
 */
let current: HomeEpisodeItem | null = null;
const listeners = new Set<() => void>();

/** 一覧のうち、録音があってまだ書き出していない、いちばん上の手元の回。 */
export function pickDraft(list: readonly HomeEpisodeItem[]): HomeEpisodeItem | null {
  return (
    list.find((item) => {
      const kind = episodeStatusKind(item);
      return kind === 'draft' || kind === 'ready';
    }) ?? null
  );
}

export const draftBar = {
  set(item: HomeEpisodeItem | null) {
    if (item?.key === current?.key && item?.durationSmp === current?.durationSmp) return;
    current = item;
    listeners.forEach((fn) => fn());
  },
  get: () => current,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function useDraftBar(): HomeEpisodeItem | null {
  return useSyncExternalStore(draftBar.subscribe, draftBar.get, draftBar.get);
}
