import {
  Cannot,
  cannot,
  tracesDir,
  type DeviceVitals,
  type FrameStats,
  type FrameTrace,
  type LaunchReading,
  type MeasureSource,
  type Measured,
  type Symbols,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { crashExits } from './crashes.js';
import { parseHangCauses } from './hang-cause.js';
import { nameFramesOf } from './frame-names.js';
import { IosPerf, lowerMedian, sampleLaunches, untilShown } from './ios-perf.js';
import { appLaunchPhases } from './phone-launch.js';
import { phoneLeaks } from './phone-leaks.js';
import { phoneEnergy, phoneNetwork } from './phone-power.js';
import type { IosPhoneDevice } from './phone.js';
import { assertBundle } from './simctl.js';
import {
  hitchFrames,
  parseActivityMonitor,
  parseHangs,
  parseThermal,
  parseTimeProfile,
} from './trace-parse.js';
import { recentTrace, recordHitches, recordStallSpans, recordTrace, traceTable } from './trace.js';

const now = () => new Date().toISOString();

/**
 * A trace's rows are counted from a date to the ms, of no clock it names. On an iPhone 13 Pro Max three stalls of 500 ms
 * read 513 to 516 ms and each began inside its tap, a call of 331 to 427 ms: that is as far as it was found to hold.
 */
const PHONE_FRAMES_PLACED = { by: 'the date their trace began', withinMs: 215 };

/** What a phone's measures ask of the device. */
export type PerfPhone = Pick<
  IosPhoneDevice,
  | 'serial'
  | 'ctl'
  | 'crashes'
  | 'launch'
  | 'terminate'
  | 'target'
  | 'appShown'
  | 'inFront'
  | 'xctMetrics'
>;

/** What Instruments and XCTest can read from a phone: what they cannot says why. */
export class IosPhonePerf extends IosPerf implements MeasureSource {
  readonly slowReads = ['memory', 'frames', 'resetFrames'] as const;
  readonly framesByProbe = false;
  frames = cannot('frames');
  resetFrames = cannot('frames');
  attachProbe = cannot('through a frame probe');

  constructor(private readonly phone: PerfPhone) {
    super();
  }

  /** No tool answers this by itself: every recording holds it, so it costs what the recording cost. */
  async vitals(): Promise<Measured<DeviceVitals>> {
    const trace = recentTrace(this.phone.serial);
    const thermalStatus = trace
      ? parseThermal(await traceTable(trace, 'device-thermal-state-intervals'))
      : undefined;
    return {
      value: thermalStatus === undefined ? {} : { thermalStatus },
      raw: trace ?? 'no recording of this phone in the last minutes',
      at: now(),
    };
  }

  /**
   * Animation hitches of the app while `during` runs (Xcode's trace tool, Animation Hitches): frames shown, the app's
   * hitches, their time; the trace is kept for Instruments.
   */
  async hitches(bundle: string, seconds = 5, during?: () => Promise<unknown>) {
    assertBundle(bundle);
    return recordHitches(
      this.phone.serial,
      () => this.phone.ctl.pid(bundle),
      Math.min(Math.max(Math.round(seconds), 1), 30),
      tracesDir(),
      during,
    );
  }

  async frameTrace(
    bundle: string,
    seconds: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<FrameTrace>> {
    await this.phone.inFront(bundle);
    const v = await this.hitches(bundle, seconds, during);
    return {
      value: { kind: 'hitches', ...v },
      raw: v.tracePath,
      at: now(),
      source: 'xctrace Animation Hitches',
    };
  }

  /** What went wrong while `during` ran, on the clock its trace was begun by: a phone says no more of its other frames. */
  async frameMarks(
    bundle: string,
    seconds: number,
    during: () => Promise<unknown>,
    keepSeconds?: number,
  ) {
    // a trace has no ring: it would grow, heavy on the phone, for as long as a flight recorder runs
    if (keepSeconds !== undefined) throw new Cannot('frames in a ring on a phone');
    await this.phone.inFront(bundle);
    assertBundle(bundle);
    const { tracePath, started, spans } = await recordStallSpans(
      this.phone.serial,
      () => this.phone.ctl.pid(bundle),
      seconds,
      tracesDir(),
      during,
    );
    if (started === undefined)
      throw new DeviceError('UNSUPPORTED', 'the trace says nothing of when it began');
    return {
      value: {
        frames: spans.map((s) => ({ at: started + s.start, ms: s.ms, late: true })),
        limits: 'A phone gives its hitches and hangs, not every frame.',
        placed: PHONE_FRAMES_PLACED,
        tracePath,
      },
      raw: tracePath,
      at: now(),
      source: 'xctrace Animation Hitches',
    };
  }

  async framesDuring(
    bundle: string,
    seconds: number,
    during: () => Promise<unknown>,
  ): Promise<Measured<FrameStats>> {
    await this.phone.inFront(bundle);
    const v = await this.hitches(bundle, seconds, during);
    return { value: hitchFrames(v), raw: v.tracePath, at: now() };
  }

  /** Activity Monitor over every process (no attach: a system app has no get-task-allow), one process read. */
  private async activity(bundle: string, windowMs: number) {
    const pid = await this.phone.ctl.pid(assertBundle(bundle));
    const trace = await recordTrace({
      template: 'Activity Monitor',
      device: this.phone.serial,
      seconds: Math.min(Math.max(Math.round(windowMs / 1000), 2), 30),
      dir: tracesDir(),
    });
    const value = parseActivityMonitor(
      await traceTable(trace, 'activity-monitor-process-live'),
      pid,
    );
    if (!value) throw new DeviceError('UNSUPPORTED', `no reading of ${bundle} in the trace`);
    return { value, raw: trace };
  }

  async memory(bundle: string) {
    const { value, raw } = await this.activity(bundle, 2_000);
    const kb = Math.round(value.footprintBytes / 1024);
    return { value: { kb, kind: 'footprint' as const }, raw, at: now() };
  }

  async cpu(bundle: string, windowMs = 3_000) {
    const { value, raw } = await this.activity(bundle, windowMs);
    if (value.cpuPercent === undefined)
      throw new DeviceError('UNSUPPORTED', `the trace has one reading of ${bundle}: no CPU share`);
    return {
      value: { percent: value.cpuPercent, windowMs: value.windowMs! },
      raw,
      at: now(),
    };
  }

  /** The Time Profiler over every process (attaching fails at times on a phone), one process read. */
  private async profile(
    bundle: string,
    ms: number,
    during?: () => Promise<unknown>,
    symbols?: Symbols,
  ) {
    const pid = await this.phone.ctl.pid(assertBundle(bundle));
    const trace = await recordTrace({
      template: 'Time Profiler',
      device: this.phone.serial,
      seconds: Math.min(Math.max(Math.round(ms / 1000), 1), 30),
      dir: tracesDir(),
      ...(during && { during }),
    });
    const exported = await traceTable(trace, 'time-profile');
    const samples = symbols?.dsym ? await nameFramesOf(exported, pid, symbols.dsym) : exported;
    return { trace, pid, samples, profile: parseTimeProfile(samples, pid) };
  }

  async cpuProfile(bundle: string, ms: number, during?: () => Promise<unknown>, symbols?: Symbols) {
    const { trace, profile } = await this.profile(bundle, ms, during, symbols);
    return {
      value: { ...profile, durationMs: Math.round(ms / 1000) * 1000 },
      raw: trace,
      at: now(),
    };
  }

  async launch(
    bundle: string,
    opts: Parameters<MeasureSource['launch']>[1],
  ): Promise<Measured<LaunchReading>> {
    this.noCompileState(opts);
    const { phone } = this;
    // first: a system app is refused at once, before the launches
    const startup = opts.trace
      ? await phone.terminate(bundle).then(() => appLaunchPhases(phone.serial, bundle, opts.env))
      : undefined;
    const samples = await sampleLaunches(opts.repeats, {
      prepare: async () => {
        if (opts.mode === 'cold') await phone.terminate(bundle);
        else await phone.ctl.launch('com.apple.Preferences').catch(() => undefined);
      },
      launch: async () => {
        const t = performance.now();
        if (opts.env) {
          await phone.ctl.launch(bundle, undefined, opts.env);
          await phone.target(bundle);
        } else await phone.launch(bundle);
        await untilShown(bundle, () => phone.appShown(bundle), t);
        return Math.round(performance.now() - t);
      },
    });
    return {
      value: {
        mode: opts.mode,
        samples: samples.map((totalMs) => ({ totalMs })),
        medianMs: lowerMedian(samples),
        until: 'the first screen is read',
        ...(startup && { startup: { startupType: opts.mode, ...startup } }),
      },
      raw: samples.join(' '),
      at: now(),
    };
  }

  /** The main thread's hangs (over 250 ms) while `during` runs: part of the Time Profiler's recording. */
  async hangsOf(bundle: string, seconds = 5, during?: () => Promise<unknown>, symbols?: Symbols) {
    const { trace, pid, samples } = await this.profile(bundle, seconds * 1000, during, symbols);
    const hangs = await traceTable(trace, 'potential-hangs');
    return {
      ...parseHangs(hangs, pid),
      causes: parseHangCauses(hangs, samples, pid),
      tracePath: trace,
    };
  }

  async hangs(bundle: string, seconds: number, during?: () => Promise<unknown>, symbols?: Symbols) {
    const value = await this.hangsOf(bundle, seconds, during, symbols);
    return {
      value,
      raw: value.tracePath,
      at: now(),
      source: 'xctrace Time Profiler potential-hangs',
    };
  }

  async network(bundle: string, windowMs: number, during?: () => Promise<unknown>) {
    await this.phone.inFront(bundle);
    return phoneNetwork(
      this.phone.serial,
      bundle,
      () => this.phone.ctl.pid(bundle),
      windowMs,
      during,
    );
  }

  async energy(bundle: string, windowMs: number) {
    await this.phone.inFront(bundle);
    return phoneEnergy(this.phone.serial, bundle, () => this.phone.ctl.pid(bundle), windowMs);
  }

  exits = (bundle: string, since?: number) => crashExits(this.phone.crashes, bundle, since);

  async heap(bundle: string, dir: string) {
    await this.phone.inFront(bundle);
    return phoneLeaks(this.phone.serial, bundle, () => this.phone.ctl.pid(bundle), dir);
  }

  async size(_bundle: string): Promise<never> {
    throw new DeviceError(
      'UNSUPPORTED',
      "devicectl lists no size of an app, and a phone's app bundle cannot be read from the Mac",
    );
  }

  /** A Release build signed for development has the debugger's entitlement too, and its bundle cannot be read here. */
  async buildType(bundle: string) {
    const app = await this.phone.ctl.app(bundle);
    return app?.builtByDeveloper === false ? ('release' as const) : ('unknown' as const);
  }

  xctMetrics = (bundle: string, test: 'launch' | 'hitches') => this.phone.xctMetrics(bundle, test);
}
