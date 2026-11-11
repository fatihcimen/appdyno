import { heldElsewhere, isThisProcess, must, ownerGone, type Owner } from '@appdyno/core';
import type { ServerContext } from './context.js';
import { dropFlightFolder } from './timeline/flight.js';
import { flowRecordings } from './flow/shared.js';
import { captures, endCapture } from './network.js';
import { endRecording, filming } from './record.js';
import { reportFor } from './report.js';
import { openReports } from './report-state.js';
import type { Session } from './session.js';
import { conditions, restoreConditions, type Whose } from './settings.js';

/** What was put back on a device, and what could not be. */
export type Taken = { restored: string[]; failed: string[] };

/** One kind of what a session may leave on a device. */
type Leftover = {
  name: string;
  /** Kept on disk by device: one that cannot be read is set aside as a session starts. */
  state?: { setAside(serial: string): string | undefined };
  /** What a session's end ends of it: who holds it now, how it ends, and what is said once it has. */
  ends?: {
    held: (s: Session) => { owner?: Owner | undefined } | undefined;
    end: (ctx: ServerContext, s: Session) => Promise<unknown>;
    done: string;
    /** It runs in this process alone and ends with it: ended where the rest is handed off, and never left behind. */
    inProcess?: true;
  };
};

/** All of them, in the order they are put back and said. */
const LEFTOVERS: Leftover[] = [
  // each change goes back by its own owner, once what runs has ended
  { name: 'conditions', state: conditions },
  // what holds a recording of its own goes first: ended by the next line, its page would have no video
  {
    name: 'timeline',
    ends: {
      held: (s) => s.timeline && { owner: s.owner },
      end: (_, s) => must(s.timeline, 'the timeline').finish(),
      done: 'timeline written',
      inProcess: true,
    },
  },
  {
    name: 'flight recorder',
    ends: {
      held: (s) => s.flight && { owner: s.owner },
      end: async (_, s) => {
        await must(s.flight, 'the flight recorder').stop();
        s.keepFlight();
        return true;
      },
      done: 'flight recorder off',
      inProcess: true,
    },
  },
  {
    name: 'recording',
    state: filming,
    ends: {
      held: (s) => filming.read(s.device.serial),
      end: (_, s) => endRecording(s),
      done: 'recording stopped',
    },
  },
  {
    name: 'network',
    state: captures,
    ends: {
      held: (s) => captures.read(s.device.serial),
      end: (_, s) => endCapture(s),
      done: 'network capture stopped',
    },
  },
  {
    name: 'report',
    state: openReports,
    ends: {
      held: (s) => openReports.read(s.device.serial),
      end: (ctx, s) => reportFor(ctx).close(s),
      done: 'report written',
    },
  },
  // stopped by a session's start once its process has gone, not ended: what it holds can still be saved
  { name: 'flow recording', state: flowRecordings },
];

/**
 * Ends what `whose` takes of what runs on the device, then puts its conditions back. `handedOff`: another process puts
 * back what is kept on disk, once this one has gone, and only what this process holds is ended here.
 */
async function takeBack(
  ctx: ServerContext,
  s: Session,
  whose: Whose,
  handedOff = false,
): Promise<Taken> {
  const restored: string[] = [];
  const failed: string[] = [];
  // who holds each, read before any of them ends
  const running = LEFTOVERS.flatMap(({ name, ends }) =>
    ends ? [{ name, ...ends, holder: ends.held(s) }] : [],
  );
  for (const { name, holder, end, done, inProcess } of running) {
    if (!holder || !whose(holder.owner) || (handedOff && !inProcess)) continue;
    await end(ctx, s).then(
      (ended) => ended && restored.push(done),
      (e: unknown) => failed.push(`${name}: ${e instanceof Error ? e.message : String(e)}`),
    );
  }
  const back = handedOff ? { restored: [], failed: [] } : await restoreConditions(s, whose);
  return { restored: [...restored, ...back.restored], failed: [...failed, ...back.failed] };
}

/** A session is over: what it left goes back, or what this process alone holds where the rest is handed off. */
export const endSession = (ctx: ServerContext, s: Session, handedOff = false) =>
  takeBack(ctx, s, isThisProcess, handedOff);

/** Whether this process left on the device what outlives it: a session's start puts that back once it has gone. */
export const leftHere = (s: Session) =>
  Object.values(conditions.read(s.device.serial) ?? {}).some((c) => isThisProcess(c.owner)) ||
  LEFTOVERS.some(({ ends }) => ends && !ends.inProcess && isThisProcess(ends.held(s)?.owner));

/** A session starts: what a process now dead left goes back, and a file that cannot be read is said. */
export async function sweep(ctx: ServerContext, s: Session): Promise<Taken> {
  const serial = s.device.serial;
  const kept = LEFTOVERS.flatMap(({ name, state }) => {
    const at = state?.setAside(serial);
    return at ? [`${name}: unreadable, kept as ${at}`] : [];
  });
  const { restored, failed } = await takeBack(ctx, s, ownerGone);
  // its segments were this Mac's to keep only while a recorder held them
  if (!heldElsewhere(filming.read(serial)?.owner)) dropFlightFolder(serial);
  const flow = flowRecordings.read(serial);
  // stopped, not removed: what it holds can still be saved
  if (flow?.running && ownerGone(flow.owner)) {
    flowRecordings.write(serial, { ...flow, running: false });
    restored.push('flow recording stopped');
  }
  return { restored, failed: [...kept, ...failed] };
}
