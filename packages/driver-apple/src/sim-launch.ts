import { run, tracesDir, type ProfileEntry } from '@appdyno/core';
import type { Simctl } from './simctl.js';
import { parseTimeProfile } from './trace-parse.js';
import { recordTrace, traceTable } from './trace.js';

const START_SECONDS = 4;
const BUSIEST = 5;

/**
 * A start profiled from its first instruction: the process waits as a debugger would be awaited, the Time Profiler
 * attaches, and a signal lets it go. The app's own functions, by the samples they are in.
 */
export async function profileStart(
  udid: string,
  simctl: Simctl,
  bundle: string,
  env: Record<string, string> = {},
): Promise<ProfileEntry[]> {
  await simctl.terminate(udid, bundle);
  const out = await simctl.launch(udid, bundle, env, true);
  const pid = Number(/:\s*(\d+)/.exec(out)?.[1]);
  const trace = await recordTrace({
    template: 'Time Profiler',
    device: udid,
    attach: async () => pid,
    attachedOnly: true,
    seconds: START_SECONDS,
    dir: tracesDir(),
    during: () => run('kill', ['-CONT', String(pid)]),
  });
  return parseTimeProfile(await traceTable(trace, 'time-profile'), pid).appTop.slice(0, BUSIEST);
}
