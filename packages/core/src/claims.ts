import { DeviceError } from '@appdyno/protocol';
import { reportProgress, sleep } from './call.js';
import { isThisProcess, Owner, ownerIn, thisOwner } from './owner.js';
import { deviceState, deviceStateFile } from './state.js';

const claims = deviceState('claims', Owner);

/** What holds a device while it puts back what a server that has gone left there: a hold a new session waits out. */
export const PUT_BACK_TOOL = 'appdyno put-back';

/** How long a session waits for that put-back: twice the 20 s a server's own end may take to put things back. */
const PUT_BACK_MS = 40_000;

/** How a server's or a command line's caller shares a device another process holds. */
const SHARE_BY_SERVER = 'use_device with share: true, --share on the command line';

/** The same for a program that calls the library. */
export const SHARE_BY_LIBRARY = 'share: true in the options';

/** The live process that holds the device, if any: a dead owner's claim is no claim. */
export const holder = (serial: string) => ownerIn(deviceStateFile('claims', serial));

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
        `${serial} is held by pid ${h.pid} (${h.tool}) since ${h.since}`,
        `use another device${share ? `, or share this one: ${share}` : ''}`,
      );
    return thisOwner(tool);
  });
}

export function release(serial: string) {
  claims.update(serial, (now) => (isThisProcess(now) ? undefined : now));
}
