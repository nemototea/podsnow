import { useCallback, useEffect, useState } from 'react';

import { smp, ZERO_SMP, type Smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import type { HomeEpisodeItem } from '@/services/home/HomeService';

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
    rewind: () => playback.seekHome(smp(Math.max(0, state.position - 15 * 48000))),
    forward: () => playback.seekHome(smp(Math.min(state.duration, state.position + 30 * 48000))),
    restart: () => playback.seekHome(ZERO_SMP),
  };
}
