import {
  deviceState,
  deviceStateFile,
  isThisProcess,
  Owner,
  ownerIn,
  thisOwner,
} from '@appdyno/core';
import { ToolError } from './tool.js';

const claims = deviceState('claims', Owner);

/** The live process that holds the device, if any: a dead owner's claim is no claim. */
export const holder = (serial: string) => ownerIn(deviceStateFile('claims', serial));

/** This process takes the device for its session, or is refused with who holds it. */
export function claim(serial: string, tool: string) {
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
