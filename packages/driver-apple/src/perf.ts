import {
  sleep,
  type MeasureSource,
  type Measured,
  type XctMetrics,
  type MemoryReading,
  run,
  stateDir,
  type FrameStats,
  type FrameTrace,
  type NetworkReading,
  type SizeReading,
  type BuildType,
  type LaunchMode,
  type CpuProfile,
  type ProfileEntry,
  callSignal,
  type HeapReading,
  type EnergyReading,
  type StartupAnalysis,
} from '@appdyno/core';
import { existsSync } from 'node:fs';
import { readdir, lstat, readFile, mkdir, rm, appendFile, writeFile } from 'node:fs/promises';
import { join, relative, sep, dirname } from 'node:path';
import { DeviceError } from '@appdyno/protocol';
import { probeHead, probeWindow, probeFrames, probeSummary, PROBE_LIMITS } from './probe.js';
import { crashExits, simulatorCrashes } from './crashes.js';
import { nettopBytes } from './sim-network.js';
import { simulatorEnergy } from './sim-energy.js';
import { memoryGraph } from './sim-heap.js';
import { profileStart } from './sim-launch.js';
import { type Simctl, assertBundle } from './simctl.js';
import { helperBinary } from './simhelper.js';
import { parseTimeProfile } from './trace-parse.js';
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

/** The probe's file shows what happened only after its next write (every 250 ms). */
const PROBE_FLUSH_MS = 350;

/** A bundle on disk: its bytes, its folders apart and the rest of its files together. */
export async function bundleSize(
  app: string,
): Promise<{ bytes: number; parts: Record<string, number> }> {
  const parts: Record<string, number> = {};
  let bytes = 0;
  for (const e of await readdir(app, { recursive: true, withFileTypes: true })) {
    if (e.isDirectory()) continue;
    const path = join(e.parentPath, e.name);
    const { size } = await lstat(path);
    const [top, ...rest] = relative(app, path).split(sep);
    const part = rest.length ? top! : 'files';
    parts[part] = (parts[part] ?? 0) + size;
    bytes += size;
  }
  return { bytes, parts };
}

/** A launch that really took place: of two in the middle, the lower. */
const lowerMedian = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : 0;
};

/**
 * Performance of an app on a simulator, measured from the Mac (a simulator app is a Mac process):
 * memory (physical footprint), CPU over a window, launch time (until the app's first screen reads),
 * a CPU profile (the Mac's sampler), network bytes, its bundle, and frames through the frame probe.
 */
export class IosSimulatorPerf implements MeasureSource {
  constructor(
    private readonly udid: string,
    private readonly simctl: Simctl,
    /** Reads the screen once; true when the app's window shows content. */
    private readonly appShown: (bundle: string) => Promise<boolean>,
    /** XCTest's `measure()` in a test of its own, on this simulator. */
    readonly xctMetrics?: (
      bundle: string,
      test: 'launch' | 'hitches',
    ) => Promise<Measured<XctMetrics>>,
  ) {}

  /** The app's process id (it must be running). */
  async pid(bundle: string): Promise<number> {
    assertBundle(bundle);
    const out = await this.simctl.exec(['spawn', this.udid, 'launchctl', 'list']);
    // a process just ended stays listed for a while, with no pid, beside the one that runs now
    const pid = out
      .split('\n')
      .filter((l) => l.includes(`UIKitApplication:${bundle}[`))
      .map((l) => Number(l.trim().split(/\s+/)[0]))
      .find((n) => Number.isInteger(n) && n > 0);
    if (!pid) throw new DeviceError('APP_NOT_RUNNING', `${bundle} is not running`);
    return pid;
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

  private probeFile(bundle: string) {
    return join(stateDir(), 'probes', `${this.udid}-${assertBundle(bundle)}.jsonl`);
  }

  /** Whether the app's running process is the one writing the probe's file. */
  private async probed(bundle: string): Promise<boolean> {
    const text = await readFile(this.probeFile(bundle), 'utf8').catch(() => '');
    const { pid } = probeHead(text);
    return pid !== undefined && pid === (await this.pid(bundle).catch(() => undefined));
  }

  private async requireProbe(bundle: string) {
    if (!(await this.probed(bundle)))
      throw new DeviceError(
        'UNSUPPORTED',
        `${bundle} runs without the frame probe`,
        'leave `probe` on: it relaunches the app with the probe in it',
      );
  }

  /** The app started afresh with the probe in it; the time its process took to its first frame. */
  private async launchProbed(bundle: string, vars: Record<string, string> = {}): Promise<number> {
    const file = this.probeFile(bundle);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await this.simctl.terminate(this.udid, bundle);
    await rm(file, { force: true });
    const out = await this.simctl.launch(this.udid, bundle, {
      DYLD_INSERT_LIBRARIES: await helperBinary('SimProbe'),
      APPDYNO_PROBE_OUT: file,
      ...vars,
    });
    const pid = Number(/:\s*(\d+)/.exec(out)?.[1]);
    for (const end = Date.now() + 20_000; Date.now() < end; await sleep(50)) {
      const head = probeHead(await readFile(file, 'utf8').catch(() => ''));
      if (head.pid === pid && head.launchMs !== undefined) return head.launchMs;
    }
    throw new DeviceError(
      'UNSUPPORTED',
      `the frame probe in ${bundle} reported no first frame within 20 s`,
      `its file is at ${file}`,
    );
  }

  /** Relaunches the app with the frame probe unless it runs under it already: true if it did. */
  async attachProbe(bundle: string): Promise<boolean> {
    if (await this.probed(bundle)) return false;
    await this.launchProbed(bundle);
    return true;
  }

  /** Where a start's time went: one start under the probe by its phases, one from its first instruction profiled. */
  private async whySlow(bundle: string, env?: Record<string, string>): Promise<StartupAnalysis> {
    await this.launchProbed(bundle, env);
    const file = this.probeFile(bundle);
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

  exits(bundle: string) {
    return crashExits((q) => simulatorCrashes(this.udid, q), bundle);
  }

  /** What this Mac counts for the app's process: its energy, not a phone's. */
  async energy(bundle: string, windowMs: number): Promise<Measured<EnergyReading>> {
    return simulatorEnergy(await this.pid(bundle), windowMs);
  }

  async resetFrames(bundle: string): Promise<void> {
    await this.requireProbe(bundle);
    await appendFile(this.probeFile(bundle), `${JSON.stringify({ reset: Date.now() })}\n`);
  }

  /** The frames since the last reset, or since the app started under the probe. */
  async frames(bundle: string, opts: { reset?: boolean } = {}): Promise<Measured<FrameStats>> {
    await this.requireProbe(bundle);
    const to = Date.now();
    await sleep(PROBE_FLUSH_MS);
    const text = await readFile(this.probeFile(bundle), 'utf8');
    const head = probeHead(text);
    const from = head.resetAt ?? head.loadedAt!;
    const raw = probeWindow(text, from, to);
    if (opts.reset) await this.resetFrames(bundle);
    return { value: probeFrames(raw, from, to), raw, at: at() };
  }

  /** The probe's lines for a window of `seconds`, and `during` too if it takes longer. */
  async frameTrace(
    bundle: string,
    seconds: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<FrameTrace>> {
    await this.requireProbe(bundle);
    const from = Date.now();
    await Promise.all([during?.(), sleep(seconds * 1000)]);
    const to = Date.now();
    await sleep(PROBE_FLUSH_MS);
    const raw = probeWindow(await readFile(this.probeFile(bundle), 'utf8'), from, to);
    const dir = join(stateDir(), 'traces');
    await mkdir(dir, { recursive: true });
    const tracePath = join(dir, `probe-${to}.jsonl`);
    await writeFile(tracePath, `${raw}\n`);
    return {
      value: { kind: 'probe', tracePath, ...probeSummary(raw, from, to) },
      raw: tracePath,
      at: at(),
      source: 'CADisplayLink probe',
    };
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
      env?: Record<string, string>;
    } = {},
  ): Promise<Measured<IosLaunch>> {
    assertBundle(bundle);
    const mode = opts.mode ?? 'cold';
    const repeats = Math.min(Math.max(opts.repeats ?? 5, 1), 10);
    const samples: number[] = [];
    const raw: string[] = [];
    const probe = mode === 'cold' && opts.probe === true;
    const startup = opts.trace ? await this.whySlow(bundle, opts.env) : undefined;
    for (let i = 0; i < repeats + 1; i++) {
      if (mode === 'cold') await this.simctl.terminate(this.udid, bundle);
      else
        await this.simctl
          .exec(['launch', this.udid, 'com.apple.Preferences'])
          .catch(() => undefined);
      await sleep(500);
      if (probe) {
        const ms = Math.round(await this.launchProbed(bundle, opts.env));
        raw.push(String(ms));
        if (i > 0) samples.push(ms); // the first warms up
        continue;
      }
      const t = performance.now();
      raw.push(await this.simctl.launch(this.udid, bundle, opts.env));
      const end = t + 20_000;
      while (!(await this.appShown(bundle))) {
        if (performance.now() > end)
          throw new DeviceError('TIMEOUT', `${bundle} showed no screen within 20 s`);
      }
      if (i > 0) samples.push(Math.round(performance.now() - t)); // the first warms up
    }
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
  ): Promise<Measured<CpuProfile & { appTop: ProfileEntry[] }>> {
    const pid = await this.pid(bundle);
    const s = Math.min(Math.max(Math.round(durationMs / 1000), 1), 30);
    let ran = false;
    const once = during && (() => ((ran = true), during()));
    const traced = await recordTrace({
      template: 'Time Profiler',
      device: this.udid,
      attach: async () => pid,
      seconds: s,
      dir: join(stateDir(), 'traces'),
      ...(once && { during: once }),
    }).then(
      async (trace) => {
        const xml = await traceTable(trace, 'time-profile');
        return { trace, profile: parseTimeProfile(xml) };
      },
      () => undefined,
    );
    if (traced && traced.profile.samples > 0)
      return {
        value: { ...traced.profile, durationMs: s * 1000 },
        raw: traced.trace,
        at: at(),
      };
    const rec = run('sample', [String(pid), String(s), '-mayDie'], {
      timeout: (s + 60) * 1000,
      maxBuffer: 64 * 1024 * 1024,
      ...(callSignal() && { signal: callSignal()! }),
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
