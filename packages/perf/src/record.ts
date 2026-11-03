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
  'stalls',
  'memory',
  'leaks',
  'cpu',
  'network',
  'energy',
  'crashes',
  'size',
] as const;
export type MeasureId = (typeof MEASURES)[number];

/** Which row a kind answers. A launch's phases are kinds of the form `launch.phase.<name>_ms`. */
export function measureOf(kind: string): MeasureId | undefined {
  if (kind.startsWith('launch.phase.')) return 'launch-why';
  if (kind === 'heap.leaks') return 'leaks';
  if (kind === 'probe.missed_percent' || kind === 'probe.p95_ms') return 'frames';
  if (kind === 'probe.stall_worst_ms') return 'stalls';
  const byPrefix: Record<string, MeasureId> = {
    launch: 'launch',
    frames: 'frames',
    hitches: 'frames',
    stalls: 'stalls',
    hangs: 'stalls',
    memory: 'memory',
    heap: 'memory',
    cpu: 'cpu',
    threads: 'cpu',
    network: 'network',
    energy: 'energy',
    exits: 'crashes',
    size: 'size',
  };
  return byPrefix[kind.split('.')[0] ?? ''];
}

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_');

/** The key of a baseline: the same kind of device, its model and OS's major version. */
export const deviceClass = (d: DeviceInfo) =>
  safe(
    `${d.platform}-${d.virtual ? 'virtual' : 'physical'}-${d.model}-${d.os.split('.')[0] ?? d.os}`,
  );

/**
 * Host load per core over this: a virtual device shares the host's cores with whatever else runs. An emulator's
 * cold start doubled, 350 ms to 700 ms, between load 11 and 16 on 15 cores (docs/perf.md).
 */
const HOST_LOAD_PER_CORE = 0.8;
/** Above this a device is busy with more than the app. */
const DEVICE_LOAD = 8;
const CPU_PRESSURE = 40;
/** Android's thermal status "moderate" and up throttles. */
const THERMAL_STATUS = 2;

export function noiseOf(r: Pick<PerfRecord, 'load' | 'thermal' | 'build' | 'device'>): Noise[] {
  const out: Noise[] = [];
  if (r.device.virtual && (r.load.host[0] ?? 0) > r.load.hostCpus * HOST_LOAD_PER_CORE)
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
  kind: string;
  unit: Unit;
  samples: number[];
  better?: 'lower' | 'higher';
  modelled?: boolean;
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
  const noise = noiseOf(ctx);
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
        noise,
        ...(m.modelled && { modelled: true }),
      },
    ];
  });
}
