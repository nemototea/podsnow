import { createDialogStore, type DialogRequest } from '../dialogStore';

const confirm = (over: Partial<DialogRequest> = {}): DialogRequest => ({
  title: '削除しますか？',
  confirmLabel: '削除',
  cancelLabel: 'キャンセル',
  tone: 'danger',
  ...over,
});

describe('ダイアログのキュー', () => {
  it('要求は 1 つずつ、積んだ順に出す', () => {
    const d = createDialogStore();
    d.show(confirm({ title: 'A' }));
    d.show(confirm({ title: 'B' }));
    const a = d.getSnapshot().current!;
    expect(a.title).toBe('A');
    d.resolve(a.id, false);
    expect(d.getSnapshot().current?.title).toBe('B');
  });

  it('実行とキャンセルでそれぞれのコールバックを 1 回だけ呼ぶ（連打しても 2 回呼ばない）', () => {
    const d = createDialogStore();
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    d.show(confirm({ onConfirm, onCancel }));
    const id = d.getSnapshot().current!.id;
    d.resolve(id, true);
    d.resolve(id, true);
    d.resolve(id, false);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('戻る操作・背景のタップ（キャンセル）は onCancel を呼ぶ', () => {
    const d = createDialogStore();
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    d.show(confirm({ onConfirm, onCancel }));
    d.resolve(d.getSnapshot().current!.id, false);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('知らせるだけのダイアログは、閉じても OK と同じ扱い', () => {
    const d = createDialogStore();
    const onConfirm = jest.fn();
    d.show({ title: 'エラー', confirmLabel: '閉じる', tone: 'primary', onConfirm });
    d.resolve(d.getSnapshot().current!.id, false);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('コールバックの中で積んだ次の要求がそのまま出る（許可の前置き → 設定を開く）', () => {
    const d = createDialogStore();
    d.show(confirm({ title: '許可', onConfirm: () => d.show(confirm({ title: '設定を開く' })) }));
    d.resolve(d.getSnapshot().current!.id, true);
    expect(d.getSnapshot().current?.title).toBe('設定を開く');
  });

  it('コールバックを呼ぶ時点で、答えた要求はもうキューに無い', () => {
    const d = createDialogStore();
    let seen: string | undefined;
    d.show(confirm({ onConfirm: () => (seen = d.getSnapshot().current?.title) }));
    d.resolve(d.getSnapshot().current!.id, true);
    expect(seen).toBeUndefined();
  });
});

describe('ダイアログの表示先', () => {
  it('一番新しく登録したホスト（開いているシート）に出す', () => {
    const d = createDialogStore();
    const root = d.hostId();
    const sheet = d.hostId();
    d.register(root);
    d.register(sheet);
    d.show(confirm());
    expect(d.getSnapshot().host).toBe(sheet);
  });

  it('シートを閉じてホストが外れたら、出ている要求をルートが引き継ぐ（「…」→削除）', () => {
    const d = createDialogStore();
    const root = d.hostId();
    const sheet = d.hostId();
    d.register(root);
    const removeSheet = d.register(sheet);
    d.show(confirm({ title: 'A' }));
    removeSheet();
    expect(d.getSnapshot().host).toBe(root);
    expect(d.getSnapshot().current?.title).toBe('A');
  });

  it('変化を購読者に知らせ、変化の無いあいだは同じスナップショットを返す', () => {
    const d = createDialogStore();
    const listener = jest.fn();
    const off = d.subscribe(listener);
    const before = d.getSnapshot();
    expect(d.getSnapshot()).toBe(before);
    d.show(confirm());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(d.getSnapshot()).not.toBe(before);
    off();
    d.register(d.hostId());
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
