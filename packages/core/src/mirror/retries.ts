/** A viewer that goes on dying is not started a third time. */
const DEATHS_WINDOW_MS = 60_000;
const MAX_DEATHS = 2;
/** Failures to open on a device that says it is there, before the session gives up. */
const MAX_ATTEMPTS = 10;
const BACKOFF_FIRST_MS = 200;
const BACKOFF_MAX_MS = 5_000;

/** How a mirror tries again: an open backs off up to a number of tries, and a viewer that goes on dying is let go. */
export class MirrorRetries {
  /** Tries since the last picture. */
  attempt = 0;
  private deaths: number[] = [];

  /** One more try and the wait before it, or why there is none. */
  next(why: string): { waitMs: number } | { gaveUp: string } {
    this.attempt++;
    if (this.attempt > MAX_ATTEMPTS)
      return { gaveUp: `no picture after ${MAX_ATTEMPTS} tries: ${why}` };
    return { waitMs: Math.min(BACKOFF_FIRST_MS * 2 ** (this.attempt - 1), BACKOFF_MAX_MS) };
  }

  /** The viewer died at `now`: whether it died too often of late to start again. */
  diedTooOften(now: number) {
    this.deaths = [...this.deaths.filter((t) => now - t < DEATHS_WINDOW_MS), now];
    return this.deaths.length >= MAX_DEATHS;
  }
}
