import type { PerfRecord } from './record.js';

/**
 * Android vitals' definitions (links in docs/perf.md). Play's thresholds are shares of users or sessions over 28 days,
 * which a local run cannot have: it can only say that this session would count, and never a rate.
 */

/** A session counts as slow above this share of frames over 16 ms. */
export const SLOW_SESSION_PERCENT = 50;
/** A session counts as frozen above this share of frames over 700 ms. */
export const FROZEN_SESSION_PERCENT = 0.1;
/** Fewer frames than this say nothing of a share that small: one frame in 500 is already over it. */
export const FROZEN_MIN_FRAMES = 1_000;

/** A start counts as slow from this long, by the day's longest of each state. */
export const SLOW_LAUNCH_MS = { cold: 5_000, warm: 2_000, hot: 1_500 } as const;
/** Play's two pages differ on a hot start, and its help page is out of date elsewhere too. */
const HOT_NOTE = "Play's developer page says 1.5 s, its help page 1 s";

/** Partial wake locks add up to 2 h in 24 h: Play's rule by the day, as a share of whatever a local window is. */
const EXCESSIVE_LOCK_PERCENT = Math.round((2 / 24) * 10_000) / 100;
const STUCK_LOCK_MS = 3_600_000;
const EXCESSIVE_WAKEUPS_PER_HOUR = 10;

type Rule = {
  limit: number;
  /** Counts from the limit itself, and not only above it. */
  from?: boolean;
  name: string;
  reads: (value: number, rule: Rule) => string;
  note?: string;
};

const share =
  (over: string) =>
  (value: number, { limit }: Rule) =>
    `${value} % of frames over ${over}, the limit ${limit} %`;

const launch = (state: string) => (value: number, rule: Rule) =>
  `the day's longest ${state} start ${Math.round(value)} ms, the limit ${rule.limit} ms`;

const RULES: Record<string, Rule> = {
  'frames.slow_percent': {
    limit: SLOW_SESSION_PERCENT,
    name: 'slow frames',
    reads: share('16 ms'),
  },
  'frames.frozen_percent': {
    limit: FROZEN_SESSION_PERCENT,
    name: 'frozen frames',
    reads: share('700 ms'),
  },
  'launch.worst_cold_ms': {
    limit: SLOW_LAUNCH_MS.cold,
    from: true,
    name: 'a slow cold start',
    reads: launch('cold'),
  },
  'launch.worst_warm_ms': {
    limit: SLOW_LAUNCH_MS.warm,
    from: true,
    name: 'a slow warm start',
    reads: launch('warm'),
  },
  'launch.worst_hot_ms': {
    limit: SLOW_LAUNCH_MS.hot,
    from: true,
    name: 'a slow hot start',
    reads: launch('hot'),
    note: HOT_NOTE,
  },
  'wakelocks.percent': {
    limit: EXCESSIVE_LOCK_PERCENT,
    name: 'excessive partial wake locks, at this pace',
    reads: (value) => `held ${value} % of the time, the limit 2 h in 24 h`,
  },
  'wakelocks.longest_ms': {
    limit: STUCK_LOCK_MS,
    from: true,
    name: 'a stuck partial wake lock',
    reads: (value) => `one held for ${Math.round(value / 1_000)} s, the limit 1 h`,
  },
  'wakeups.per_hour': {
    limit: EXCESSIVE_WAKEUPS_PER_HOUR,
    name: 'excessive wakeups, at this pace',
    reads: (value, { limit }) => `${value} an hour, the limit ${limit}`,
  },
  'exits.user_anrs': {
    limit: 0,
    name: 'a user-perceived ANR',
    reads: (value) => `${value} of input dispatching timed out`,
  },
};

/** What Play's definition says of one number. */
export type VitalsCall = { kind: string; counts: boolean; says: string };

/** Whether this session would count, for an Android number Play has a definition of. */
export function vitalsCall(
  r: Pick<PerfRecord, 'kind' | 'value'> & { device: Pick<PerfRecord['device'], 'platform'> },
): VitalsCall | undefined {
  const rule = RULES[r.kind];
  if (!rule || r.device.platform !== 'android') return undefined;
  const counts = rule.from ? r.value >= rule.limit : r.value > rule.limit;
  return {
    kind: r.kind,
    counts,
    says: `this session ${counts ? 'would count' : 'would not count'} as ${rule.name}: ${rule.reads(r.value, rule)}${rule.note ? ` (${rule.note})` : ''}`,
  };
}

/** The day a kept time falls in: Play's session runs from midnight, Pacific. */
export const playDay = (at: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(at));
