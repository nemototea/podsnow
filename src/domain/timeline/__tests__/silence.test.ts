import { smp } from '../../time';
import { planSilenceRemoval, totalRemoved } from '../silence';

describe('planSilenceRemoval', () => {
  it('shrinks each silence by the pad and drops short ones', () => {
    const plan = planSilenceRemoval(
      [
        { start: smp(1000), end: smp(5000) },
        { start: smp(7000), end: smp(7300) },
      ],
      { padSmp: smp(200), minRemoveSmp: smp(500) },
    );
    expect(plan).toEqual([{ start: 1200, end: 4800 }]);
    expect(totalRemoved(plan)).toBe(3600);
  });
  it('merges overlapping detections first', () => {
    const plan = planSilenceRemoval(
      [
        { start: smp(0), end: smp(1000) },
        { start: smp(500), end: smp(2000) },
      ],
      { padSmp: smp(0), minRemoveSmp: smp(0) },
    );
    expect(plan).toEqual([{ start: 0, end: 2000 }]);
  });
});
