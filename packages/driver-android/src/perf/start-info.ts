import type { Measured, StartInfo, StartRecord } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg } from '../adb.js';
import { at, sh, type PerfDevice } from './shared.js';

/** `dumpsys activity start-info` came with Android 15. */
const FIRST_SDK = 35;

/**
 * `ApplicationStartInfo`'s timestamps by their index, in the order a start passes them. Index 2 is when `onCreate`
 * began: a known 500 ms inside `Application.onCreate` lands after it, so what follows it holds `onCreate` itself.
 */
const MARKS = [0, 1, 3, 2, 4, 5] as const;
const UP_TO: Record<(typeof MARKS)[number], string> = {
  0: '',
  1: 'fork',
  3: 'bind_application',
  2: 'before_oncreate',
  4: 'oncreate_to_first_frame',
  5: 'fully_drawn',
};

/** The time between the marks this start has: a warm start has few, and no `onCreate` to count from. */
function phasesOf(block: string): Record<string, number> {
  const stamps = new Map(
    [...(/timestamps: (.*)/.exec(block)?.[1] ?? '').matchAll(/(\d+)=(\d+)/g)].map(([, i, ns]) => [
      Number(i),
      Number(ns),
    ]),
  );
  const out: Record<string, number> = {};
  let last: { mark: number; ns: number } | undefined;
  for (const mark of MARKS) {
    const ns = stamps.get(mark);
    if (ns === undefined) continue;
    if (last)
      out[mark === 4 && last.mark !== 2 ? 'first_frame' : UP_TO[mark]] =
        Math.round((ns - last.ns) / 1e5) / 10;
    last = { mark, ns };
  }
  return out;
}

/** The records of a package in `dumpsys activity start-info <pkg>`, newest first as it prints them. */
export function parseStartInfo(text: string): StartRecord[] {
  return text
    .split(/ApplicationStartInfo #\d+:/)
    .slice(1)
    .flatMap((block) => {
      const reason = /\breason=(.+?) startType=/.exec(block)?.[1];
      const startType = /\bstartType=(\S+)/.exec(block)?.[1];
      if (!reason || !startType) return [];
      return [
        {
          reason,
          startType,
          wasForceStopped: /wasForceStopped=true/.test(block),
          phases: phasesOf(block),
        },
      ];
    });
}

/**
 * Why the app started and where the start's time went, as the system kept it, with no trace: on Android 15 and later,
 * for the starts it remembers. A process started for a job or a broadcast shows here, which no launch measure sees.
 */
export async function startInfo(d: PerfDevice, pkg: string): Promise<Measured<StartInfo>> {
  assertPkg(pkg);
  const sdk = Number((await sh(d, 'getprop ro.build.version.sdk')).trim());
  if (sdk < FIRST_SDK)
    throw new DeviceError(
      'UNSUPPORTED',
      `start info needs Android 15 (API ${FIRST_SDK}): this device has API ${sdk}`,
    );
  const raw = await sh(d, `dumpsys activity start-info ${pkg}`, 30_000);
  const starts = parseStartInfo(raw);
  if (starts.length === 0)
    throw new DeviceError(
      'UNSUPPORTED',
      `this device keeps no start info of ${pkg}: its build may not have the feature on`,
    );
  return { value: { starts, newest: starts[0]! }, raw, at: at() };
}
