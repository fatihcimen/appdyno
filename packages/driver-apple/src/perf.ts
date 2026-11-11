import {
  cannot,
  sleep,
  type MeasureSource,
  type Measured,
  type XctMetrics,
  type MemoryReading,
  run,
  tracesDir,
  type NetworkReading,
  type SizeReading,
  type BuildType,
  type CompileMode,
  type LaunchMode,
  type CpuProfile,
  type ProfileEntry,
  type Symbols,
  callSignal,
  type HeapReading,
  type EnergyReading,
  type StartupAnalysis,
} from '@appdyno/core';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DeviceError } from '@appdyno/protocol';
import { bundleSize } from './bundle-size.js';
import { probeHead, PROBE_LIMITS } from './probe.js';
import { crashExits, simulatorCrashes } from './crashes.js';
import { nettopBytes } from './sim-network.js';
import { simulatorEnergy } from './sim-energy.js';
import { ProbedFrames } from './sim-frames.js';
import { memoryGraph } from './sim-heap.js';
import { profileStart } from './sim-launch.js';
import { type Simctl, assertBundle } from './simctl.js';
import { IosPerf, lowerMedian, sampleLaunches, untilShown } from './ios-perf.js';
import { parseTimeProfile } from './trace-parse.js';
import { nameFrames } from './frame-names.js';
import { recordTrace, traceTable } from './trace.js';
import {
  type IosMemory,
  parseFootprint,
  type IosCpu,
  parseCpuTime,
  type IosLaunch,
  parseSampleTop,
  parseSampleApp,
  type IosHeap,
} from './perf-parse.js';

const at = () => new Date().toISOString();

/**
 * Performance of an app on a simulator, measured from the Mac (a simulator app is a Mac process):
 * memory (physical footprint), CPU over a window, launch time (until the app's first screen reads),
 * a CPU profile (the Mac's sampler), network bytes, its bundle, and frames through the frame probe.
 */
export class IosSimulatorPerf extends IosPerf implements MeasureSource {
  readonly slowReads = [];
  readonly framesByProbe = true;
  vitals = cannot('the device state');
  hangs = cannot('hangs');
  private readonly probe: ProbedFrames;

  constructor(
    private readonly udid: string,
    private readonly simctl: Simctl,
    /** Reads the screen once; true when the app's window shows content. */
    private readonly appShown: (bundle: string) => Promise<boolean>,
    /** XCTest's `measure()` in a test of its own, on this simulator. */
    readonly xctMetrics: (
      bundle: string,
      test: 'launch' | 'hitches',
    ) => Promise<Measured<XctMetrics>>,
  ) {
    super();
    this.probe = new ProbedFrames(udid, simctl, (bundle) => this.pid(bundle));
  }

  /** The app's process id (it must be running). */
  pid(bundle: string) {
    return this.simctl.pid(this.udid, bundle);
  }

  async memory(bundle: string): Promise<Measured<IosMemory & MemoryReading>> {
    const pid = await this.pid(bundle);
    const { stdout } = await run('footprint', [String(pid)], {
      timeout: 30_000,
    }).catch(() => run('vmmap', ['--summary', String(pid)], { timeout: 60_000 }));
    const value = parseFootprint(stdout);
    if (!value) throw new DeviceError('UNSUPPORTED', `no memory reading for ${bundle}`);
    return {
      value: { ...value, kb: value.footprintKb, kind: 'footprint' },
      raw: stdout,
      at: at(),
    };
  }

  async cpu(bundle: string, windowMs = 2_000): Promise<Measured<IosCpu>> {
    const pid = await this.pid(bundle);
    const time = async () =>
      parseCpuTime((await run('ps', ['-o', 'time=', '-p', String(pid)])).stdout);
    const t0 = performance.now();
    const c0 = await time();
    await sleep(windowMs);
    const c1 = await time();
    const wall = performance.now() - t0;
    const cpuMs = c1 - c0;
    return {
      value: { percent: Math.round((cpuMs / wall) * 100), windowMs: Math.round(wall), cpuMs },
      raw: `${c0} ${c1}`,
      at: at(),
    };
  }

  /** Relaunches the app with the frame probe unless it runs under it already: true if it did. */
  attachProbe(bundle: string) {
    return this.probe.attach(bundle);
  }

  /** Where a start's time went: one start under the probe by its phases, one from its first instruction profiled. */
  private async whySlow(bundle: string, env?: Record<string, string>): Promise<StartupAnalysis> {
    await this.probe.launch(bundle, env);
    const file = this.probe.file(bundle);
    const phases = probeHead(await readFile(file, 'utf8')).phases ?? {};
    const breakdown = Object.entries(phases).map(([reason, ms]) => ({ reason, ms }));
    const top = await profileStart(this.udid, this.simctl, bundle, env).catch(() => []);
    return {
      tracePath: file,
      startupType: 'cold',
      durMs: Math.round(breakdown.reduce((a, b) => a + b.ms, 0)),
      reasons: [],
      breakdown,
      findings: [
        PROBE_LIMITS,
        ...(top.length
          ? [`busiest in the start: ${top.map((t) => `${t.symbol} ${t.percent}%`).join(', ')}`]
          : []),
      ],
    };
  }

  exits(bundle: string, since?: number) {
    return crashExits((q) => simulatorCrashes(this.udid, q), bundle, since);
  }

  /** What this Mac counts for the app's process: its energy, not a phone's. */
  async energy(bundle: string, windowMs: number): Promise<Measured<EnergyReading>> {
    return simulatorEnergy(await this.pid(bundle), windowMs);
  }

  resetFrames(bundle: string) {
    return this.probe.reset(bundle);
  }

  frames(bundle: string, opts?: { reset?: boolean; since?: number }) {
    return this.probe.frames(bundle, opts);
  }

  framesDuring(bundle: string, _seconds: number, during: () => Promise<unknown>) {
    return this.probe.during(bundle, during);
  }

  frameTrace(bundle: string, seconds: number, during?: () => Promise<unknown>) {
    return this.probe.trace(bundle, seconds, during);
  }

  frameMarks(bundle: string, seconds: number, during: () => Promise<unknown>) {
    return this.probe.marks(bundle, seconds, during);
  }

  /** The bytes of the app's sockets, counted by the Mac (a simulator app is a Mac process). */
  async network(
    bundle: string,
    windowMs: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<NetworkReading>> {
    return nettopBytes(await this.pid(bundle), windowMs, during);
  }

  /** The app's bundle on disk: a simulator build, not what a user downloads. */
  async size(bundle: string): Promise<Measured<SizeReading>> {
    const size = await bundleSize(await this.simctl.appContainer(this.udid, bundle));
    return {
      value: {
        ...size,
        note: 'The bundle of a simulator build on disk, not what a user downloads.',
      },
      raw: JSON.stringify(size),
      at: at(),
    };
  }

  /** A debug dylib beside the executable or the debugger's entitlement says debug. */
  async buildType(bundle: string): Promise<BuildType> {
    try {
      const app = await this.simctl.appContainer(this.udid, bundle);
      const exe = (
        await run('plutil', ['-extract', 'CFBundleExecutable', 'raw', join(app, 'Info.plist')])
      ).stdout.trim();
      if (existsSync(join(app, `${exe}.debug.dylib`))) return 'debug';
      const ent = await run('codesign', ['-d', '--entitlements', '-', '--xml', app]);
      return ent.stdout.includes('get-task-allow') ? 'debug' : 'release';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Time from the launch request until the app's screen first reads with content, or, for a cold start of
   * an app already under the frame probe, from its process start to its first frame; median of `repeats`.
   */
  async launch(
    bundle: string,
    opts: {
      mode?: LaunchMode;
      repeats?: number;
      trace?: boolean;
      probe?: boolean;
      compile?: CompileMode;
      env?: Record<string, string>;
    } = {},
  ): Promise<Measured<IosLaunch>> {
    this.noCompileState(opts);
    assertBundle(bundle);
    const mode = opts.mode ?? 'cold';
    const repeats = Math.min(Math.max(opts.repeats ?? 5, 1), 10);
    const raw: string[] = [];
    const probe = mode === 'cold' && opts.probe === true;
    const startup = opts.trace ? await this.whySlow(bundle, opts.env) : undefined;
    const samples = await sampleLaunches(repeats, {
      prepare: async () => {
        if (mode === 'cold') await this.simctl.terminate(this.udid, bundle);
        else
          await this.simctl
            .exec(['launch', this.udid, 'com.apple.Preferences'])
            .catch(() => undefined);
      },
      launch: async () => {
        if (probe) {
          const ms = Math.round(await this.probe.launch(bundle, opts.env));
          raw.push(String(ms));
          return ms;
        }
        const t = performance.now();
        raw.push(await this.simctl.launch(this.udid, bundle, opts.env));
        await untilShown(bundle, () => this.appShown(bundle), t);
        return Math.round(performance.now() - t);
      },
    });
    return {
      value: {
        mode,
        repeats,
        samplesMs: samples,
        samples: samples.map((totalMs) => ({ totalMs })),
        medianMs: lowerMedian(samples),
        until: probe ? 'first frame (probe)' : 'the first screen is read',
        ...(startup && { startup }),
      },
      raw: raw.join('\n'),
      at: at(),
    };
  }

  /**
   * Xcode's Time Profiler on the app for `durationMs` (`sample` sees no busy samples of a simulator app
   * under macOS 27); `during` runs while it records. `sample` stays for a Mac where the tool cannot
   * attach.
   */
  async cpuProfile(
    bundle: string,
    durationMs = 3_000,
    during?: () => Promise<unknown>,
    symbols?: Symbols,
  ): Promise<Measured<CpuProfile & { appTop: ProfileEntry[] }>> {
    const pid = await this.pid(bundle);
    const s = Math.min(Math.max(Math.round(durationMs / 1000), 1), 30);
    // set inside `once`, where the compiler does not follow it
    let ran = false as boolean;
    const once = during && (() => ((ran = true), during()));
    const traced = await recordTrace({
      template: 'Time Profiler',
      device: this.udid,
      attach: () => Promise.resolve(pid),
      seconds: s,
      dir: tracesDir(),
      ...(once && { during: once }),
    }).then(
      async (trace) => {
        const xml = await traceTable(trace, 'time-profile');
        const named = symbols?.dsym ? await nameFrames(xml, symbols.dsym) : xml;
        return { trace, profile: parseTimeProfile(named) };
      },
      // another recording is no reason to sample, which would answer as empty as the trace: it is said
      (e: unknown) =>
        e instanceof DeviceError && e.code === 'DEVICE_CLAIMED' ? Promise.reject(e) : undefined,
    );
    if (traced && traced.profile.samples > 0)
      return {
        value: { ...traced.profile, durationMs: s * 1000 },
        raw: traced.trace,
        at: at(),
      };
    const signal = callSignal();
    const rec = run('sample', [String(pid), String(s), '-mayDie'], {
      timeout: (s + 60) * 1000,
      maxBuffer: 64 * 1024 * 1024,
      ...(signal && { signal }),
    });
    if (during && !ran) await during();
    const { stdout } = await rec;
    const file = /written to file (\S+)/.exec(stdout)?.[1];
    const report = file
      ? await readFile(file, 'utf8').finally(() => rm(file, { force: true }))
      : stdout;
    const { samples, top } = parseSampleTop(report);
    return {
      value: { durationMs: s * 1000, samples, top, appTop: parseSampleApp(report) },
      raw: report,
      at: at(),
    };
  }

  /** A memory graph under `dir`, with the leaks it found. */
  async heap(bundle: string, dir: string): Promise<Measured<HeapReading>> {
    const m = await this.heapGraph(bundle, join(dir, `heap-${bundle}-${Date.now()}.memgraph`));
    return { ...m, value: { ...m.value, kind: 'memgraph' } };
  }

  /**
   * A memory graph of the app, saved at `path` for Xcode's memory graph viewer, and the leaks it found. The file stays
   * on this machine.
   */
  async heapGraph(bundle: string, path: string): Promise<Measured<IosHeap>> {
    return memoryGraph(await this.pid(bundle), bundle, path);
  }
}
