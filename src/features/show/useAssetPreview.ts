import { useCallback, useEffect, useState } from 'react';

import { smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';

/** 試聴に要る素材の値（`AssetRow` の一部）。 */
export interface PreviewableAsset {
  id: string;
  path: string;
  duration_smp: number;
}

/**
 * 番組の素材の試聴（Issue #174）。`PlaybackService` を通して鳴らす（AUDIO_DESIGN.md §10）。
 * 試聴を始めるとほかの再生は止まる。画面を離れたら止める。
 */
export function useAssetPreview() {
  const { playback } = useServices();
  const [playingId, setPlayingId] = useState<string | null>(() => playback.previewingAssetId);

  useEffect(() => {
    const sub = playback.on('state', () => setPlayingId(playback.previewingAssetId));
    return () => {
      sub.remove();
      playback.stopAssetPreview();
    };
  }, [playback]);

  const toggle = useCallback(
    async (a: PreviewableAsset) => {
      await playback.toggleAssetPreview({
        assetId: a.id,
        path: a.path,
        duration: smp(a.duration_smp),
      });
      setPlayingId(playback.previewingAssetId);
    },
    [playback],
  );

  const stop = useCallback(() => {
    playback.stopAssetPreview();
    setPlayingId(null);
  }, [playback]);

  return { playingId, toggle, stop };
}
