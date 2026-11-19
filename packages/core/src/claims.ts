import { DeviceError } from '@appdyno/protocol';
import { reportProgress, sleep } from './call.js';
import { ago } from './clock.js';
import { isAlive, isThisProcess, Owner, thisOwner } from './owner.js';
import { z } from 'zod';
import { deviceState } from './state.js';

/**
 * A process's hold on a device. `lastCall`: when it last made a call on it, kept at most once a minute, so that a person
 * tells a holder in use from one whose client was left open for days. A holder before 1.3.3 kept none.
 */
const Claim = Owner.extend({ lastCall: z.string().optional() });
type Claim = z.infer<typeof Claim>;

const claims = deviceState('claims', Claim);

/** How often a holder's calls are written down: a refusal says how long ago in minutes at the finest. */
const CALLS_KEPT_MS = 60_000;

/** When this process last wrote a call down, by device: a claim taken anew has none. */
const called = new Map<string, number>();

/** What puts back what a server that has gone left on a device: a hold a new session waits out. */
export const PUT_BACK_TOOL = 'appdyno put-back';

/** How long a session waits for that put-back: twice the 20 s a server's own end may take to put things back. */
const PUT_BACK_MS = 40_000;

/** How a server's or a command line's caller shares a device another process holds. */
const SHARE_BY_SERVER = 'use_device with share: true, --share on the command line';

/** The same for a program that calls the library. */
export const SHARE_BY_LIBRARY = 'share: true in the options';

/** The live process that holds the device, if any: a dead owner's claim is no claim. */
export function holder(serial: string): Claim | undefined {
  const h = claims.read(serial);
  return h && isAlive(h) ? h : undefined;
}

/** Who holds a device, as a refusal says it: since when, and its last call where it keeps one. */
export const heldText = (name: string, h: Claim, now = Date.now()) =>
  `${name} is held by pid ${h.pid} (${h.tool}) since ${h.since}${h.lastCall ? `, its last call ${ago(h.lastCall, now)}` : ''}`;

/**
 * This process takes the device for its session, or is refused with who holds it. A put-back's hold is waited out, up
 * to `waitMs`: a client that starts a server as soon as its last one ended would find its first call refused. `share` is
 * how this caller shares a held device, for the refusal to name: a library's option is not a server's tool.
 */
export async function claim(
  serial: string,
  tool: string,
  share: string | undefined = SHARE_BY_SERVER,
  waitMs = PUT_BACK_MS,
) {
  const end = Date.now() + waitMs;
  const puttingBack = () => {
    const h = holder(serial);
    return h?.tool === PUT_BACK_TOOL && h.pid !== process.pid;
  };
  if (puttingBack())
    reportProgress(`waiting while what the last session left on ${serial} goes back`);
  while (puttingBack() && Date.now() < end) await sleep(100);
  claims.update(serial, () => {
    const h = holder(serial);
    if (h && h.pid !== process.pid)
      throw new DeviceError(
        'DEVICE_CLAIMED',
        heldText(serial, h),
        `use another device${share ? `, or share this one: ${share}` : ''}`,
      );
    called.delete(serial);
    return thisOwner(tool);
  });
}

/**
 * This process made a call on a device it holds: written down, at most once a minute. A holder that never says so, as a
 * program that calls the library, keeps no last call, as a holder before 1.3.3 kept none.
 */
export function calledOn(serial: string, now = Date.now()) {
  if (now - (called.get(serial) ?? 0) < CALLS_KEPT_MS) return;
  called.set(serial, now);
  // a process that shares the device writes nothing on its holder's claim
  if (!isThisProcess(claims.read(serial))) return;
  claims.update(serial, (h) =>
    h && isThisProcess(h) ? { ...h, lastCall: new Date(now).toISOString() } : h,
  );
}

export function release(serial: string) {
  called.delete(serial);
  claims.update(serial, (now) => (isThisProcess(now) ? undefined : now));
}
