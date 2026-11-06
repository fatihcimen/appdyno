import { describe, expect, it } from 'vitest';
import { stats } from '../src/index.js';

describe('stats', () => {
  it('reads a run of samples, in any order, in whole milliseconds', () => {
    expect(stats([40, 10, 30, 20], 1)).toEqual({
      n: 4,
      failed: 1,
      p50: 25,
      p90: 37,
      p95: 39,
      max: 40,
      mean: 25,
    });
  });

  it('has no numbers for no samples, and still counts what failed', () => {
    expect(stats([], 3)).toEqual({
      n: 0,
      failed: 3,
      p50: NaN,
      p90: NaN,
      p95: NaN,
      max: NaN,
      mean: NaN,
    });
  });
});
