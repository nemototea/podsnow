import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import {
  DEFAULT_SHOW_DOMINANT,
  deriveShowColors,
  type ShowColors,
} from '@/domain/color/showColors';

import { useServices } from '../app/ServicesProvider';

/**
 * 番組の色（DESIGN_SYSTEM.md §2.6、Issue #235）。保存済みの代表色からすぐに計算し、画面に戻るたびに
 * `ShowColorService.ensure` で確かめる（アートワークを替えたあとは計算し直した色になる）。
 */
export function useShowColors(): ShowColors {
  const services = useServices();
  const [dominant, setDominant] = useState<string | null>(services.show.cover_color);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setDominant(services.show.cover_color);
      void services.showColors.ensure(services.show.id).then((c) => {
        if (alive) setDominant(c);
      });
      return () => {
        alive = false;
      };
    }, [services]),
  );
  return useMemo(() => deriveShowColors(dominant ?? DEFAULT_SHOW_DOMINANT), [dominant]);
}
