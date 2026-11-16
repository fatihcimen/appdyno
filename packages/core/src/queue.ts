import { DeviceError } from '@appdyno/protocol';

/**
 * How long a command waits its turn: longer than the longest thing a first call waits behind, an iOS runner's start
 * with another host's before it (270 s), and no longer than a caller would still be there for.
 */
export const QUEUE_WAIT_MS = 300_000;

/**
 * Commands on one device never overlap: each starts after every earlier one has settled (resolved or
 * failed). The command's own timeout starts when it starts, never while it waits. Its wait has a limit of its own: one
 * whose turn has not come by then is refused, with nothing of it done, and does nothing when its turn does come.
 */
export class DeviceQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;

  /** A command runs or waits: one given now waits for it. */
  get busy() {
    return this.queued > 0;
  }

  run<T>(fn: () => Promise<T>, waitMs = QUEUE_WAIT_MS): Promise<T> {
    this.queued++;
    let gaveUp = false;
    let timer: NodeJS.Timeout | undefined;
    const tooLong = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        gaveUp = true;
        reject(waitedTooLong(waitMs));
      }, waitMs);
    });
    const turn = this.tail.then(() => {
      clearTimeout(timer);
      // refused already: its place in the line is kept to its end, and nothing runs in it
      return gaveUp ? (undefined as T) : fn();
    });
    const settled = () => {
      this.queued--;
    };
    this.tail = turn.then(settled, settled);
    return Promise.race([turn, tooLong]);
  }
}

function waitedTooLong(waitMs: number) {
  const e = new DeviceError(
    'TIMEOUT',
    `waited ${Math.round(waitMs / 1000)} s for its turn behind an earlier command on this device, which has not ended`,
    'nothing of this call was sent; the earlier one may be starting the agent or be stuck: read the screen, then retry',
  );
  e.unsent = true;
  return e;
}
