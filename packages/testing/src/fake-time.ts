import { vi } from 'vitest';

/**
 * What `work` comes to, with vitest's fake timers run on until it settles: a poll's gap, a settle's wait and a
 * deadline are the code's own, and take no real time. On the real clock it is `work` itself. A child process or a
 * socket takes its own time, so a test of one keeps the real clock.
 */
export async function onFakeTime<T>(work: Promise<T>, stepMs = 20): Promise<T> {
  if (!vi.isFakeTimers()) return work;
  let done = false as boolean;
  const out = work.finally(() => {
    done = true;
  });
  // its refusal is the caller's, once the clock has run to it
  out.catch(() => undefined);
  while (!done) await vi.advanceTimersByTimeAsync(stepMs);
  return out;
}

/** A test's body run on fake time from its start, as `onFakeTime` runs one call: `it('…', fakeTimed(async () => {…}))`. */
export const fakeTimed = (body: () => Promise<unknown>) => async () => {
  vi.useFakeTimers();
  try {
    await onFakeTime(body());
  } finally {
    vi.useRealTimers();
  }
};
