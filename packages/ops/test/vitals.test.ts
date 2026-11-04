import { describe, expect, it } from 'vitest';
import { frameVitals } from '../src/perf/vitals.js';

describe("a session's frames in Play's words", () => {
  it('reads a screen of slow frames as one that would count', () => {
    const { lines, shares } = frameVitals([{ frames: 100, over16: 98, over700: 0 }]);
    expect(shares?.slowPercent).toBe(98);
    expect(lines[0]).toContain('this session would count as slow frames: 98 % of frames over 16');
  });

  it.each([
    // one 800 ms frame in 2,000: 0.05 % does not count
    [2_000, 1, 0.05, false],
    // three in 1,500: 0.2 % does
    [1_500, 3, 0.2, true],
  ])('of %i frames with %i frozen reads %d %%', (frames, over700, percent, counts) => {
    const { lines, shares, metrics } = frameVitals([{ frames, over16: 0, over700 }]);
    expect(shares?.frozenPercent).toBe(percent);
    expect(lines[1]).toContain(counts ? 'would count as frozen' : 'would not count as frozen');
    expect(metrics.find((m) => m.kind === 'frames.frozen_percent')!.samples).toEqual([percent]);
  });

  it('says too few frames under 1,000, and keeps no share', () => {
    const { lines, shares, metrics } = frameVitals([{ frames: 500, over16: 0, over700: 1 }]);
    expect(lines[1]).toContain('too few frames to say of frozen frames (500 of the 1000 it takes)');
    expect(shares?.frozenPercent).toBeUndefined();
    expect(metrics.find((m) => m.kind === 'frames.frozen_percent')!.samples).toEqual([]);
  });

  it('pools rounds for the frozen share, and keeps slow frames round by round', () => {
    const { metrics, shares } = frameVitals([
      { frames: 600, over16: 60, over700: 1 },
      { frames: 600, over16: 120, over700: 1 },
    ]);
    expect(shares?.frozenPercent).toBe(0.17);
    expect(metrics.find((m) => m.kind === 'frames.slow_percent')!.samples).toEqual([10, 20]);
  });

  it('says too few frames for a few frames of slow, and has nothing with no histogram', () => {
    expect(frameVitals([{ frames: 10, over16: 10, over700: 0 }]).lines[0]).toContain(
      'too few frames to say of slow frames (10)',
    );
    expect(frameVitals([])).toEqual({ metrics: [], lines: [] });
  });
});
