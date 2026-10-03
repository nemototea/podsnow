import { handToHome, settleHandoffs } from '../handToHome';

describe('handToHome（Issue #168）', () => {
  it('runs tasks one by one in order and collects the toast texts', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    handToHome(async () => {
      await gate;
      order.push('remove');
      return '#3 removed';
    });
    handToHome(async () => {
      order.push('discard');
      return null;
    });
    const settled = settleHandoffs();
    expect(order).toEqual([]);
    release();
    expect(await settled).toEqual(['#3 removed']);
    expect(order).toEqual(['remove', 'discard']);
  });

  it('starts empty after settling, and a failing task does not block the rest', async () => {
    expect(await settleHandoffs()).toEqual([]);
    handToHome(() => Promise.reject(new Error('boom')));
    handToHome(async () => 'after');
    expect(await settleHandoffs()).toEqual(['after']);
    expect(await settleHandoffs()).toEqual([]);
  });
});
