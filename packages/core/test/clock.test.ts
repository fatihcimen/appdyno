import { describe, expect, it } from 'vitest';
import { measureClock } from '../src/clock.js';

/** A Mac's clock that moves only when a read takes time, and a device `ahead` of it, read `out` ms after the call. */
function clocks(ahead: number, trips: { out: number; back: number }[]) {
  let mac = 1_000_000;
  let i = 0;
  return {
    now: () => mac,
    read: async () => {
      const trip = trips[i++ % trips.length]!;
      mac += trip.out;
      const device = mac + ahead;
      mac += trip.back;
      return device;
    },
  };
}

describe('a device clock measured against the Mac', () => {
  it('finds the offset of a clock ahead, and of one behind', async () => {
    for (const ahead of [48, -120]) {
      const c = clocks(ahead, [{ out: 10, back: 10 }]);
      expect(await measureClock(c.read, c.now)).toEqual({ offsetMs: ahead, boundMs: 11 });
    }
  });

  it('never claims to be exact: a trip inside one tick of the Mac still has that tick', async () => {
    const c = clocks(31, [{ out: 0, back: 0 }]);
    expect(await measureClock(c.read, c.now)).toEqual({ offsetMs: 31, boundMs: 1 });
  });

  it('is not misled by reads that a busy moment held up', async () => {
    const c = clocks(48, [
      { out: 400, back: 50 },
      { out: 15, back: 15 },
      { out: 1, back: 300 },
    ]);
    expect(await measureClock(c.read, c.now)).toEqual({ offsetMs: 48, boundMs: 16 });
  });

  it('keeps the truth within the bound it says, however lopsided the trip', async () => {
    const c = clocks(48, [{ out: 28, back: 2 }]);
    const { offsetMs, boundMs } = await measureClock(c.read, c.now);
    expect(Math.abs(offsetMs - 48)).toBeLessThanOrEqual(boundMs);
    expect(offsetMs).not.toBe(48);
  });

  it('says nothing of a read that fails, and leaves it to the caller', async () => {
    await expect(measureClock(() => Promise.reject(new Error('gone')))).rejects.toThrow('gone');
  });

  it('reads no fewer than it was asked to', async () => {
    let reads = 0;
    await measureClock(async () => (reads++, Date.now()), Date.now, 5);
    expect(reads).toBe(5);
  });
});
