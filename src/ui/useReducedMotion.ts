import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * OS の「視差効果を減らす / アニメーションを減らす」設定（better-accessibility）。
 *
 * true のときは移動・拡大をやめて不透明度の切り替えだけにする。動きを完全に消すのではなく、
 * 位置が飛ぶのを避ける。動きだけで状態を伝えている箇所はそもそも直す。
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
