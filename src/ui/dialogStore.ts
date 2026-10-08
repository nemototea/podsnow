/**
 * ダイアログの要求とその表示先（DESIGN_SYSTEM.md §6.3）。
 *
 * 要求はキューに積み、先頭を 1 つずつ出す。表示先（`DialogHost`）はルートと各 `Sheet` の中にあり、
 * **一番新しく登録されたホストだけが描く**。iOS の Modal は一番近いビューコントローラから出るので、
 * ルートのホストは表示中のページシートの上に出せないため。
 * 表示先は描画の時点で決める。シートを閉じた直後に出した確認は、シートのホストが外れればルートが引き継ぐ。
 */

export type DialogTone = 'primary' | 'danger';

export interface DialogRequest {
  title: string;
  message?: string;
  confirmLabel: string;
  tone: DialogTone;
  onConfirm?: () => void;
  /** 無ければボタンは 1 つ（知らせるだけ）。閉じる操作は実行と同じ扱いになる。 */
  cancelLabel?: string;
  onCancel?: () => void;
}

export interface DialogEntry extends DialogRequest {
  id: number;
}

export interface DialogSnapshot {
  current: DialogEntry | null;
  host: number | null;
}

export interface DialogStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => DialogSnapshot;
  show: (request: DialogRequest) => void;
  /** ホストの id を払い出す（登録はしない）。 */
  hostId: () => number;
  /** ホストを登録し、外す関数を返す。 */
  register: (id: number) => () => void;
  /**
   * 先頭の要求に答える。`confirmed` が false ならキャンセル（戻る操作・背景のタップも同じ）。
   * 先頭でない id は無視するので、連打しても 1 回しか呼ばれない。
   */
  resolve: (id: number, confirmed: boolean) => void;
}

export function createDialogStore(): DialogStore {
  let queue: DialogEntry[] = [];
  let hosts: number[] = [];
  let seq = 0;
  let snapshot: DialogSnapshot = { current: null, host: null };
  const listeners = new Set<() => void>();

  const emit = () => {
    snapshot = { current: queue[0] ?? null, host: hosts[hosts.length - 1] ?? null };
    listeners.forEach((l) => l());
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    show: (request) => {
      queue = [...queue, { ...request, id: ++seq }];
      emit();
    },
    hostId: () => ++seq,
    register: (id) => {
      hosts = [...hosts.filter((h) => h !== id), id];
      emit();
      return () => {
        hosts = hosts.filter((h) => h !== id);
        emit();
      };
    },
    resolve: (id, confirmed) => {
      const head = queue[0];
      if (!head || head.id !== id) return;
      // 先にキューから外す。コールバックが次の要求を積んでも、今の要求が残らないように。
      queue = queue.slice(1);
      emit();
      if (confirmed || head.cancelLabel === undefined) head.onConfirm?.();
      else head.onCancel?.();
    },
  };
}

/** アプリ全体で 1 つ。`alerts.ts` が積み、`DialogHost` が描く。 */
export const dialogs = createDialogStore();
