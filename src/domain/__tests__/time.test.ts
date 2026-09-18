import { formatSmp, msToSmp, secToSmp, smp, smpToMs } from '../time';

describe('time', () => {
  it('converts between ms and samples at 48 kHz', () => {
    expect(msToSmp(1000)).toBe(48000);
    expect(smpToMs(smp(24000))).toBe(500);
    expect(secToSmp(1.5)).toBe(72000);
  });
  it('rounds to integer samples and rejects NaN', () => {
    expect(smp(10.4)).toBe(10);
    expect(() => smp(NaN)).toThrow();
  });
  it('formats mm:ss and mm:ss.d', () => {
    expect(formatSmp(secToSmp(65))).toBe('01:05');
    expect(formatSmp(secToSmp(65.25), { tenths: true })).toBe('01:05.3');
    expect(formatSmp(smp(-5))).toBe('00:00');
  });
});
