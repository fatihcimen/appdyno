import type { Platform } from '@appdyno/protocol';
import type { PerfRecord } from './record.js';

/**
 * Android vitals' definitions (links in docs/reference/perf.md). Play's thresholds are shares of users or sessions over 28 days,
 * which a local run cannot have: it can only say that this session would count, and never a rate.
 */

/** A session counts as slow above this share of frames over 16 ms. */
const SLOW_SESSION_PERCENT = 50;
/** A session counts as frozen above this share of frames over 700 ms. */
const FROZEN_SESSION_PERCENT = 0.1;
/** Fewer frames than this say nothing of a share that small: one frame in 500 is already over it. */
export const FROZEN_MIN_FRAMES = 1_000;

/** A game's session counts as slow above this share of frames not presented less than 50 or 34 ms after the last. */
const SLOW_GAME_PERCENT = 25;

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

const gameShare =
  (bar: number) =>
  (value: number, { limit }: Rule) =>
    `${value} % of frames ${bar} ms or more after the last, the limit ${limit} %`;

const launch = (state: string) => (value: number, rule: Rule) =>
  `the day's longest ${state} start ${Math.round(value)} ms, the limit ${rule.limit} ms`;

const RULES: Record<string, Rule> = {
  'surface.slow_50_percent': {
    limit: SLOW_GAME_PERCENT,
    name: 'a slow session at 20 FPS',
    reads: gameShare(50),
  },
  'surface.slow_34_percent': {
    limit: SLOW_GAME_PERCENT,
    name: 'a slow session at 30 FPS',
    reads: gameShare(34),
  },
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

/** RAM in MB to the tier Play's table has it under; below 4 GB and above 16 GB it has none. */
const RAM_TIERS = [
  { from: 3_200, to: 4_800, gb: 4 },
  { from: 4_800, to: 6_800, gb: 6 },
  { from: 6_800, to: 9_216, gb: 8 },
  { from: 9_216, to: 14_336, gb: 12 },
  { from: 14_336, to: 18_432, gb: 16 },
];

export const ramTier = (ramMb: number) =>
  RAM_TIERS.find((t) => ramMb >= t.from && ramMb < t.to)?.gb;

/** Anon RSS and swap in GB, apps, by tier and state; a cached process has no limit. A game's are higher. */
const ANON_SWAP_GB: Record<number, Record<string, number>> = {
  4: { foreground: 2, service: 1, background: 1 },
  6: { foreground: 2.25, service: 1.25, background: 1.25 },
  8: { foreground: 2.25, service: 1.5, background: 1.5 },
  12: { foreground: 3.25, service: 1.75, background: 1.75 },
  16: { foreground: 4.25, service: 2, background: 2 },
};

/** Bitmaps in MB by state; a process in the foreground has no limit. */
const BITMAP_MB: Record<string, number> = { service: 200, background: 200, cached: 400 };

const MEMORY_NOTE = 'Play judges the P90 of its fleet from February 2027, a device is one reading';
const mb = (kb: number) => Math.round(kb / 1024);

/** A kind with its state, and its tier, in its name: what the limit depends on stays with the number. */
function memoryRule(kind: string): Rule | undefined {
  const [, held = '', gb = ''] = /^memory\.anon_swap\.(\w+)\.(\d+)gb_kb$/.exec(kind) ?? [];
  const limit = held && ANON_SWAP_GB[Number(gb)]?.[held];
  if (limit)
    return {
      limit: limit * 1024 * 1024,
      name: 'over the memory limit',
      reads: (value) =>
        `anon RSS and swap ${mb(value)} MB in ${held}, the limit ${limit} GB with ${gb} GB of RAM`,
      note: MEMORY_NOTE,
    };
  const state = /^memory\.bitmap\.(\w+)_kb$/.exec(kind)?.[1];
  const bitmaps = state && BITMAP_MB[state];
  if (bitmaps)
    return {
      limit: bitmaps * 1024,
      name: 'over the bitmap limit',
      reads: (value) => `bitmaps ${mb(value)} MB in ${state}, the limit ${bitmaps} MB`,
      note: MEMORY_NOTE,
    };
  return undefined;
}

/** Play's definitions are of Android's numbers. */
export const ratedByPlay = (platform: Platform) => platform === 'android';

/** What Play's definition says of one number. */
export type VitalsCall = { kind: string; counts: boolean; says: string };

/** Whether this session would count, for an Android number Play has a definition of. */
export function vitalsCall(
  r: Pick<PerfRecord, 'kind' | 'value'> & { device: Pick<PerfRecord['device'], 'platform'> },
): VitalsCall | undefined {
  const rule = Object.hasOwn(RULES, r.kind) ? RULES[r.kind] : memoryRule(r.kind);
  if (!rule || !ratedByPlay(r.device.platform)) return undefined;
  const counts = rule.from ? r.value >= rule.limit : r.value > rule.limit;
  return {
    kind: r.kind,
    counts,
    says: `this session ${counts ? 'would count' : 'would not count'} as ${rule.name}: ${rule.reads(r.value, rule)}${rule.note ? ` (${rule.note})` : ''}`,
  };
}

/** What Play says of a number just read, wherever that was. */
export const playCall = (kind: string, value: number) =>
  vitalsCall({ kind, value, device: { platform: 'android' } });

/** The day a kept time falls in: Play's session runs from midnight, Pacific. */
export const playDay = (at: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(at));
