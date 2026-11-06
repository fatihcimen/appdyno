import type { StartInfo } from '@appdyno/core';
import { deviceClass, latestRuns } from '@appdyno/perf';
import type { ServerContext } from '../context.js';
import type { Session } from '../session.js';
import { deviceInfo } from './shared.js';

/** How far back a start is looked for, as a run that did not ask for one keeps none. */
const RUNS_BACK = 50;

/**
 * The newest start this device had at the last run of this key to read one. By its serial: a key holds a kind of device,
 * and two phones of a kind would each read the other's as new.
 */
export async function lastStartSeen(ctx: ServerContext, s: Session, app: string, scenario: string) {
  const key = { app, scenario, deviceClass: deviceClass(deviceInfo(s)) };
  const runs = await latestRuns(ctx.measurementsDir, key, RUNS_BACK).catch(() => []);
  return runs.flat().find((r) => r.startedNs !== undefined && r.device.serial === s.device.serial)
    ?.startedNs;
}

/** What a snapshot says of the starts the system keeps. */
export function startLine(v: StartInfo) {
  const { reason, startType, wasForceStopped, phases } = v.newest;
  const counts = new Map<string, number>();
  for (const s of v.starts) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  const reasons = [...counts].map(([r, n]) => `${r} ${n}`).join(', ');
  return [
    `last start: ${startType}, ${reason}${wasForceStopped ? ', after a force stop' : ''}${
      Object.keys(phases).length
        ? `; ${Object.entries(phases)
            .map(([p, ms]) => `${p.replaceAll('_', ' ')} ${ms} ms`)
            .join(', ')}`
        : ''
    }${v.newestIsNew ? '' : '; not known to be since the last run, so it keeps no phase'}`,
    `the ${v.starts.length} starts the system keeps: ${reasons}`,
  ].join('\n');
}
