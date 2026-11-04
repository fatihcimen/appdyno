import { isThisProcess, ownerGone } from '@appdyno/core';
import { conditions, restoreConditions, type Whose } from './settings.js';
import type { Session } from './session.js';

/** What was put back on a device, and what could not be. */
export type Taken = { restored: string[]; failed: string[] };

const takeBack = async (s: Session, whose: Whose): Promise<Taken> => {
  const { restored, failed } = await restoreConditions(s, whose);
  return { restored, failed };
};

/** A session is over: what it left goes back. */
export const endSession = (s: Session) => takeBack(s, isThisProcess);

/** A session starts: what a process now dead left goes back, and a file that cannot be read is said. */
export async function sweep(s: Session): Promise<Taken> {
  const kept = conditions.setAside(s.device.serial);
  const { restored, failed } = await takeBack(s, ownerGone);
  return {
    restored,
    failed: [...(kept ? [`conditions: unreadable, kept as ${kept}`] : []), ...failed],
  };
}
