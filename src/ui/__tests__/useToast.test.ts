import { toastLifetime } from '../useToast';

describe('通知の表示時間', () => {
  it('操作を含む通知（取り消すなど）は時間では消さない', () => {
    expect(toastLifetime({ text: 'x', action: '取り消す' }, 4000)).toBeNull();
  });

  it('割り込み・容量不足など、残しておくべき通知は時間では消さない', () => {
    expect(toastLifetime({ text: 'x', persist: true }, 4000)).toBeNull();
  });

  it('知らせるだけの通知は時間で消える', () => {
    expect(toastLifetime({ text: 'x' }, 4000)).toBe(4000);
  });
});
