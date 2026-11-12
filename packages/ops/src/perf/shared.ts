import { execFileSync } from 'node:child_process';
import { stat, writeFile } from 'node:fs/promises';
import { loadavg, cpus } from 'node:os';
import { join } from 'node:path';
import {
  Cannot,
  type Capability,
  type CompileMode,
  type MeasureSource,
  type Measured,
  must,
  pause,
  stateDir,
} from '@appdyno/core';
import {
  type DeviceInfo,
  type MeasureId,
  saveRefusal,
  deviceClass,
  latestRuns,
  writeDashboard,
  type Metric,
  recordsOf,
  newId,
  pruneTraces,
  saveRun,
  store,
} from '@appdyno/perf';
import { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { liveMirror } from '../mirror-state.js';
import { checkApp, checkLaunch, noApp } from '../policy.js';
import type { Session } from '../session.js';
import { swipeLine } from '../gesture-paths.js';
import { ToolError } from '../tool.js';

let virtualHost: boolean | undefined;

/**
 * Whether this Mac is itself a virtual machine, as macOS says of one; read once. `APPDYNO_HOST_VIRTUAL` 0 or 1 says
 * it instead, for a virtual Mac whose load average does say how busy it is.
 */
export function hostIsVirtual() {
  const said = process.env.APPDYNO_HOST_VIRTUAL;
  if (said === '0' || said === '1') return said === '1';
  if (virtualHost === undefined) {
    try {
      virtualHost =
        process.platform === 'darwin' &&
        execFileSync('/usr/sbin/sysctl', ['-n', 'kern.hv_vmm_present'], {
          encoding: 'utf8',
        }).trim() === '1';
    } catch {
      virtualHost = false;
    }
  }
  return virtualHost;
}

/** What each mark of a less sure number means, as an answer says it. */
const NOISE_WORDS: Record<string, string | undefined> = {
  'high-host-load': 'this Mac was loaded',
  'high-device-load': 'the device was busy',
  'hot-device': 'the device was hot',
  'debuggable-build': 'a debug build, slower than a release build',
  mirrored: "the device's screen was mirrored",
  'device-state-unread': "the device's load and heat could not be read",
  'host-load-unread':
    'this Mac is a virtual machine, whose load average says nothing of how busy it is',
};

/** What to do after the frame probe's relaunch, which left the app on its first screen. */
export const PROBE_HINT =
  'open the screen to measure again and call once more: the probe stays in until the app stops';

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

export const Dsym = z
  .string()
  .max(1_000)
  .optional()
  .describe("the build's .dSYM or a folder of them");

/** A dSYM's path as the driver takes it; on Android simpleperf reads what the device holds, and one would do nothing. */
export const symbolsOf = (s: Session, dsym?: string) => {
  if (dsym && !s.device.measure.symbolFiles)
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
  startInfo: 'launch-why',
  size: 'size',
};

export const kb = (n?: number) => (n === undefined ? '?' : `${(n / 1024).toFixed(1)} MB`);

/** How far a measure that records during a scroll swipes. */
export const SCROLLER_SWIPES = 4;

/** A measure the platform may lack: its answer, or nothing when it says UNSUPPORTED, in whatever words. */
export const unlessUnsupported = async <T>(p: Promise<T>): Promise<T | undefined> =>
  p.catch((e: unknown) => {
    if ((e as { code?: string }).code !== 'UNSUPPORTED') throw e;
    return undefined;
  });

export const deviceInfo = (s: Session): DeviceInfo => ({
  serial: s.device.serial,
  platform: s.device.platform,
  model: s.device.hello?.model ?? 'unknown',
  os: s.device.hello?.osVersion ?? 'unknown',
  virtual: s.device.virtual,
});

/**
 * When this key's last run was kept: where a reading of what happened in a run starts, when a run has no window of its
 * own. Shortcut: a run's time is stamped after its reads, so what falls between the two belongs to neither run; a run
 * would have to keep the time of its read to close that.
 */
export async function lastRunAt(ctx: ServerContext, s: Session, app: string, scenario: string) {
  const key = { app, scenario, deviceClass: deviceClass(deviceInfo(s)) };
  const [run] = await latestRuns(ctx.measurementsDir, key, 1).catch(() => []);
  return run?.[0] && Date.parse(run[0].at);
}

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

/** How often a kept run looks at what traces take: it walks the folder, and a run comes every few seconds. */
const PRUNE_EVERY_MS = 3_600_000;

/**
 * Down to the limit, by one state folder's runs and only in it. A context that keeps its runs elsewhere does not know
 * what those traces are for, so it is refused and not guessed at.
 */
export function pruneNow(ctx: ServerContext, limitGb: number, dryRun = false) {
  const state = stateDir();
  if (ctx.measurementsDir !== join(state, 'measurements'))
    throw new ToolError(
      `traces are in ${state} and this context keeps its runs in ${ctx.measurementsDir}: a prune goes by one folder's runs`,
      'UNSUPPORTED',
      'leave out --measurements',
    );
  return pruneTraces({
    state,
    project: ctx.perfDir,
    limitBytes: limitGb * 2 ** 30,
    dryRun,
  });
}

/**
 * At most hourly across processes, by a file's time, and only where the entry point asked (`autoPrune`): the server and
 * the command line of a user. Nothing else that makes a context ever prunes by itself. A number is kept whatever becomes
 * of this. After what writes a trace: a kept run, a measurement kept with none, a flight recorder's page.
 */
export async function pruneWhenDue(ctx: ServerContext) {
  if (!ctx.options.storage?.autoPrune) return;
  const stamp = join(stateDir(), 'traces-pruned');
  try {
    const last = await stat(stamp).then(
      (x) => x.mtimeMs,
      () => 0,
    );
    if (Date.now() - last < PRUNE_EVERY_MS) return;
    await writeFile(stamp, '');
    await pruneNow(ctx, ctx.traceLimitGb);
  } catch {
    // `perf prune` says what is wrong
  }
}

/** What a measure keeps of a run. */
export type KeptRun = {
  app: string;
  scenario: string;
  /** What measured it. */
  source: string;
  /** The file with what the device said. */
  raw: string;
  metrics: Metric[];
  compile?: CompileMode | undefined;
  startedNs?: number | undefined;
};

/**
 * A run's records, with the context each number is judged by; read after the measured window, so it does not
 * disturb it. Whatever measures next (a flow's journey, step by step) keeps its numbers here and perf_compare
 * reads them like any other: name the scenario and the metrics.
 */
export async function keepRun(
  ctx: ServerContext,
  s: Session,
  { app, scenario, source, raw, metrics, compile, startedNs }: KeptRun,
) {
  const m = s.device.measure;
  const vitals = (await m.vitals().catch(() => undefined))?.value;
  const h = s.device.hello;
  const records = recordsOf(
    {
      run: newId('run'),
      app,
      scenario,
      source,
      raw,
      device: deviceInfo(s),
      build: (await m.buildType(app).catch(() => undefined)) ?? 'unknown',
      ...(compile && { compile }),
      ...(startedNs !== undefined && { startedNs }),
      load: {
        host: loadavg(),
        hostCpus: cpus().length,
        ...(hostIsVirtual() && { hostVirtual: true }),
        ...(vitals?.load && { device: vitals.load }),
        ...(vitals?.parkedKernelThreads !== undefined && {
          deviceParked: vitals.parkedKernelThreads,
        }),
        ...(vitals?.cpuPressure !== undefined && { devicePressure: vitals.cpuPressure }),
        ...(vitals?.cpuBusyPercent !== undefined && { deviceBusy: vitals.cpuBusyPercent }),
        // a timeline's or a flight recorder's video runs the same encoder on the device
        ...((liveMirror(s.device.serial) ?? s.timeline ?? s.flight) && { mirrored: true }),
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
  await pruneWhenDue(ctx);
  return [...new Set(records.flatMap((r) => r.noise))];
}

export function perfTools(ctx: ServerContext) {
  /**
   * The device's measure. A refusal goes through here and is kept as that row's answer on this kind of device; `row:
   * false` for one that says nothing of the device (the caller chose it). What a device has no way of measuring says
   * so by its name, and is no row's answer: a row may have another way, and a survey says it of the row.
   */
  const measure = <K extends Capability>(
    s: Session,
    k: K,
    row: MeasureId | false = ROW_OF[k] ?? false,
  ): MeasureSource[K] => {
    const source = s.device.measure;
    const f = source[k] as (...a: unknown[]) => Promise<unknown>;
    const run = async (...a: unknown[]) =>
      f.apply(source, a).catch(async (e: unknown) => {
        if (e instanceof Cannot)
          throw new ToolError(`${s.device.serial} ${e.message}`, 'UNSUPPORTED');
        if (row && e instanceof DeviceError && e.code === 'UNSUPPORTED') {
          await keepRefusal(ctx, s, a[0] as string, row, e.message);
          await rewriteDashboard(ctx);
        }
        throw e;
      });
    return run as unknown as MeasureSource[K];
  };
  /** The app a measure is of, which it may start anew: the next action asks for its process again. */
  const measuredApp = (s: Session, app?: string) => {
    s.forgetProcess();
    const pkg = checkLaunch(ctx.policy, checkApp(ctx.policy, app ?? s.appId ?? ''));
    if (!pkg) throw noApp();
    return pkg;
  };
  const virtualNote = (s: Session) =>
    s.device.virtual
      ? ' (virtual device: relative, compare only with the same kind of device)'
      : '';
  const save = async (kind: string, m: Measured<unknown>[], value: unknown) => {
    const saved = await store(
      ctx.measurementsDir,
      kind,
      value,
      m.map((x) => `## ${x.at}\n${x.raw}`).join('\n\n'),
    );
    await pruneWhenDue(ctx);
    return saved;
  };
  const keep = (s: Session, run: KeptRun) => keepRun(ctx, s, run);
  const noisy = (noise: string[]) =>
    noise.length ? [`noise: ${noise.map((n) => NOISE_WORDS[n] ?? n).join('; ')}`] : [];
  /**
   * Frames on a simulator come through the probe unless told otherwise. Its relaunch leaves the app on its first screen,
   * and a measure of that is not of the screen asked for: no way back to it is sure, so the call stops there.
   */
  const withProbe = async (s: Session, pkg: string, probe = s.device.measure.framesByProbe) => {
    if (!probe || !(await measure(s, 'attachProbe')(pkg))) return;
    s.acted();
    throw new ToolError(
      `${pkg} was relaunched with the frame probe in it, and shows its first screen: nothing was measured`,
      'CHECK_FAILED',
      PROBE_HINT,
    );
  };
  /** Swipes after `waitMs`, for a measure that records during a scroll. */
  const scroller = async (
    s: Session,
    direction: 'up' | 'down',
    waitMs: number,
    swipes = SCROLLER_SWIPES,
  ) => {
    const h = must(s.device.hello, "the agent's hello");
    const size = (await s.current()).window ?? { w: h.screen.w, h: h.screen.h };
    return async () => {
      await pause(waitMs);
      for (let i = 0; i < swipes; i++) {
        const { from, to } = swipeLine(size, { direction, distance: size.h * 0.4 });
        await s.device.swipe(from, to, 300, { settle: false });
      }
    };
  };

  return { measure, measuredApp, virtualNote, save, keep, noisy, withProbe, scroller };
}
