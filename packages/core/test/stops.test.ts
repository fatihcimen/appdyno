import { describe, expect, it } from 'vitest';
import { refreshMsOf, stopsInLog } from '../src/frames.js';

const at = (times: (number | undefined)[]) => (i: number) => times[i];

describe('a stop of a main thread in its log', () => {
  // the line a 1500 ms hold wrote on an Android 14 emulator
  const SKIPPED =
    'I Choreographer: Skipped 90 frames!  The application may be doing too much work on its main thread.';

  it('ends at its line and reaches back by the frames skipped', () => {
    expect(stopsInLog([SKIPPED], at([10_000]), 16.7)).toEqual([{ at: 8_497, ms: 1_503 }]);
  });

  it('goes by the refresh it is given: the same 90 frames on a 120 Hz screen are half as long', () => {
    expect(stopsInLog([SKIPPED], at([10_000]), 8.3)[0]!.ms).toBeCloseTo(747, 0);
  });

  it('finds every one, among whatever else a log says', () => {
    const lines = ['I Other: nothing', SKIPPED, 'W Other: frames skipped by a word', SKIPPED];
    expect(stopsInLog(lines, at([1, 2_000, 3, 4_000]), 16.7)).toHaveLength(2);
  });

  it('reads nothing into a line with no place on the clock', () => {
    expect(stopsInLog([SKIPPED], at([undefined]), 16.7)).toEqual([]);
  });
});

describe('a refresh, by when frames came', () => {
  it('is the middle gap, whatever a stall does to the longest', () => {
    expect(refreshMsOf([0, 16, 32, 48, 1_048, 1_064, 1_080])).toBe(16);
  });

  it('reads a fast screen as fast', () => {
    expect(refreshMsOf([0, 8, 16, 24, 32])).toBe(8);
  });

  it('takes 60 Hz where frames say nothing of it', () => {
    expect(refreshMsOf([])).toBeCloseTo(16.67, 1);
    expect(refreshMsOf([0, 500, 1_000])).toBeCloseTo(16.67, 1);
  });
});
