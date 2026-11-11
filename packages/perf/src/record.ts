import type { CompileMode } from '@appdyno/core';
import type { Platform } from '@appdyno/protocol';
import { median, spread, type Spread } from './stats.js';

export type Unit = 'ms' | 'percent' | 'kb' | 'bytes' | 'count' | 'mah' | 'mj' | 'ratio';

export type Build = 'debug' | 'profileable' | 'release' | 'unknown';

export type DeviceInfo = {
  serial: string;
  platform: Platform;
  model: string;
  os: string;
  virtual: boolean;
};

/** What makes a number less trustworthy; `BLOCKING` in `compare.ts` says which also keep a change from failing a gate. */
export type Noise =
  | 'high-host-load'
  | 'high-device-load'
  | 'hot-device'
  | 'debuggable-build'
  | 'mirrored'
  | 'device-state-unread';

/** One number of one measurement, with everything needed to judge it later. */
export type PerfRecord = {
  schema: 1;
  id: string;
  /** Run id: the records a call made together. */
  run: string;
  kind: string;
  unit: Unit;
  /** Which way is better. */
  better: 'lower' | 'higher';
  value: number;
  samples: number[];
  spread: Spread;
  app: string;
  scenario: string;
  source: string;
  raw: string;
  device: DeviceInfo;
  deviceClass: string;
  build: Build;
  /** Android's compile state, as a launch asked for it. */
  compile?: CompileMode;
  /** The newest start this run read of the device, as the device stamped it: no start is kept twice. */
  startedNs?: number;
  load: {
    host: number[];
    hostCpus: number;
    device?: number[];
    devicePressure?: number;
    /** What of the device's load is kernel threads asleep, using no CPU. */
    deviceParked?: number;
    /** The share of all its cores at work as the run ended. */
    deviceBusy?: number;
    /** A mirror's encoder ran on the device beside what was measured. */
    mirrored?: boolean;
  };
  thermal?: number;
  batteryTempC?: number;
  tool: string;
  at: string;
  noise: Noise[];
  /** An estimate from a model, not a reading of the thing itself; always shown as one. */
  modelled?: boolean;
  /** Timed on this Mac and not on the device; always shown as such. */
  throughHost?: boolean;
};

/** The rows of the performance table, in its order: what a device can be asked, and what the page calls it. */
export const MEASURE_TITLE = {
  launch: 'Launch',
  'launch-why': 'Why launch was slow',
  frames: 'Frames',
  frozen: 'Frozen frames',
  stalls: 'Main-thread stalls',
  memory: 'Memory',
  leaks: 'Leaks',
  cpu: 'CPU',
  network: 'Network bytes',
  energy: 'Energy',
  battery: 'Battery signals',
  crashes: 'Crashes, ANRs',
  size: 'App size',
  journey: 'Journeys',
} as const;
export type MeasureId = keyof typeof MEASURE_TITLE;
export const MEASURES = Object.keys(MEASURE_TITLE) as MeasureId[];

/** The row each kind answers: `Metric` takes no other, so a new number cannot miss the table. */
export const KINDS = {
  'launch.ttid_ms': 'launch',
  'launch.first_frame_ms': 'launch',
  'launch.until_ms': 'launch',
  'launch.ttfd_ms': 'launch',
  'surface.p95_ms': 'frames',
  'surface.slow_34_percent': 'frames',
  'surface.slow_50_percent': 'frames',
  'launch.without_profile_ms': 'launch',
  'launch.with_profile_ms': 'launch',
  'launch.worst_cold_ms': 'launch',
  'launch.worst_warm_ms': 'launch',
  'launch.worst_hot_ms': 'launch',
  'frames.jank_percent': 'frames',
  'frames.app_jank_percent': 'frames',
  'frames.slow_percent': 'frames',
  'frames.p95_ms': 'frames',
  'frames.overrun_p95_ms': 'frames',
  'frames.cpu_p95_ms': 'frames',
  'hitches.count': 'frames',
  'hitches.ratio': 'frames',
  'hitches.worst_ms': 'frames',
  'probe.missed_percent': 'frames',
  'probe.p95_ms': 'frames',
  'frames.frozen': 'frozen',
  'frames.frozen_percent': 'frozen',
  'stalls.worst_ms': 'stalls',
  'hangs.count': 'stalls',
  'hangs.worst_ms': 'stalls',
  'probe.stall_worst_ms': 'stalls',
  'memory.kb': 'memory',
  'memory.end_kb': 'memory',
  'heap.bytes': 'memory',
  'heap.leaks': 'leaks',
  'cpu.percent': 'cpu',
  'threads.over90_ms': 'cpu',
  'network.rx_bytes': 'network',
  'network.tx_bytes': 'network',
  'energy.mah': 'energy',
  'energy.mj': 'energy',
  'energy.impact': 'energy',
  'wakelocks.ms': 'battery',
  'wakelocks.percent': 'battery',
  'wakelocks.longest_ms': 'battery',
  'wakeups.count': 'battery',
  'wakeups.per_hour': 'battery',
  'jobs.count': 'battery',
  'exits.crashes': 'crashes',
  'exits.anrs': 'crashes',
  'exits.user_anrs': 'crashes',
  'size.bytes': 'size',
} as const satisfies Record<string, MeasureId>;

/**
 * Those, and what is named at run time: a launch's phases, which answer `launch-why`; a journey's whole and its steps,
 * which answer `journey`; XCTest's own metrics, which answer no row and show as rows of their own.
 */
export type Kind =
  | keyof typeof KINDS
  | `launch.phase.${string}_ms`
  | `journey.${string}`
  | `xct.${string}`
  | `memory.anon_swap.${string}`
  | `memory.bitmap.${string}`;

export const isPhase = (kind: string) => kind.startsWith('launch.phase.');

/** A kind a run may keep, as `Kind` has it: what a budget is set on. */
export const isKind = (kind: string) =>
  Object.hasOwn(KINDS, kind) ||
  /^(launch\.phase\..+_ms|journey\..+|xct\..+|memory\.(anon_swap|bitmap)\..+)$/.test(kind);

/** A start's phase as it is kept. */
export const phaseKind = (phase: string): Kind =>
  `launch.phase.${phase.replace(/\W+/g, '_').toLowerCase()}_ms`;

/** Which row a kept kind answers, if any: a record may have been kept by another version. */
export function measureOf(kind: string): MeasureId | undefined {
  if (isPhase(kind)) return 'launch-why';
  if (kind.startsWith('journey.')) return 'journey';
  if (kind.startsWith('memory.anon_swap.') || kind.startsWith('memory.bitmap.')) return 'memory';
  return Object.hasOwn(KINDS, kind) ? KINDS[kind as keyof typeof KINDS] : undefined;
}

/** A journey's time from start to end: its kind keeps the row's first record, what its cell and trend read. */
export const JOURNEY_TOTAL = 'journey.total_ms';

/**
 * How many steps of an iteration never settled: such a step has no time, and a gate goes by the kinds a run holds, so
 * this is what it sees of one that stopped settling in every iteration.
 */
export const JOURNEY_UNSETTLED = 'journey.unsettled';

/** A step's kind: `journey.<number>_<its line>.<what>`. What a line holds that is no word reads as `_`. */
export const journeyKind = (n: number, line: string, what: string): `journey.${string}` =>
  `journey.${String(n).padStart(2, '0')}_${line
    .replace(/\W+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)}.${what}`;

/** The two parts of a step's kind; none for the journey's whole, or a kind from elsewhere. */
export function journeyStep(kind: string): { step: string; what: string } | undefined {
  const [, step, what] = /^journey\.(\d+_.*)\.(\w+)$/.exec(kind) ?? [];
  return step !== undefined && what !== undefined ? { step, what } : undefined;
}

/** A step's name in words, from its kind. */
export const stepName = (step: string) => step.replaceAll('_', ' ');

/** A run of odd characters as one: stored runs and baselines already have these names. */
export const keyName = (s: string) => s.replace(/[^\w.-]+/g, '_');

/** The key of a baseline: the same kind of device, its model and OS's major version. */
export const deviceClass = (d: DeviceInfo) =>
  keyName(
    `${d.platform}-${d.virtual ? 'virtual' : 'physical'}-${d.model}-${d.os.split('.')[0] ?? d.os}`,
  );

/**
 * Host load per core over this: a virtual device shares the host's cores with whatever else runs, and a number timed
 * on the host waits for them, on any device. An emulator's cold start doubled, 350 ms to 700 ms, between load 11 and
 * 16 on 15 cores, and an iPhone's launch swung between 550 ms and 3 s (docs/reference/perf-evidence.md).
 */
const HOST_LOAD_PER_CORE = 0.8;
/** Above this share of all its cores a device is busy with more than the app. */
const DEVICE_BUSY = 80;
/** The same, by load, for a device whose CPU share cannot be read. */
const DEVICE_LOAD = 8;
const CPU_PRESSURE = 40;
/** Android's thermal status "moderate" and up throttles. */
const THERMAL_STATUS = 2;

export function noiseOf(
  r: Pick<PerfRecord, 'load' | 'thermal' | 'build' | 'device'>,
  throughHost = false,
): Noise[] {
  const out: Noise[] = [];
  if (
    (r.device.virtual || throughHost) &&
    (r.load.host[0] ?? 0) > r.load.hostCpus * HOST_LOAD_PER_CORE
  )
    out.push('high-host-load');
  // a phone's kernel threads count as load and do no work: a Xiaomi at rest read 23.35 with 6 % of its CPU at work, and
  // the parked count of one moment does not undo a minute's average
  const working = (r.load.device?.[0] ?? 0) - (r.load.deviceParked ?? 0);
  const busy =
    r.load.deviceBusy === undefined ? working > DEVICE_LOAD : r.load.deviceBusy > DEVICE_BUSY;
  if (busy || (r.load.devicePressure ?? 0) > CPU_PRESSURE) out.push('high-device-load');
  if ((r.thermal ?? 0) >= THERMAL_STATUS) out.push('hot-device');
  if (r.build === 'debug') out.push('debuggable-build');
  if (r.load.mirrored) out.push('mirrored');
  // an unread phone must not look like a calm one; a virtual device's state is this Mac's, read above
  const read = [r.load.device, r.load.deviceBusy, r.load.devicePressure, r.thermal];
  if (!r.device.virtual && read.every((x) => x === undefined)) out.push('device-state-unread');
  return out;
}

/** They say what a number is, beside it, and are no reason to measure again: a build is told apart by `build`. */
const MARKS: Noise[] = ['debuggable-build', 'device-state-unread'];

/** What stood in a number's way: a reference taken under it would hide every later change. */
export const loud = (noise: Noise[]) => noise.filter((n) => !MARKS.includes(n));

export type Metric = {
  kind: Kind;
  unit: Unit;
  samples: number[];
  better?: 'lower' | 'higher';
  modelled?: boolean;
  /** Timed on this Mac and not on the device, so its load is in the number on a phone too. */
  throughHost?: boolean;
};

export type RunContext = Omit<
  PerfRecord,
  | 'schema'
  | 'id'
  | 'kind'
  | 'unit'
  | 'better'
  | 'value'
  | 'samples'
  | 'spread'
  | 'noise'
  | 'deviceClass'
>;

/**
 * The records of a run; a metric with no sample that can be a reading was not measured and has none. No kind goes below
 * zero: one that does is a count that fell between its two reads, and says nothing of the run.
 */
export function recordsOf(ctx: RunContext, metrics: Metric[]): PerfRecord[] {
  return metrics.flatMap((m, i) => {
    const samples = m.samples.filter((x) => Number.isFinite(x) && x >= 0);
    if (samples.length === 0) return [];
    return [
      {
        schema: 1 as const,
        ...ctx,
        id: `${ctx.run}-${i}`,
        kind: m.kind,
        unit: m.unit,
        better: m.better ?? 'lower',
        value: median(samples),
        samples,
        spread: spread(samples),
        deviceClass: deviceClass(ctx.device),
        noise: noiseOf(ctx, m.throughHost),
        ...(m.modelled && { modelled: true }),
        ...(m.throughHost && { throughHost: true }),
      },
    ];
  });
}
