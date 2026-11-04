import { loadavg, cpus } from 'node:os';
import { type Capability, type MeasureSource, type Measured, pause } from '@appdyno/core';
import {
  type DeviceInfo,
  type MeasureId,
  saveRefusal,
  deviceClass,
  writeDashboard,
  type Metric,
  recordsOf,
  newId,
  saveRun,
  store,
} from '@appdyno/perf';
import { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { checkApp } from '../policy.js';
import type { Session } from '../session.js';
import { swipeLine } from '../gesture-paths.js';
import { ToolError } from '../tool.js';

export const App = z.string().max(200).optional();

export const Scenario = z
  .string()
  .regex(/^[\w.-]{1,60}$/)
  .optional()
  .describe('kept under this name');

export const Probe = z
  .boolean()
  .optional()
  .describe('iOS simulator: frame probe; relaunches the app');

export const Dsym = z.string().max(1_000).optional().describe("iOS: the build's .dSYM");

/** A dSYM's path as the driver takes it; on Android simpleperf reads what the device holds, and one would do nothing. */
export const symbolsOf = (s: Session, dsym?: string) => {
  if (dsym && s.device.platform !== 'ios')
    throw new ToolError(
      'dsym is for iOS: on Android the names come from the device',
      'UNSUPPORTED',
    );
  return dsym ? { dsym } : undefined;
};

/** The row of the table a refusal of this measure answers. What is about a part of a row (threads, a profile) has none. */
export const ROW_OF: Partial<Record<Capability, MeasureId>> = {
  cpu: 'cpu',
  memory: 'memory',
  anonMemory: 'memory',
  heap: 'leaks',
  frames: 'frames',
  framesDuring: 'frames',
  resetFrames: 'frames',
  frameTrace: 'frames',
  attachProbe: 'frames',
  hangs: 'stalls',
  launch: 'launch',
  network: 'network',
  energy: 'energy',
  battery: 'battery',
  exits: 'crashes',
  size: 'size',
};

/** A row with more than one way to read it: a device lacking one of them is no device that cannot. */
const ROUTES: Partial<Record<MeasureId, Capability[]>> = {
  memory: ['memory', 'anonMemory'],
  frames: ['frames', 'framesDuring', 'frameTrace'],
  stalls: ['frames', 'frameTrace', 'hangs'],
};

/** What a device without the measure is told it lacks. */
const MEASURE_NAME: Record<Capability, string> = {
  cpu: 'CPU',
  memory: 'memory',
  anonMemory: 'anonymous memory by process state',
  frames: 'frames',
  framesDuring: 'frames',
  resetFrames: 'frames',
  vitals: 'the device state',
  launch: 'launch time',
  cpuProfile: 'a CPU profile',
  heap: 'a heap dump',
  frameTrace: 'a frame trace',
  buildType: 'the build type',
  attachProbe: 'through a frame probe',
  threads: 'per-thread CPU',
  network: 'network bytes',
  energy: 'energy',
  battery: 'wake locks, wakeups and jobs',
  exits: 'crash and ANR exits',
  size: 'app size',
  heapProfile: 'a heap profile',
  hangs: 'hangs',
  xctMetrics: "XCTest's metrics",
};

export const kb = (n?: number) => (n === undefined ? '?' : `${(n / 1024).toFixed(1)} MB`);

/** How far a measure that records during a scroll swipes. */
export const SCROLLER_SWIPES = 4;

/** A measure the platform may lack: its answer, or nothing when it says UNSUPPORTED. */
export const unlessUnsupported = async <T>(p: Promise<T>): Promise<T | undefined> =>
  p.catch((e: unknown) => {
    if (!(e instanceof DeviceError && e.code === 'UNSUPPORTED')) throw e;
    return undefined;
  });

export const virtual = (s: Session) => (s.device.virtual ?? s.device.measure?.virtual) === true;

const probeByDefault = (s: Session) => !!s.device.measure?.attachProbe;

export const deviceInfo = (s: Session): DeviceInfo => ({
  serial: s.device.serial,
  platform: s.device.platform,
  model: s.device.hello?.model ?? 'unknown',
  os: s.device.hello?.osVersion ?? 'unknown',
  virtual: virtual(s),
});

/** That this device said it cannot give a measure, and why, for the dashboard. */
export const keepRefusal = (
  ctx: ServerContext,
  s: Session,
  app: string,
  measure: MeasureId,
  reason: string,
) =>
  saveRefusal(ctx.measurementsDir, {
    deviceClass: deviceClass(deviceInfo(s)),
    measure,
    app,
    reason,
    at: new Date().toISOString(),
  });

/** The page an open browser reloads; a number is kept whatever becomes of it. */
export const rewriteDashboard = async (ctx: ServerContext) => {
  try {
    await writeDashboard(ctx.measurementsDir, ctx.perfDir);
  } catch {
    // the next kept run, or `perf dashboard`, writes it again and says what is wrong
  }
};

/**
 * A run's records, with the context each number is judged by; read after the measured window, so it does not
 * disturb it. Whatever measures next (a flow's journey, step by step) keeps its numbers here and perf_compare
 * reads them like any other: name the scenario and the metrics.
 */
export async function keepRun(
  ctx: ServerContext,
  s: Session,
  app: string,
  scenario: string,
  source: string,
  raw: string,
  metrics: Metric[],
  compile?: string,
) {
  const m = s.device.measure;
  const vitals = (await m?.vitals?.().catch(() => undefined))?.value;
  const h = s.device.hello;
  const records = recordsOf(
    {
      run: newId('run'),
      app,
      scenario,
      source,
      raw,
      device: deviceInfo(s),
      build: (await m?.buildType?.(app).catch(() => undefined)) ?? 'unknown',
      ...(compile && { compile }),
      load: {
        host: loadavg(),
        hostCpus: cpus().length,
        ...(vitals?.load && { device: vitals.load }),
        ...(vitals?.parkedKernelThreads !== undefined && {
          deviceParked: vitals.parkedKernelThreads,
        }),
        ...(vitals?.cpuPressure !== undefined && { devicePressure: vitals.cpuPressure }),
      },
      ...(vitals?.thermalStatus !== undefined && { thermal: vitals.thermalStatus }),
      ...(vitals?.batteryTempC !== undefined && { batteryTempC: vitals.batteryTempC }),
      tool: h?.agentVersion ?? 'unknown',
      at: new Date().toISOString(),
    },
    metrics,
  );
  await saveRun(ctx.measurementsDir, records);
  await rewriteDashboard(ctx);
  return [...new Set(records.flatMap((r) => r.noise))];
}

export function perfTools(ctx: ServerContext) {
  /**
   * The device's measure, or a refusal that names what it lacks. Every refusal goes through here and is kept as that
   * row's answer on this kind of device; `row: false` for one that says nothing of the device (the caller chose it).
   */
  const measure = <K extends Capability>(
    s: Session,
    k: K,
    row: MeasureId | false = ROW_OF[k] ?? false,
  ): NonNullable<MeasureSource[K]> => {
    const source = s.device.measure;
    const f = source?.[k] as ((...a: unknown[]) => Promise<unknown>) | undefined;
    const run = async (...a: unknown[]) => {
      const keep = async (why: string) => {
        if (!row) return;
        await keepRefusal(ctx, s, a[0] as string, row, why);
        await rewriteDashboard(ctx);
      };
      if (!f) {
        const elsewhere = row && ROUTES[row]?.some((r) => r !== k && source?.[r]);
        const why = `${s.device.serial} cannot measure ${MEASURE_NAME[k]}`;
        if (!elsewhere) await keep(why);
        throw new ToolError(why, 'UNSUPPORTED');
      }
      return f.apply(source, a).catch(async (e: unknown) => {
        if (e instanceof DeviceError && e.code === 'UNSUPPORTED') await keep(e.message);
        throw e;
      });
    };
    return run as unknown as NonNullable<MeasureSource[K]>;
  };
  const appOf = (s: Session, app?: string) => {
    const pkg = checkApp(ctx.policy, app ?? s.appId ?? '');
    if (!pkg) throw new ToolError('give app (or select one with use_device)', 'INVALID_ARGUMENT');
    return pkg;
  };
  const virtualNote = (s: Session) =>
    virtual(s) ? ' (virtual device: relative, compare only with the same kind of device)' : '';
  const save = async (kind: string, m: Measured<unknown>[], value: unknown) =>
    store(ctx.measurementsDir, kind, value, m.map((x) => `## ${x.at}\n${x.raw}`).join('\n\n'));
  const keep = (
    s: Session,
    app: string,
    scenario: string,
    source: string,
    raw: string,
    metrics: Metric[],
    compile?: string,
  ) => keepRun(ctx, s, app, scenario, source, raw, metrics, compile);
  const noisy = (noise: string[]) => (noise.length ? [`noise: ${noise.join(', ')}`] : []);
  /** Frames on a simulator come through the probe unless told otherwise: what it cost is said in the answer. */
  const withProbe = async (s: Session, pkg: string, probe = probeByDefault(s)) => {
    if (!probe) return [];
    const relaunched = await measure(s, 'attachProbe')(pkg);
    return relaunched
      ? ['the app was relaunched with the frame probe in it; probe: false turns it off']
      : [];
  };
  /** Four swipes after `waitMs`, for a measure that records during a scroll. */
  const scroller = async (s: Session, direction: 'up' | 'down', waitMs: number) => {
    const h = s.device.hello!;
    const size = (await s.current()).window ?? { w: h.screen.w, h: h.screen.h };
    return async () => {
      await pause(waitMs);
      for (let i = 0; i < SCROLLER_SWIPES; i++) {
        const { from, to } = swipeLine(size, { direction, distance: size.h * 0.4 });
        await s.device.swipe(from, to, 300, { settle: false });
      }
    };
  };

  return { measure, appOf, virtualNote, save, keep, noisy, withProbe, scroller };
}
