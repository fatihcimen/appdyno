import { heldElsewhere, isThisProcess, must, ownerGone } from '@appdyno/core';
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

/** Ends what `whose` takes of what runs on the device, then puts its conditions back. */
async function takeBack(ctx: ServerContext, s: Session, whose: Whose): Promise<Taken> {
  const serial = s.device.serial;
  const restored: string[] = [];
  const failed: string[] = [];
  // what holds a recording of its own goes first: ended by the next line, its page would have no video
  const running = [
    {
      name: 'timeline',
      held: s.timeline && { owner: s.owner },
      end: () => must(s.timeline, 'the timeline').finish(),
      done: 'timeline written',
    },
    {
      name: 'flight recorder',
      held: s.flight && { owner: s.owner },
      end: async () => {
        await must(s.flight, 'the flight recorder').stop();
        s.flight = undefined;
        return true;
      },
      done: 'flight recorder off',
    },
    {
      name: 'recording',
      held: filming.read(serial),
      end: () => endRecording(s),
      done: 'recording stopped',
    },
    {
      name: 'network',
      held: captures.read(serial),
      end: () => endCapture(s),
      done: 'network capture stopped',
    },
    {
      name: 'report',
      held: openReports.read(serial),
      end: () => reportFor(ctx).close(s),
      done: 'report written',
    },
  ];
  for (const { name, held, end, done } of running) {
    if (!held || !whose(held.owner)) continue;
    await end().then(
      (ended) => ended && restored.push(done),
      (e: unknown) => failed.push(`${name}: ${e instanceof Error ? e.message : String(e)}`),
    );
  }
  const back = await restoreConditions(s, whose);
  return { restored: [...restored, ...back.restored], failed: [...failed, ...back.failed] };
}

/** A session is over: what it left goes back. */
export const endSession = (ctx: ServerContext, s: Session) => takeBack(ctx, s, isThisProcess);

/** A session starts: what a process now dead left goes back, and a file that cannot be read is said. */
export async function sweep(ctx: ServerContext, s: Session): Promise<Taken> {
  const serial = s.device.serial;
  const kept = [
    { name: 'conditions', state: conditions },
    { name: 'recording', state: filming },
    { name: 'network', state: captures },
    { name: 'report', state: openReports },
    { name: 'flow recording', state: flowRecordings },
  ].flatMap(({ name, state }) => {
    const at = state.setAside(serial);
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
