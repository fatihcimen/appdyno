import { describe, expect, it } from 'vitest';
import { functionDiff } from '../src/index.js';

const profile = (entries: Record<string, number>, durationMs = 4_000) => ({
  durationMs,
  top: Object.entries(entries).map(([symbol, samples]) => ({ symbol, samples })),
});

describe('what moved between two profiles', () => {
  it('names a function that came, in ms of CPU in each second, most first', () => {
    const before = profile({ steady: 800 });
    const after = profile({ steady: 810, known: 1_200, small: 100 });
    expect(functionDiff(before, after)).toEqual([
      { symbol: 'known', beforeMs: 0, afterMs: 300, changeMs: 300 },
      { symbol: 'small', beforeMs: 0, afterMs: 25, changeMs: 25 },
    ]);
  });

  it('names one that went, as a fall', () => {
    expect(functionDiff(profile({ a: 400 }), profile({}))).toEqual([
      { symbol: 'a', beforeMs: 100, afterMs: 0, changeMs: -100 },
    ]);
  });

  it('calls two runs of the same work nothing', () => {
    const a = profile({ steady: 800, other: 60, noise: 20 });
    const b = profile({ steady: 830, other: 50, noise: 30 });
    expect(functionDiff(a, b)).toEqual([]);
  });

  it('holds a big function to a share of itself as well', () => {
    expect(functionDiff(profile({ big: 3_600 }), profile({ big: 3_400 }))).toEqual([]);
  });

  it('compares windows of other lengths by the second', () => {
    expect(functionDiff(profile({ a: 400 }, 2_000), profile({ a: 800 }, 4_000))).toEqual([]);
  });

  it('reads the app’s own functions where a profile has them', () => {
    const app = (samples: number) => ({
      durationMs: 1_000,
      top: [{ symbol: 'libsystem_leaf', samples: 500 }],
      appTop: [{ symbol: 'myFunction', samples }],
    });
    expect(functionDiff(app(100), app(400)).map((f) => f.symbol)).toEqual(['myFunction']);
  });
});
