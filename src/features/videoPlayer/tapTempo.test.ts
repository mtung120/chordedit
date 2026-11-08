import { describe, expect, it } from 'vitest';
import { fitTaps } from './tapTempo.js';

describe('fitTaps', () => {
  it('needs two taps', () => {
    expect(fitTaps([])).toBeNull();
    expect(fitTaps([1.2])).toBeNull();
  });

  it('even taps: their interval, beat 1 on the last tap', () => {
    const fit = fitTaps([10, 10.5, 11, 11.5])!;
    expect(fit.interval).toBeCloseTo(0.5);
    expect(fit.last).toBeCloseTo(11.5);
  });

  it('one late last tap barely moves beat 1 (the last tap alone would be 40 ms off)', () => {
    const fit = fitTaps([10, 10.5, 11, 11.5, 12, 12.5, 13, 13.54])!;
    expect(fit.interval).toBeCloseTo(0.5, 1);
    expect(Math.abs(fit.last - 13.5)).toBeLessThan(0.025);
  });
});
