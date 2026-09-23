import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastState {
  text: string;
  action?: string;
  onAction?: () => void;
  persist?: boolean;
}

export function toastLifetime(t: ToastState, durationMs: number): number | null {
  return t.action || t.persist ? null : durationMs;
}

export function useToast(durationMs = 4000) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);
  const show = useCallback(
    (t: ToastState) => {
      clear();
      setToast(t);
      const life = toastLifetime(t, durationMs);
      if (life !== null) timer.current = setTimeout(() => setToast(null), life);
    },
    [clear, durationMs],
  );
  const act = useCallback(() => {
    clear();
    toast?.onAction?.();
    setToast(null);
  }, [clear, toast]);
  const dismiss = useCallback(() => {
    clear();
    setToast(null);
  }, [clear]);
  return { toast, show, act, dismiss };
}
