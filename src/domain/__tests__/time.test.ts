import { formatClock, formatSmp, msToSmp, secToSmp, smp, smpToMs } from '../time';

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
  it('formats the recording clock as mm:ss, and h:mm:ss from one hour', () => {
    expect(formatClock(secToSmp(59.9))).toBe('00:59');
    expect(formatClock(secToSmp(3599))).toBe('59:59');
    expect(formatClock(secToSmp(3600))).toBe('1:00:00');
    expect(formatClock(secToSmp(3 * 3600 + 62))).toBe('3:01:02');
    expect(formatClock(smp(-1))).toBe('00:00');
  });
});
