/**
 * Tap tempo for the metronome sheet: a straight line through a run of taps
 * (song positions in seconds; least squares, position = a + i × interval),
 * so one sloppy tap barely moves the tempo or beat 1.
 */
export interface TapFit {
  /** Seconds between beats. */
  interval: number;
  /** Where the line puts the last tap: beat 1. */
  last: number;
}

/** Null until there are two taps. */
export function fitTaps(taps: readonly number[]): TapFit | null {
  const n = taps.length;
  if (n < 2) return null;
  const meanI = (n - 1) / 2;
  const meanT = taps.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  taps.forEach((t, i) => {
    num += (i - meanI) * (t - meanT);
    den += (i - meanI) ** 2;
  });
  const interval = num / den;
  return { interval, last: meanT + (n - 1 - meanI) * interval };
}
