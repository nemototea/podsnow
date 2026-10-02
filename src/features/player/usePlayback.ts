import { useCallback, useEffect, useState } from 'react';

import { smp, ZERO_SMP, type Smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import type { HomeEpisodeItem } from '@/services/home/HomeService';

import { samePlaybackStatus, type PlaybackStatus } from './playbackStatus';

/**
 * 再生元と再生中かだけを購読する。位置の更新（250ms ごと）では描き直さない。
 * 一覧のように「どの回が再生中か」だけ分かればよい画面で使う（#187）。
 */
export function usePlaybackStatus() {
  const { playback } = useServices();
  const [state, setState] = useState<PlaybackStatus>(() => ({
    source: playback.source,
    playing: playback.isPlaying,
  }));
  useEffect(() => {
    const update = () => {
      const next = { source: playback.source, playing: playback.isPlaying };
      setState((prev) => (samePlaybackStatus(prev, next) ? prev : next));
    };
    const sub = playback.on('state', update);
    update();
    return () => sub.remove();
  }, [playback]);
  return {
    ...state,
    toggleHome: (item: HomeEpisodeItem) => playback.toggleHome(item),
  };
}

/** 位置と長さも購読する。ミニプレーヤーとプレーヤー画面で使う。 */
export function usePlayback() {
  const { playback } = useServices();
  const snapshot = useCallback(
    () => ({
      source: playback.source,
      playing: playback.isPlaying,
      position: playback.position,
      duration: playback.duration,
    }),
    [playback],
  );
  const [state, setState] = useState(snapshot);
  useEffect(() => {
    const update = () => setState(snapshot());
    const a = playback.on('state', update);
    const b = playback.on('position', update);
    update();
    return () => {
      a.remove();
      b.remove();
    };
  }, [playback, snapshot]);
  return {
    ...state,
    seek: (to: Smp) => playback.seekHome(to),
    toggleHome: (item: HomeEpisodeItem) => playback.toggleHome(item),
    toggleCurrent: () => playback.toggleCurrentHome(),
    stop: () => playback.pause(),
    stopHome: () => playback.stopHome(),
    rewind: () => playback.seekHome(smp(Math.max(0, state.position - 15 * 48000))),
    forward: () => playback.seekHome(smp(Math.min(state.duration, state.position + 30 * 48000))),
    restart: () => playback.seekHome(ZERO_SMP),
  };
}
