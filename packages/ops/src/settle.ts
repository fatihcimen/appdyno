import { pause, throwIfCancelled } from '@appdyno/core';

/** Reads apart while a screen settles after a launch or a link: a simulator's helper reads in 15-30 ms. */
const SETTLE_POLL_MS = 40;

/**
 * Reads until the screen's layout has held for `quietMs`, at most `maxMs` (after a launch or a link), by an action's
 * settle's rule: a read of another layout starts the window again, other words in the same layout do not, and a read
 * proves the layout still up to when it began. Reads come SETTLE_POLL_MS apart, so a read's own time counts towards
 * the window. Not by the device's `wait`: on a simulator that is the runner's, far slower than its helper's reads.
 */
export async function settleBy<S extends { hash: string }>(
  read: () => Promise<S>,
  quietMs: number,
  maxMs: number,
): Promise<{ screen: S; settled: boolean }> {
  const end = Date.now() + maxMs;
  let screen: S | undefined;
  let changedAt = 0;
  for (;;) {
    throwIfCancelled('settle');
    if (screen) await pause(Math.min(SETTLE_POLL_MS, Math.max(0, end - Date.now())));
    const readAt = Date.now();
    const next = await read();
    if (next.hash !== screen?.hash) changedAt = readAt;
    screen = next;
    if (readAt - changedAt >= quietMs) return { screen, settled: true };
    if (Date.now() >= end) return { screen, settled: false };
  }
}
