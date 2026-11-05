/** A device's clock against this Mac's, as read: no two clocks here are the same by assumption, an emulator's neither. */
export type ClockReading = {
  /** The device's clock minus the Mac's, in ms: add it to a time on the Mac to have it on the device's. */
  offsetMs: number;
  /** The read happened somewhere inside its round trip, so the truth is at most this far from `offsetMs`. */
  boundMs: number;
};

/** A read on a busy machine can be hundreds of ms out: it takes a few for one that went straight through. */
const READS = 8;

/** `Date.now()` moves a ms at a time: a trip inside one tick reads as none, and would claim to be exact. */
const TICK_MS = 1;

const tenth = (ms: number) => Math.round(ms * 10) / 10;

/**
 * Brackets `read` with this Mac's clock and keeps the read with the shortest round trip. Eight reads of an emulator
 * gave offsets from 47 to 254 ms for one that was 30 to 48. Intersecting every bracket gave no tighter a bound, as the
 * way there and back keeps its own shape, so the shortest one is all there is to it.
 */
export async function measureClock(
  read: () => Promise<number>,
  now: () => number = Date.now,
  reads = READS,
): Promise<ClockReading> {
  let best: ClockReading | undefined;
  for (let i = 0; i < reads; i++) {
    const before = now();
    const device = await read();
    const after = now();
    const boundMs = (after - before) / 2;
    if (!best || boundMs < best.boundMs) best = { offsetMs: device - (before + boundMs), boundMs };
  }
  return { offsetMs: tenth(best!.offsetMs), boundMs: tenth(best!.boundMs + TICK_MS) };
}
