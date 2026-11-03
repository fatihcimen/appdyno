import type { StartupAnalysis } from '@appdyno/core';
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
  return m ? `status=${m[1]} reason=${m[2]}` : undefined;
}

const LIMITS: [name: string, metric: string, ms: number][] = [
  ['bindApplication', 'time_bind_application', 1250],
  ['inflate', 'time_inflate', 450],
  ['getResources', 'time_get_resources', 130],
];

const HOT_LIMIT_MS = 1500;

type StartupMetric = {
  package_name?: string;
  report_fully_drawn?: { dur_ms?: number };
  to_first_frame?: Record<string, { dur_ms?: number } | number | undefined>;
  slow_start_reason?: string[];
};

/**
 * What a startup trace says, from the query in `AndroidPerf` (rows of `k,a,b`: `type`, `display`,
 * `reason`, `odex`) and the `android_startup` metric's JSON. TTFD falls back to the metric: the display
 * table leaves it empty when no frame follows `reportFullyDrawn`.
 */
export function parseStartup(
  csv: string,
  metricJson: string,
  pkg: string,
  tracePath: string,
): StartupAnalysis {
  const { rows } = parseCsv(csv);
  const find = (k: string) => rows.find((r) => r[0] === k);
  const startups = (JSON.parse(metricJson) as { android_startup?: { startup?: StartupMetric[] } })
    .android_startup?.startup;
  const metric = startups?.filter((s) => s.package_name === pkg).at(-1);
  const type = find('type');
  const display = find('display');
  const durNs = cellNum(type?.[2]);
  const ttidNs = cellNum(display?.[1]);
  const ttfdNs = cellNum(display?.[2]);
  const drawnMs = metric?.report_fully_drawn?.dur_ms;
  const ttfdMs = ttfdNs !== undefined ? nsToMs(ttfdNs) : drawnMs && Math.round(drawnMs * 10) / 10;
  const odex = find('odex')?.[1];
  const findings = LIMITS.flatMap(([name, key, limit]) => {
    const part = metric?.to_first_frame?.[key];
    const ms = typeof part === 'object' ? part.dur_ms : undefined;
    return ms !== undefined && ms > limit
      ? [`${name} took ${Math.round(ms)} ms (limit ${limit} ms)`]
      : [];
  });
  if (type?.[1] === 'hot' && durNs !== undefined && durNs / 1e6 > HOT_LIMIT_MS)
    findings.push(`hot launch took ${Math.round(durNs / 1e6)} ms (limit ${HOT_LIMIT_MS} ms)`);
  return {
    tracePath,
    ...(type?.[1] && { startupType: type[1] }),
    ...(durNs !== undefined && { durMs: nsToMs(durNs) }),
    ...(ttidNs !== undefined && { ttidMs: nsToMs(ttidNs) }),
    ...(ttfdMs !== undefined && { ttfdMs }),
    reasons: metric?.slow_start_reason ?? [],
    breakdown: rows
      .filter((r) => r[0] === 'reason')
      .map((r) => ({ reason: r[1]!, ms: nsToMs(cellNum(r[2]) ?? 0) }))
      .sort((a, b) => b.ms - a.ms),
    findings,
    ...(odex && { odex }),
  };
}
