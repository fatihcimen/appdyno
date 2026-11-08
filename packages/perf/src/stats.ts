import { median, must, quantile } from '@appdyno/core';

/** The statistics of a comparison: pure, and the same answer every time for the same samples. */

export { median, quantile };

export type Spread = { min: number; max: number; mad: number };

/** The range and the median absolute deviation, which one wild reading hardly moves. */
export const spread = (xs: number[]): Spread => {
  const m = median(xs);
  return {
    min: Math.min(...xs),
    max: Math.max(...xs),
    mad: median(xs.map((x) => Math.abs(x - m))),
  };
};

/** Hodges-Lehmann: the median of every pairwise difference, the shift from `a` to `b`. */
export const shift = (a: number[], b: number[]) => median(a.flatMap((x) => b.map((y) => y - x)));

const midranks = (values: number[]) => {
  const order = values.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (
      j + 1 < order.length &&
      must(order[j + 1], 'a value')[0] === must(order[i], 'a value')[0]
    )
      j++;
    for (let k = i; k <= j; k++) ranks[must(order[k], 'a value')[1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return ranks;
};

/** The same draw every time for the same seed. */
export const seededRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};

/**
 * Two-sided p of a rank-sum (Mann-Whitney) test, by permuting the ranks: integer milliseconds tie often, and
 * permutation needs no correction for that. A fixed seed keeps a gate's answer the same on a re-run.
 */
export function rankTest(a: number[], b: number[], draws = 20_000): number {
  const ranks = midranks([...a, ...b]);
  const n = a.length;
  const expected = (n * (ranks.length + 1)) / 2;
  const observed = Math.abs(ranks.slice(0, n).reduce((s, r) => s + r, 0) - expected);
  const random = seededRandom(0x9e3779b9);
  let extreme = 0;
  for (let d = 0; d < draws; d++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(random() * (ranks.length - i));
      const drawn = must(ranks[j], 'a rank');
      ranks[j] = must(ranks[i], 'a rank');
      ranks[i] = drawn;
      sum += drawn;
    }
    if (Math.abs(sum - expected) >= observed - 1e-9) extreme++;
  }
  return (extreme + 1) / (draws + 1);
}
