import { useCallback, useRef, useState } from 'react';

export interface ToastState {
  text: string;
  action?: string;
  onAction?: () => void;
}

/** 「削除は確認なし、直後に取り消す」のためのトースト（PRODUCT.md §6）。 */
export function useToast(durationMs = 3200) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(
    (t: ToastState) => {
      if (timer.current) clearTimeout(timer.current);
      setToast(t);
      timer.current = setTimeout(() => setToast(null), durationMs);
    },
    [durationMs],
  );
  const act = useCallback(() => {
    toast?.onAction?.();
    setToast(null);
  }, [toast]);
  return { toast, show, act };
}
