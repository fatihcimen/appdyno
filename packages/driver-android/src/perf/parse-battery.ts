import { num } from './parse-common.js';

/** The platform's way of writing a time (`-1h2m3s4ms`, `+25ms`), in milliseconds and without its sign. */
export function parseDuration(text: string): number {
  const part = (unit: string) => num(new RegExp(`(\\d+)${unit}(?![a-z])`), text) ?? 0;
  return (
    part('d') * 86_400_000 +
    part('h') * 3_600_000 +
    part('m') * 60_000 +
    part('s') * 1_000 +
    part('ms')
  );
}

export type HeldLock = {
  tag: string;
  acquiredMsAgo: number;
  /** Play does not count this one: what the system holds for the app's audio or location. */
  exempt?: 'audio' | 'location';
};

/**
 * The partial wake locks `dumpsys power` lists as held for this uid, by the app or by the system on its behalf:
 * `PARTIAL_WAKE_LOCK 'tag' ACQ=-1s682ms (uid=10469 pid=30953 ws=WorkSource{10469})`.
 */
export function parseWakeLocks(text: string, uid: number): HeldLock[] {
  return [...text.matchAll(/^\s*PARTIAL_WAKE_LOCK\s+'(.*)'.*? ACQ=(\S+) \((.*)\)\s*$/gm)].flatMap(
    ([, tag, acquired, owner]) => {
      const own = new RegExp(`\\buid=${uid}\\b`).test(owner!);
      const onBehalf = new RegExp(`\\bws=\\S*\\b${uid}\\b`).test(owner!);
      if (!own && !onBehalf) return [];
      const exempt =
        own || !/audio|gnss|location/i.test(tag!)
          ? undefined
          : /audio/i.test(tag!)
            ? ('audio' as const)
            : ('location' as const);
      return [{ tag: tag!, acquiredMsAgo: parseDuration(acquired!), ...(exempt && { exempt }) }];
    },
  );
}

export type AlarmStats = {
  wakeups: number;
  alarms: number;
  tags: Record<string, { wakeups: number; alarms: number }>;
};

/**
 * A package's rows under `Alarm Stats:` of `dumpsys alarm`, counts since the system started:
 * `u0a469:pkg +25ms running, 6 wakeups:`, then `+25ms 6 wakes 6 alarms, last -7s:` with its tag on the next line.
 */
export function parseAlarmStats(text: string, pkg: string): AlarmStats {
  const out: AlarmStats = { wakeups: 0, alarms: 0, tags: {} };
  const lines = text.split('\n');
  const at = lines.findIndex((l) =>
    new RegExp(`^\\s*\\S*:${pkg.replace(/\./g, '\\.')} \\+`).test(l),
  );
  if (at < 0) return out;
  for (let i = at + 1; i < lines.length; i++) {
    const row = /^\s*\+\S+ (\d+) wakes (\d+) alarms/.exec(lines[i]!);
    if (!row) {
      // the rows of the next package, or the end of the table
      if (!/^\s{6,}\S/.test(lines[i]!)) break;
      continue;
    }
    const [wakeups, alarms] = [Number(row[1]), Number(row[2])];
    const tag = lines[i + 1]?.trim() || 'unknown';
    out.wakeups += wakeups;
    out.alarms += alarms;
    const held = out.tags[tag] ?? { wakeups: 0, alarms: 0 };
    out.tags[tag] = { wakeups: held.wakeups + wakeups, alarms: held.alarms + alarms };
  }
  return out;
}

/** How many of this package's jobs began within `windowMs` of now, from `Job history:` of `dumpsys jobscheduler`. */
export function parseJobStarts(text: string, pkg: string, windowMs: number): number {
  return [...text.matchAll(/^\s*(-\S+)\s+START: #\S+ (\S+)/gm)].filter(
    ([, ago, job]) => job!.startsWith(`${pkg}/`) && parseDuration(ago!) <= windowMs,
  ).length;
}
