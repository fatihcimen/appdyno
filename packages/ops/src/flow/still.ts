import { pause } from '@appdyno/core';
import type { Session } from '../session.js';

/**
 * How long the screen must look the same before a `screenshot` or `visual` step takes it: an iOS simulator's
 * cross-fade into dark mode was still on the first picture after the setting step, 0.6 s on.
 */
const STILL_PICTURE_MS = 500;
/** A screen that never holds still, a ticker or a spinner, is taken at this: its masks decide. */
const STILL_PICTURE_CAP_MS = 5_000;
const GAP_MS = 100;
/** A look small and cheap enough to take several times a second. */
export const LOOK = { format: 'jpeg', quality: 50, maxPx: 256 } as const;

/** Waits until two small pictures `STILL_PICTURE_MS` apart, and all between them, are the same. */
export async function looksStill(s: Session) {
  const end = Date.now() + STILL_PICTURE_CAP_MS;
  let last: Buffer | undefined;
  let since = Date.now();
  for (;;) {
    const { data } = await s.device.screenshot(LOOK);
    if (!last?.equals(data)) {
      last = data;
      since = Date.now();
    } else if (Date.now() - since >= STILL_PICTURE_MS) return;
    if (Date.now() >= end) return;
    await pause(GAP_MS);
  }
}
