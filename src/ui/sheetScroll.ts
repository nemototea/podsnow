import { useEffect, useRef } from 'react';

import { space } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/** シートの中身のスクロール（ScrollView と KeyboardAwareScrollView に共通の部分）。 */
export interface Scrollable {
  scrollTo: (options: { y: number; animated?: boolean }) => void;
}

/** 送り先の行の上に残す余白。前の行が少し見えて、どこにいるか分かるようにする。 */
const SCROLL_MARGIN = space.lg;

/**
 * シートを開いたとき、中身を `scrollTo`（中身の上端からの距離）まで送る（DESIGN_SYSTEM.md §2.7、#190）。
 * 開いている間に同じ値が来ても送り直さない。閉じたら忘れる。動きを減らす設定では一度に移る。
 */
export function useSheetScroll(visible: boolean, scrollTo: number | null | undefined) {
  const ref = useRef<Scrollable | null>(null);
  const reduced = useReducedMotion();
  const done = useRef<number | null>(null);
  useEffect(() => {
    if (!visible) {
      done.current = null;
      return;
    }
    if (scrollTo === null || scrollTo === undefined || done.current === scrollTo) return;
    done.current = scrollTo;
    // シートが出きってから送る（出る途中に送ると位置がずれる端末がある）
    const id = setTimeout(() => {
      ref.current?.scrollTo({ y: Math.max(0, scrollTo - SCROLL_MARGIN), animated: !reduced });
    }, 0);
    return () => clearTimeout(id);
  }, [visible, scrollTo, reduced]);
  return ref;
}
