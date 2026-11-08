import { DeviceError, type ErrorCode } from '@appdyno/protocol';
import type { OpName } from '../src/index.js';

/** A tool as a device with these answers meets it. `refused`: the tool stops with this code, and keeps nothing. */
export type Asked = {
  tool: OpName;
  args?: Record<string, unknown>;
  measures: Record<string, unknown>;
  refused?: ErrorCode;
};

const at = '2026-11-03T00:00:00.000Z';
export const says = (value: unknown) => () => Promise.resolve({ value, raw: 'raw', at });
export const refuses = (code: ErrorCode) => () =>
  Promise.reject(new DeviceError(code, 'this reading is not to be had'));

export const snapshot = (also: string, measure: string, value: unknown): Asked => ({
  tool: 'perf_snapshot',
  args: { also: [also], cpuWindowMs: 500 },
  measures: { [measure]: says(value) },
});

export const plainSnapshot = (measures: Record<string, unknown> = {}, refused?: ErrorCode) => ({
  tool: 'perf_snapshot' as const,
  args: { cpuWindowMs: 500 },
  measures,
  ...(refused && { refused }),
});

const STARTS = [{ totalMs: 590 }, { totalMs: 600 }, { totalMs: 610 }];

export const launch = (args: Record<string, unknown>, over: Record<string, unknown>): Asked => ({
  tool: 'perf_launch',
  args,
  measures: {
    launch: says({ mode: args.mode ?? 'cold', samples: STARTS, medianMs: 600, ...over }),
  },
});
export const NO_TIME = { samples: [{ state: 'COLD' }], medianMs: undefined };

export const profiled = (without: number[], withIt: number[]): Asked => ({
  tool: 'perf_launch',
  args: { baselineProfile: true },
  measures: {
    baselineProfile: says({ present: true, applied: true, without, with: withIt }),
  },
});

const counted = (frames: number, over: Record<string, unknown> = {}) => ({
  frames: says({
    totalFrames: frames,
    jankyFrames: 0,
    jankyPercent: 8,
    frozenFrames: 1,
    fewFrames: false,
    p95Ms: 18,
    ...over,
  }),
});

export const scroll = (frames: number, over?: Record<string, unknown>): Asked => ({
  tool: 'perf_scroll',
  args: { swipes: 1, repeats: 2 },
  measures: counted(frames, over),
});

/** What a read of frames says of Play's two shares. */
export const shares = (frames: number, over16: number, over700: number) =>
  plainSnapshot(counted(frames, { histogram: { frames, over16, over700 } }));

const traced = (value: Record<string, unknown>, args = {}): Asked => ({
  tool: 'perf_trace',
  args,
  measures: { frameTrace: says({ tracePath: '/t', ...value }) },
});

export const timeline = (frames: number, over: Record<string, unknown> = {}) =>
  traced({
    kind: 'timeline',
    frames,
    janky: 0,
    jankyPercent: 0,
    appDeadlineMissed: 0,
    appJankPercent: 8,
    bufferStuffing: 0,
    surfaceFlinger: 0,
    frozen: 1,
    p50Ms: 9,
    p95Ms: 30,
    worstMs: 45,
    stats: { frames, overrunP95Ms: 3, overrunWorstMs: 5, cpuP95Ms: 7 },
    ...over,
  });

export const probe = (frames: number) =>
  traced({
    kind: 'probe',
    frames,
    durationMs: 5_000,
    missed: 6,
    missedPercent: 5,
    frozen: 1,
    p50Ms: 16,
    p95Ms: 33,
    worstMs: 50,
    stalls: { count: 1, worstMs: 120, totalMs: 120 },
    limits: 'the main thread',
  });

export const hitches = (over: Record<string, unknown> = {}) =>
  traced({
    kind: 'hitches',
    frames: 400,
    durationMs: 5_000,
    hitches: 4,
    hitchMs: 200,
    hitchRatio: 40,
    worstMs: 90,
    frozen: 1,
    stalls: { count: 1, worstMs: 300, totalMs: 300 },
    causes: {},
    ...over,
  });

export const noRecording = (code: ErrorCode): Asked => ({
  tool: 'perf_trace',
  measures: { frameTrace: refuses(code) },
  refused: code,
});

export const hangs = (measure: unknown, refused?: ErrorCode): Asked => ({
  tool: 'perf_trace',
  args: { what: 'hangs' },
  measures: { hangs: measure },
  ...(refused && { refused }),
});

export const xct = (metrics: Record<string, number[]>): Asked => ({
  tool: 'perf_trace',
  args: { what: 'xct_launch' },
  measures: { xctMetrics: says({ metrics, resultBundle: '/r' }) },
});

export const heapProfile = (measure: unknown, refused?: ErrorCode): Asked => ({
  tool: 'perf_heap',
  args: { profile: 'java_hprof' },
  measures: { heapProfile: measure },
  ...(refused && { refused }),
});

export const heapDump = (value: unknown): Asked => ({
  tool: 'perf_heap',
  measures: { heap: says(value) },
});

export const SURFACE = {
  layer: 'SurfaceView',
  refreshMs: 16.7,
  frames: 120,
  fps: 60,
  p50Ms: 16,
  p95Ms: 33,
  worstMs: 50,
  slow34Percent: 3,
  slow50Percent: 1,
  drawing: true,
};

export const BATTERY = {
  windowMs: 30_000,
  wakeLocks: [],
  wakeLockMs: 600,
  wakeLockPercent: 2,
  longestLockMs: 700,
  wakeups: 12,
  wakeupsPerHour: 1_440,
  alarms: 12,
  alarmTags: [],
  jobs: 3,
  note: 'read as they happen',
};

export const EXITS = {
  run: { crashes: 1, anrs: 2, userAnrs: 1, total: 3 },
  held: { crashes: 5, total: 9 },
  recent: [],
};

const START = { reason: 'LAUNCHER', startType: 'COLD', wasForceStopped: false };
export const started = (newestIsNew: boolean) => {
  const newest = { ...START, phases: { fork: 76.9 } };
  return { starts: [newest], newest, newestIsNew };
};

export const anon = (bitmapKb?: number) => ({
  kb: 2_000,
  rssAnonKb: 1_500,
  swapKb: 500,
  state: 'foreground',
  processState: 2,
  ramMb: 6_000,
  ...(bitmapKb !== undefined && { bitmapKb }),
});

export const FEW = 10;
export const MANY = 120;

export const NO_FRAMES = { 'no frames were drawn': timeline(0) };
export const FEW_FRAMES = { 'too few frames were drawn': timeline(FEW) };

export const battery = (over: Record<string, unknown> = {}) =>
  snapshot('battery', 'battery', { ...BATTERY, ...over });
export const BATTERY_UNREAD = {
  'the device cannot read it': {
    tool: 'perf_snapshot',
    args: { also: ['battery'], cpuWindowMs: 500 },
    measures: { battery: refuses('UNSUPPORTED') },
  },
} satisfies Record<string, Asked>;

export const exits = (over: Record<string, unknown> = {}) =>
  snapshot('exits', 'exits', { ...EXITS, ...over });
export const NO_EARLIER_RUN = {
  'there is no earlier run to count from': exits({ run: undefined }),
};

export const surface = (over: Record<string, unknown> = {}) =>
  snapshot('surface', 'surfaceFrames', { ...SURFACE, ...over });
export const SURFACE_UNREAD = {
  'no surface holds frames': surface({ frames: 0, drawing: false }),
  'it stopped drawing, so its frames are from before this run': surface({ drawing: false }),
  'too few frames were presented': surface({ frames: FEW }),
};

export const network = (rxBytes: number, txBytes: number) =>
  snapshot('network', 'network', { windowMs: 2_000, rxBytes, txBytes });
export const NETWORK_UNREAD = {
  'a count aged out between the two reads': network(-4_000, 300),
};

export const energy = (reading: Record<string, unknown>) =>
  snapshot('energy', 'energy', { note: 'a model', ...reading });
export const ENERGY_NONE = { 'the device computes none': energy({}) };

export const threads = (over: Record<string, unknown>) =>
  snapshot('threads', 'threads', { windowMs: 2_000, reads: 5, ...over });

export const memoryGone = (tool: Asked): Asked => ({
  ...tool,
  measures: { ...tool.measures, memory: refuses('APP_NOT_RUNNING') },
  refused: 'APP_NOT_RUNNING',
});
