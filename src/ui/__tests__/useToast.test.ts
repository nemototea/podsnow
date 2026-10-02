import { TOAST_ACTION_MS, TOAST_MS, toastLifetime, undoToastFate } from '../useToast';

describe('通知の表示時間（Issue #172）', () => {
  it('知らせるだけの通知は時間で消える', () => {
    expect(toastLifetime({ text: 'x' })).toBe(TOAST_MS);
  });

  it('「取り消す」付きの通知も数秒で消える（取り消しは画面上部に常にある）', () => {
    expect(toastLifetime({ text: 'x', action: '取り消す' })).toBe(TOAST_ACTION_MS);
  });

  it('操作を含む通知は、知らせるだけの通知より長く出す', () => {
    expect(TOAST_ACTION_MS).toBeGreaterThan(TOAST_MS);
  });

  it('割り込み・容量不足など、録音データの安全に関わる通知は時間では消さない', () => {
    expect(toastLifetime({ text: 'x', persist: true })).toBeNull();
    expect(toastLifetime({ text: 'x', action: '閉じる', persist: true })).toBeNull();
  });
});

describe('「取り消す」付きの通知の後始末', () => {
  const undo = { text: '削除しました', action: '取り消す' };

  it('追っている通知が無ければ何もしない', () => {
    expect(undoToastFate(null, undo, 'a')).toBe('keep');
  });

  it('出したときから履歴の先頭が変わらなければ残す', () => {
    expect(undoToastFate({ toast: undo, top: 'a' }, undo, 'a')).toBe('keep');
  });

  it('別の編集で履歴の先頭が変わったら閉じる', () => {
    expect(undoToastFate({ toast: undo, top: 'a' }, undo, 'b')).toBe('dismiss');
  });

  it('時間で消えたあとは、追うのをやめる', () => {
    expect(undoToastFate({ toast: undo, top: 'a' }, null, 'b')).toBe('forget');
  });

  it('別の通知（割り込みなど）に置き換わったら、その通知は閉じない', () => {
    const interrupted = { text: '割り込みで止まっています', persist: true };
    expect(undoToastFate({ toast: undo, top: 'a' }, interrupted, 'b')).toBe('forget');
  });
});
