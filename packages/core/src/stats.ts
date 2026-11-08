/** Pure numbers of a measurement: the same answer every time for the same samples. */
import { must } from './must.js';

export const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const i = (s.length - 1) * q;
  const low = Math.floor(i);
  const at = (k: number) => must(s[k], 'a sample');
  return at(low) + (at(Math.min(low + 1, s.length - 1)) - at(low)) * (i - low);
};

/** The middle sample, or the mean of the two in the middle; NaN for no samples. */
export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const m = Math.floor(s.length / 2);
  const at = (k: number) => must(s[k], 'a sample');
  return s.length % 2 ? at(m) : (at(m - 1) + at(m)) / 2;
};

export const round1 = (x: number) => Math.round(x * 10) / 10;

export type Stats = {
  n: number;
  failed: number;
  p50: number;
  p90: number;
  p95: number;
  max: number;
  mean: number;
};

/** What a run of timed samples comes to, each in whole milliseconds; NaN where there are no samples. */
export function stats(ms: number[], failed: number): Stats {
  const at = (q: number) => Math.round(quantile(ms, q));
  return {
    n: ms.length,
    failed,
    p50: at(0.5),
    p90: at(0.9),
    p95: at(0.95),
    max: at(1),
    mean: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : Number.NaN,
  };
}
