import { useCallback, useRef, useState } from 'react';

export interface ToastState {
  text: string;
  action?: string;
  onAction?: () => void;
}

/**
 * 「削除は確認なし、直後に取り消す」のためのトースト（PRODUCT.md §6）。
 *
 * 表示時間はアクションの有無で変える（Issue #89）。取り消しリンク付きは読んで判断して
 * 押すまでの時間が要るので、通知だけのときより長く出す。
 */
export function useToast(durationMs = 3200, actionDurationMs = 5600) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const show = useCallback(
    (t: ToastState) => {
      clear();
      setToast(t);
      timer.current = setTimeout(() => setToast(null), t.action ? actionDurationMs : durationMs);
    },
    [actionDurationMs, clear, durationMs],
  );
  const act = useCallback(() => {
    clear();
    toast?.onAction?.();
    setToast(null);
  }, [clear, toast]);
  /** スワイプで閉じる（Issue #89）。 */
  const dismiss = useCallback(() => {
    clear();
    setToast(null);
  }, [clear]);
  return { toast, show, act, dismiss };
}
