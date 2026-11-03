import { randomBytes } from 'node:crypto';
import { type Measured, pause, type ThreadReading, type CpuProfile } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg } from '../adb.js';
import { parseProcStatTicks, parseThreadReads, parseSimpleperfReport } from '../perf-parse.js';
import { type PerfDevice, pidOf, sh, at } from './shared.js';

export type CpuStats = {
  percent: number;
  windowMs: number;
  ticks: number;
  clockTicksPerSec: number;
};

/** The app's CPU over `windowMs`: its CPU time before and after, as % of one core. */
export async function cpu(
  d: PerfDevice,
  pkg: string,
  windowMs = 2_000,
): Promise<Measured<CpuStats>> {
  const pid = await pidOf(d, pkg);
  const read = () => sh(d, `cat /proc/${pid}/stat; getconf CLK_TCK`);
  const a = await read();
  const t0 = Date.now();
  await pause(windowMs);
  const b = await read();
  const ms = Date.now() - t0;
  const hz = Number(b.trim().split('\n').pop()) || 100;
  const ticks = parseProcStatTicks(b.split('\n')[0]!) - parseProcStatTicks(a.split('\n')[0]!);
  const percent = Math.round(((ticks / hz) * 1000 * 1000) / ms) / 10;
  return {
    value: { percent, windowMs: ms, ticks, clockTicksPerSec: hz },
    raw: `${a}\n---\n${b}`,
    at: at(),
  };
}

/**
 * Each thread's CPU over the window, read every 500 ms by one shell loop on the device (so adb's own
 * delays do not move the reads). `over90Ms`: how long a thread stayed above 90 percent of a core.
 */
export async function threads(
  d: PerfDevice,
  pkg: string,
  windowMs: number,
): Promise<Measured<ThreadReading>> {
  const pid = await pidOf(d, pkg);
  const reads = Math.max(Math.round(windowMs / 500), 1) + 1;
  const raw = await d.shellAlongside(
    `echo hz $(getconf CLK_TCK); i=0; while [ $i -lt ${reads} ]; do ` +
      `echo "== $(date +%s%N)"; cat /proc/${pid}/task/*/stat 2>/dev/null; ` +
      `i=$((i+1)); [ $i -lt ${reads} ] && sleep 0.5; done`,
    windowMs + 30_000,
  );
  return { value: parseThreadReads(raw), raw, at: at() };
}

/**
 * Where the app's CPU time goes: `simpleperf` samples its threads for `durationMs` (the app must be
 * debuggable or profileable) and reports the functions by their share of the samples.
 */
export async function cpuProfile(
  d: PerfDevice,
  pkg: string,
  durationMs = 3_000,
  during?: () => Promise<unknown>,
): Promise<Measured<CpuProfile>> {
  await d.readyToMeasure();
  assertPkg(pkg);
  await pidOf(d, pkg);
  const s = Math.min(Math.max(Math.round(durationMs / 1000), 1), 30);
  const file = `/data/local/tmp/appdyno-${randomBytes(4).toString('hex')}.data`;
  try {
    const rec = d.shellAlongside(
      // the CPU clock (time-based sampling) works on every device; emulators have no cycle counter
      `LC_ALL=C simpleperf record --app ${pkg} -e cpu-clock -f 1000 --duration ${s} -o ${file} 2>&1`,
      (s + 30) * 1000,
    );
    if (during) await during();
    const recorded = await rec;
    if (/ E |error|fail|not supported/i.test(recorded) && !/Samples recorded/i.test(recorded))
      throw new DeviceError(
        'UNSUPPORTED',
        `simpleperf could not record ${pkg}: ${recorded.trim().slice(0, 300)}`,
      );
    const report = await sh(
      d,
      `simpleperf report -i ${file} --sort symbol -n --percent-limit 0.3 2>&1`,
      60_000,
    );
    const total = Number(/^Samples:\s*(\d+)/m.exec(report)?.[1] ?? 0);
    return {
      value: { durationMs: s * 1000, samples: total, top: parseSimpleperfReport(report) },
      raw: `${recorded}\n---\n${report}`,
      at: at(),
    };
  } finally {
    await d.shell(`rm -f ${file}`).catch(() => undefined);
  }
}
