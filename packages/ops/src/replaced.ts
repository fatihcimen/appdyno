import { agentLeft, isThisProcess, noteInAnswer } from '@appdyno/core';
import type { ServerContext } from './context.js';
import { endSession } from './leftovers.js';
import type { Session } from './session.js';
import { conditions } from './settings.js';

/**
 * The device now behind a session's serial, where it is not the one the session opened on (`was`), as an AVD booted on
 * the port of one that ended. Asked only of a session whose agent is down: another device has no connection to the
 * last one's agent, and a session that has one pays nothing.
 */
export async function anotherDevice(s: Session, was: string | undefined) {
  if (was === undefined || s.device.agentUp) return undefined;
  const now = await s.device.identity?.().catch(() => undefined);
  return now !== undefined && now !== was ? now : undefined;
}

/**
 * What the session of a device that has gone from behind its serial leaves: what ran in this process for it ends, its
 * driver closes, and what it changed on that device is forgotten, as putting it back would change the one there now.
 * Said in the answer of the call that found it.
 */
export async function letGo(ctx: ServerContext, s: Session, was: string, now: string) {
  const serial = s.device.serial;
  await endSession(ctx, s, true).catch(() => undefined);
  s.device.close();
  // its agent went with that device: the next one's is no other in its place
  agentLeft(serial);
  const mine = Object.entries(conditions.read(serial) ?? {}).filter(([, c]) =>
    isThisProcess(c.owner),
  );
  if (mine.length > 0)
    conditions.update(serial, (all = {}) => {
      const others = Object.entries(all).filter(([, c]) => !isThisProcess(c.owner));
      return others.length > 0 ? Object.fromEntries(others) : undefined;
    });
  noteInAnswer(
    `${serial} is another device than the one its session opened on: ${now}, where it was ${was}. A session starts afresh on it${mine.length > 0 ? `, and what the last one changed on the device that was there is not put back on this one: ${mine.map(([name]) => name).join(', ')}` : ''}`,
  );
}
