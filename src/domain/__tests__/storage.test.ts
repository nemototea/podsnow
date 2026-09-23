import { estimateRecordable } from '../storage';

const mono48k = { sampleRate: 48000, channels: 1, reserveBytes: 30 * 1024 * 1024 };

describe('estimateRecordable', () => {
  it('空き容量が取れないときは推定を出さない', () => {
    expect(estimateRecordable(0, mono48k)).toBeNull();
    expect(estimateRecordable(Number.NaN, mono48k)).toBeNull();
    expect(estimateRecordable(-1, mono48k)).toBeNull();
  });

  it('停止のしきい値ぶんを差し引き、16 bit PCM の実レートで割る', () => {
    const oneHour = 48000 * 2 * 3600;
    const r = estimateRecordable(oneHour + mono48k.reserveBytes, mono48k);
    expect(r).toEqual({ seconds: 3600, unit: 'minutes', value: 60 });
  });

  it('2 時間以上は時間で、切り捨てて示す（多めに見せない）', () => {
    const bytes = 48000 * 2 * (3 * 3600 + 3599) + mono48k.reserveBytes;
    expect(estimateRecordable(bytes, mono48k)).toMatchObject({ unit: 'hours', value: 3 });
  });

  it('ステレオは半分になる', () => {
    const bytes = 48000 * 2 * 2 * 600 + mono48k.reserveBytes;
    expect(estimateRecordable(bytes, { ...mono48k, channels: 2 })).toMatchObject({
      unit: 'minutes',
      value: 10,
    });
  });

  it('しきい値を下回っていれば 0', () => {
    expect(estimateRecordable(1024, mono48k)).toMatchObject({ seconds: 0, value: 0 });
  });
});
