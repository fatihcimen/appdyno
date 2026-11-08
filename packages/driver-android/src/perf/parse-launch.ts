import { must, type StartupAnalysis } from '@appdyno/core';
import { num, parseCsv, cellNum, nsToMs } from './parse-common.js';

export type LaunchSample = {
  totalMs?: number;
  waitMs?: number;
  state?: string;
  status?: string;
  fullyDrawnMs?: number;
};

/** `am start -W`: TotalTime (the launch as the system saw it), WaitTime (includes am's own cost), LaunchState. */
export function parseAmStart(text: string): LaunchSample {
  const out: LaunchSample = {};
  const total = num(/^TotalTime:\s*(\d+)/m, text);
  const wait = num(/^WaitTime:\s*(\d+)/m, text);
  const state = /^LaunchState:\s*(\w+)/m.exec(text)?.[1];
  const status = /^Status:\s*(\w+)/m.exec(text)?.[1];
  if (total !== undefined) out.totalMs = total;
  if (wait !== undefined) out.waitMs = wait;
  if (state) out.state = state;
  if (status) out.status = status;
  return out;
}

/** The app's last "Fully drawn" line of an `ActivityTaskManager` log: `... .MainActivity: +1s13ms`. */
export function parseFullyDrawn(log: string, pkg: string): number | undefined {
  const line = [...log.matchAll(/Fully drawn (\S+?)\/\S+: \+(?:(\d+)m)?(?:(\d+)s)?(\d+)ms/g)]
    .filter((m) => m[1] === pkg)
    .at(-1);
  if (!line) return undefined;
  return Number(line[2] ?? 0) * 60_000 + Number(line[3] ?? 0) * 1000 + Number(line[4]);
}

/** The compiler state in `dumpsys package dexopt`: `arm64: [status=verify] [reason=cmdline]`. */
export function parseCompileStatus(text: string): string | undefined {
  const m = /status=([\w-]+)\]?\s*\[reason=([\w-]+)/.exec(text);
  return m ? `status=${must(m[1], 'a status')} reason=${must(m[2], 'a reason')}` : undefined;
}

/** A finding's name, the slices summed for it (as the `android_startup` metric's `to_first_frame` did), its limit. */
const LIMITS: [name: string, slice: string, ms: number][] = [
  ['bindApplication', 'bindApplication', 1250],
  ['inflate', 'inflate', 450],
  ['getResources', 'ResourcesManager#getResources', 130],
];

const HOT_LIMIT_MS = 1500;

/** The package's last startup's `slow_start_reason`, from the `android_startup` metric's JSON. */
export function parseSlowStartReasons(metricJson: string, pkg: string): string[] {
  const startups = (
    JSON.parse(metricJson) as {
      android_startup?: { startup?: { package_name?: string; slow_start_reason?: string[] }[] };
    }
  ).android_startup?.startup;
  return startups?.filter((s) => s.package_name === pkg).at(-1)?.slow_start_reason ?? [];
}

/**
 * What a startup trace says, from the query in `AndroidPerf` (rows of `k,a,b`: `type`, `display`,
 * `reason`, `odex`, `slice`, `drawn`) and the platform's reasons. TTFD falls back to the first
 * `reportFullyDrawn`: the display table leaves it empty when no frame follows it.
 */
export function parseStartup(csv: string, reasons: string[], tracePath: string): StartupAnalysis {
  const { rows } = parseCsv(csv);
  const find = (k: string, a?: string) =>
    rows.find((r) => r[0] === k && (a === undefined || r[1] === a));
  const type = find('type');
  const display = find('display');
  const durNs = cellNum(type?.[2]);
  const ttidNs = cellNum(display?.[1]);
  const ttfdNs = cellNum(display?.[2]) ?? cellNum(find('drawn')?.[2]);
  const odex = find('odex')?.[1];
  const findings = LIMITS.flatMap(([name, slice, limit]) => {
    const ns = cellNum(find('slice', slice)?.[2]);
    return ns !== undefined && ns / 1e6 > limit
      ? [`${name} took ${Math.round(ns / 1e6)} ms (limit ${limit} ms)`]
      : [];
  });
  if (type?.[1] === 'hot' && durNs !== undefined && durNs / 1e6 > HOT_LIMIT_MS)
    findings.push(`hot launch took ${Math.round(durNs / 1e6)} ms (limit ${HOT_LIMIT_MS} ms)`);
  return {
    tracePath,
    ...(type?.[1] && { startupType: type[1] }),
    ...(durNs !== undefined && { durMs: nsToMs(durNs) }),
    ...(ttidNs !== undefined && { ttidMs: nsToMs(ttidNs) }),
    ...(ttfdNs !== undefined && { ttfdMs: nsToMs(ttfdNs) }),
    reasons,
    breakdown: rows
      .filter((r) => r[0] === 'reason')
      .map((r) => ({ reason: must(r[1], 'a reason'), ms: nsToMs(cellNum(r[2]) ?? 0) }))
      .sort((a, b) => b.ms - a.ms),
    findings,
    ...(odex && { odex }),
  };
}
