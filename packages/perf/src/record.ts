import { median, spread, type Spread } from './stats.js';

export type Unit = 'ms' | 'percent' | 'kb' | 'bytes' | 'count' | 'mah' | 'ratio';

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
  load: { host: number[]; hostCpus: number; device?: number[]; devicePressure?: number };
  thermal?: number;
  batteryTempC?: number;
  tool: string;
  at: string;
  noise: Noise[];
};

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_');

/** The key of a baseline: the same kind of device, its model and OS's major version. */
export const deviceClass = (d: DeviceInfo) =>
  safe(
    `${d.platform}-${d.virtual ? 'virtual' : 'physical'}-${d.model}-${d.os.split('.')[0] ?? d.os}`,
  );

/** Host load per core over this: a virtual device shares the host's cores with whatever else runs. */
const HOST_LOAD_PER_CORE = 1;
/** Above this a device is busy with more than the app (the design's limit for a timed run is 3). */
const DEVICE_LOAD = 8;
const CPU_PRESSURE = 40;
/** Android's thermal status "moderate" and up throttles. */
const THERMAL_STATUS = 2;

export function noiseOf(r: Pick<PerfRecord, 'load' | 'thermal' | 'build' | 'device'>): Noise[] {
  const out: Noise[] = [];
  if (r.device.virtual && (r.load.host[0] ?? 0) > r.load.hostCpus * HOST_LOAD_PER_CORE)
    out.push('high-host-load');
  if ((r.load.device?.[0] ?? 0) > DEVICE_LOAD || (r.load.devicePressure ?? 0) > CPU_PRESSURE)
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
      },
    ];
  });
}
