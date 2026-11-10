import {
  deviceState,
  deviceStateFile,
  isThisProcess,
  Owner,
  ownerIn,
  reportProgress,
  sleep,
  thisOwner,
} from '@appdyno/core';
import { ToolError } from './tool.js';

const claims = deviceState('claims', Owner);

/** What holds a device while it puts back what a server that has gone left there: a hold a new session waits out. */
export const PUT_BACK_TOOL = 'appdyno put-back';

/** How long a session waits for that put-back: twice the 20 s a server's own end may take to put things back. */
const PUT_BACK_MS = 40_000;

/** The live process that holds the device, if any: a dead owner's claim is no claim. */
export const holder = (serial: string) => ownerIn(deviceStateFile('claims', serial));

/**
 * This process takes the device for its session, or is refused with who holds it. A put-back's hold is waited out, up
 * to `waitMs`: a client that starts a server as soon as its last one ended would find its first call refused.
 */
export async function claim(serial: string, tool: string, waitMs = PUT_BACK_MS) {
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
      throw new ToolError(
        `${serial} is held by pid ${h.pid} (${h.tool}) since ${h.since}`,
        'DEVICE_CLAIMED',
        'use another device, or share this one: use_device with share: true, --share on the command line',
      );
    return thisOwner(tool);
  });
}

export function release(serial: string) {
  claims.update(serial, (now) => (isThisProcess(now) ? undefined : now));
}
