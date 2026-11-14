import { cpus, loadavg } from 'node:os';
import { run } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { xcodeEnv } from './simctl.js';

/** Reads of a trace before what the tool says of it is the answer. */
const READS = 3;

/**
 * `xctrace export`, read again if the tool dies by itself: Xcode 27.1's aborts now and then as it loads a trace, in
 * a sort on a queue of its own that meets a freed object, and the next read of that file works.
 */
export async function exporting(args: string[], limits: { maxBuffer: number; timeout: number }) {
  for (let read = 1; ; read++) {
    try {
      return await run('xcrun', ['xctrace', 'export', ...args], { env: xcodeEnv(), ...limits });
    } catch (e) {
      // `killed` is a read that ran out of time: another would too
      const { signal, killed } = e as { signal?: string; killed?: boolean };
      if (!signal || killed || read === READS) throw e;
    }
  }
}

/** A load past this on each core is a loaded Mac, as perf's `high-host-load` goes by. */
const LOADED_PER_CORE = 0.8;

/** What to do after the trace tool failed on its own: wait for a quieter Mac only where its load is high. */
export function againHint(load = loadavg()[0] ?? 0, cores = cpus().length) {
  return load > cores * LOADED_PER_CORE
    ? `nothing is wrong with the device: measure again when this Mac is quieter, at load ${Math.round(load)} on ${cores} cores`
    : 'nothing is wrong with the device: measure again';
}

/** The recordings the tool did not end by itself, by their trace: what a read of one that fails says. */
const late = new Map<string, string>();

export const stoppedLate = (tracePath: string, said: string) => late.set(tracePath, said);

const exported = async (tracePath: string, xpath: string) =>
  (
    await exporting(['--input', tracePath, '--xpath', xpath], {
      maxBuffer: 256 * 1024 * 1024,
      timeout: 300_000,
    }).catch((e: unknown) => {
      // says nothing of what the device can do: a recording cut short reads so
      const { stderr, message } = e as { stderr?: string; message: string };
      const said = (stderr ?? message).trim().split('\n').slice(0, 2).join(' ');
      const stopped = late.get(tracePath);
      throw new DeviceError(
        'TIMEOUT',
        stopped
          ? `the trace tool ${stopped}, and cannot read what it left: ${said}`
          : `the trace tool cannot read its own trace: ${said}`,
        againHint(),
      );
    })
  ).stdout;

/** One table of a trace, as XML. */
export const traceTable = (tracePath: string, schema: string) =>
  exported(tracePath, `/trace-toc/run[@number="1"]/data/table[@schema="${schema}"]`);

/** What an instrument keeps under its track and not as a table (Leaks, Allocations), as XML. */
export const traceDetail = (tracePath: string, track: string, detail: string) =>
  exported(
    tracePath,
    `/trace-toc/run[@number="1"]/tracks/track[@name="${track}"]/details/detail[@name="${detail}"]`,
  );
