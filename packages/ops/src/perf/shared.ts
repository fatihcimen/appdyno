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
import { refused, type Session } from '../session.js';
import { swipeLine } from '../gesture-paths.js';
import { ToolError } from '../tool.js';

export const App = z.string().max(200).optional().describe('default: the selected app');

export const Scenario = z
  .string()
  .regex(/^[\w.-]{1,60}$/)
  .optional()
  .describe('name to keep this run under');

export const Probe = z
  .boolean()
  .optional()
  .describe('iOS simulator: frame probe, relaunches the app once');

/** What a device without the measure is told it lacks. */
const MEASURE_NAME: Record<Capability, string> = {
  cpu: 'CPU',
  memory: 'memory',
  frames: 'frames',
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
  exits: 'crash and ANR exits',
  size: 'app size',
  heapProfile: 'a heap profile',
  hangs: 'hangs',
  xctMetrics: "XCTest's metrics",
};

export const kb = (n?: number) => (n === undefined ? '?' : `${(n / 1024).toFixed(1)} MB`);

/** A measure the platform may lack: its answer, or nothing when it says UNSUPPORTED. */
export const unlessUnsupported = async <T>(
  p: Promise<T>,
  saidNo?: (reason: string) => Promise<void>,
): Promise<T | undefined> =>
  p.catch(async (e: unknown) => {
    if (!(e instanceof DeviceError && e.code === 'UNSUPPORTED')) return refused(e);
    await saidNo?.(e.message);
    return undefined;
  });

/** The device's measure, or a refusal that names what it lacks. */
export function measure<K extends Capability>(s: Session, k: K): NonNullable<MeasureSource[K]> {
  const source = s.device.measure;
  const f = source?.[k] as ((...a: unknown[]) => unknown) | undefined;
  if (!f)
    throw new ToolError(`${s.device.serial} cannot measure ${MEASURE_NAME[k]}`, 'UNSUPPORTED');
  return f.bind(source) as NonNullable<MeasureSource[K]>;
}

export const virtual = (s: Session) => (s.device.virtual ?? s.device.measure?.virtual) === true;

export const deviceInfo = (s: Session): DeviceInfo => ({
  serial: s.device.serial,
  platform: s.device.platform,
  model: s.device.hello?.model ?? 'unknown',
  os: s.device.hello?.osVersion ?? 'unknown',
  virtual: virtual(s),
});

/** That this device said it cannot give a measure, and why, for the dashboard. */
export const keepRefusal = (ctx: ServerContext, s: Session, measure: MeasureId, reason: string) =>
  saveRefusal(ctx.measurementsDir, {
    deviceClass: deviceClass(deviceInfo(s)),
    measure,
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
  return records[0]?.noise ?? [];
}

export function perfTools(ctx: ServerContext) {
  const appOf = (s: Session, app?: string) => {
    const pkg = checkApp(ctx.policy, app ?? s.appId ?? '');
    if (!pkg) throw new ToolError('give app (or select one with use_device)');
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
  const withProbe = async (s: Session, pkg: string, probe?: boolean) => {
    if (probe) await measure(s, 'attachProbe')(pkg).catch(refused);
  };
  /** Four swipes after `waitMs`, for a measure that records during a scroll. */
  const scroller = async (s: Session, direction: 'up' | 'down', waitMs: number) => {
    const h = s.device.hello!;
    const size = (await s.current()).window ?? { w: h.screen.w, h: h.screen.h };
    return async () => {
      await pause(waitMs).catch(refused);
      for (let i = 0; i < 4; i++) {
        const { from, to } = swipeLine(size, { direction, distance: size.h * 0.4 });
        await s.device.swipe(from, to, 300, { settle: false });
      }
    };
  };

  return { appOf, virtualNote, save, keep, noisy, withProbe, scroller };
}
