import { ja } from '@/i18n/ja';

import { storageLine } from '../storageLine';

const est = (minutes: number) => ({
  seconds: minutes * 60,
  unit: 'minutes' as const,
  value: minutes,
});

describe('空き容量の行（Issue #179）', () => {
  it('残りが 1 時間未満なら出す', () => {
    expect(storageLine(ja, { estimate: est(59), writerOk: true }, false)).toBe('残り約 59 分');
    expect(storageLine(ja, { estimate: est(59), writerOk: true }, true)).toBe(
      '保存中 · 残り約 59 分',
    );
  });

  it('残りが 1 時間ちょうど・それ以上なら出さない', () => {
    expect(storageLine(ja, { estimate: est(60), writerOk: true }, false)).toBeNull();
    expect(storageLine(ja, { estimate: est(60), writerOk: true }, true)).toBeNull();
    expect(
      storageLine(
        ja,
        { estimate: { seconds: 3 * 3600, unit: 'hours', value: 3 }, writerOk: true },
        true,
      ),
    ).toBeNull();
  });

  it('容量を確認できないときは常に出す', () => {
    expect(storageLine(ja, { estimate: null, writerOk: true }, false)).toBe(
      ja.record.freeSpaceUnknown,
    );
    expect(storageLine(ja, { estimate: null, writerOk: true }, true)).toBe(
      ja.record.savingOnDeviceUnknown,
    );
  });

  it('録音中に保存が止まったら、残りが十分でも常に出す', () => {
    expect(storageLine(ja, { estimate: est(600), writerOk: false }, true)).toBe(
      ja.record.savingStopped,
    );
  });
});
