import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastState {
  text: string;
  action?: string;
  onAction?: () => void;
  persist?: boolean;
}

/** 知らせるだけの通知の表示時間。 */
export const TOAST_MS = 4000;
/** 「取り消す」などの操作を含む通知の表示時間。取り消しは画面上部に常にあるので残さない（Issue #172）。 */
export const TOAST_ACTION_MS = 6000;

/** 通知を時間で消すまでの ms。録音データの安全に関わる通知（`persist`）は時間で消さない。 */
export function toastLifetime(t: ToastState): number | null {
  if (t.persist) return null;
  return t.action ? TOAST_ACTION_MS : TOAST_MS;
}

export function useToast() {
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
      const life = toastLifetime(t);
      if (life !== null) timer.current = setTimeout(() => setToast(null), life);
    },
    [clear],
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

/** 「取り消す」付きの通知と、それを出したときの取り消し履歴の先頭。 */
export interface UndoToast {
  toast: ToastState;
  top: string | null;
}

/**
 * 「取り消す」付きの通知をどうするか。別の通知に置き換わった・時間で消えたなら追うのをやめ（forget）、
 * 出したあとに別の編集で履歴の先頭が変わったなら閉じる（dismiss）。
 * 置き換わった後の通知（割り込みなど）を、古い「取り消す」の都合で閉じないため。
 */
export function undoToastFate(
  tracked: UndoToast | null,
  current: ToastState | null,
  undoTopId: string | null,
): 'keep' | 'forget' | 'dismiss' {
  if (!tracked) return 'keep';
  if (current !== tracked.toast) return 'forget';
  return tracked.top === undoTopId ? 'keep' : 'dismiss';
}
