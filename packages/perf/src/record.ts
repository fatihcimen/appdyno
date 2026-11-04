import { median, spread, type Spread } from './stats.js';

export type Unit = 'ms' | 'percent' | 'kb' | 'bytes' | 'count' | 'mah' | 'mj' | 'ratio';

export type Build = 'debug' | 'profileable' | 'release' | 'unknown';

export type DeviceInfo = {
  serial: string;
  platform: 'android' | 'ios';
  model: string;
  os: string;
  virtual: boolean;
};

/** What makes a number less trustworthy; the first three also keep a change from failing a gate. */
export type Noise = 'high-host-load' | 'high-device-load' | 'hot-device' | 'debuggable-build';

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
  /** Android's compile state, or what else makes launches comparable. */
  compile?: string;
  load: {
    host: number[];
    hostCpus: number;
    device?: number[];
    devicePressure?: number;
    /** What of the device's load is kernel threads asleep, using no CPU. */
    deviceParked?: number;
  };
  thermal?: number;
  batteryTempC?: number;
  tool: string;
  at: string;
  noise: Noise[];
  /** An estimate from a model, not a reading of the thing itself; always shown as one. */
  modelled?: boolean;
};

/** The rows of the performance table: what a device can be asked. */
export const MEASURES = [
  'launch',
  'launch-why',
  'frames',
  'frozen',
  'stalls',
  'memory',
  'leaks',
  'cpu',
  'network',
  'energy',
  'battery',
  'crashes',
  'size',
  'journey',
] as const;
export type MeasureId = (typeof MEASURES)[number];

/** The row each kind answers: `Metric` takes no other, so a new number cannot miss the table. */
export const KINDS = {
  'launch.ttid_ms': 'launch',
  'launch.first_frame_ms': 'launch',
  'launch.until_ms': 'launch',
  'launch.ttfd_ms': 'launch',
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
  keyof typeof KINDS | `launch.phase.${string}_ms` | `journey.${string}` | `xct.${string}`;

/** Which row a kept kind answers, if any: a record may have been kept by another version. */
export function measureOf(kind: string): MeasureId | undefined {
  if (kind.startsWith('launch.phase.')) return 'launch-why';
  if (kind.startsWith('journey.')) return 'journey';
  return Object.hasOwn(KINDS, kind) ? KINDS[kind as keyof typeof KINDS] : undefined;
}

/** A journey's time from start to end: its kind keeps the row's first record, what its cell and trend read. */
export const JOURNEY_TOTAL = 'journey.total_ms';

/** A step's kind: `journey.<number>_<its line>.<what>`. What a line holds that is no word reads as `_`. */
export const journeyKind = (n: number, line: string, what: string): `journey.${string}` =>
  `journey.${String(n).padStart(2, '0')}_${line
    .replace(/\W+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)}.${what}`;

/** The two parts of a step's kind; none for the journey's whole, or a kind from elsewhere. */
export function journeyStep(kind: string): { step: string; what: string } | undefined {
  const m = /^journey\.(\d+_.*)\.(\w+)$/.exec(kind);
  return m ? { step: m[1]!, what: m[2]! } : undefined;
}

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
 * 16 on 15 cores, and an iPhone's launch swung between 550 ms and 3 s (docs/perf.md).
 */
const HOST_LOAD_PER_CORE = 0.8;
/** Above this a device is busy with more than the app. */
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
  // shortcut: the parked count is of this moment and the load a minute's average, so a burst of kernel I/O
  // reads low; judge by the CPU's busy share if a busy phone ever passes
  const working = (r.load.device?.[0] ?? 0) - (r.load.deviceParked ?? 0);
  if (working > DEVICE_LOAD || (r.load.devicePressure ?? 0) > CPU_PRESSURE)
    out.push('high-device-load');
  if ((r.thermal ?? 0) >= THERMAL_STATUS) out.push('hot-device');
  if (r.build === 'debug') out.push('debuggable-build');
  return out;
}

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

/** The records of a run; a metric with no finite sample was not measured and has none. */
export function recordsOf(ctx: RunContext, metrics: Metric[]): PerfRecord[] {
  return metrics.flatMap((m, i) => {
    const samples = m.samples.filter(Number.isFinite);
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
      },
    ];
  });
}
