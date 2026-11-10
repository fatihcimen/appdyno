import { basename } from 'node:path';
import { endPid, run } from '@appdyno/core';

/**
 * What Xcode's tools start and do not end with them: the trace tool and the runner's xcodebuild each start one, which
 * launchd holds after the tool ends, minutes after an end and days after a kill.
 */
export const HUB = 'DTServiceHub';

/** How long one left behind is given to go after SIGTERM: the runner's xcodebuild's takes no signal but a kill. */
const TERM_MS = 1_000;

/** The children of a running process by their name. */
export async function childrenNamed(pid: number, name: string): Promise<number[]> {
  const { stdout } = await run('pgrep', ['-P', String(pid), '-x', name]).catch(() => ({
    stdout: '',
  }));
  return stdout.split('\n').filter(Boolean).map(Number);
}

/** Whether a process is one launchd now holds that still runs `name`, and so no process another took the pid for. */
async function leftBehind(pid: number, name: string) {
  const { stdout } = await run('ps', ['-o', 'ppid=,comm=', '-p', String(pid)]).catch(() => ({
    stdout: '',
  }));
  const [, ppid, command] = /^\s*(\d+)\s+(.*)$/.exec(stdout.trim()) ?? [];
  return ppid === '1' && !!command && basename(command) === name;
}

/** Ends what a process left behind of its children, by their pids: SIGTERM, then SIGKILL for one that stays. */
export async function endLeftBehind(pids: Iterable<number>, name: string) {
  for (const pid of pids) {
    // looked at before each: a pid gone meanwhile may be another's by the kill
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      if (!(await leftBehind(pid, name))) break;
      await endPid(pid, { signals: [signal], graceMs: TERM_MS, pollMs: 50 });
    }
  }
}
