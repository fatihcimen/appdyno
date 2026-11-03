import { callSignal } from '@appdyno/core';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { DeviceError } from '@appdyno/protocol';
import type {
  BuildType,
  CpuProfile,
  FrameStats,
  FrameTrace,
  HeapReading,
  LaunchMode,
  LaunchReading,
  Measured,
  MeasureSource,
  MemoryReading,
  NetworkReading,
  ProfileEntry,
  SizeReading,
  XctMetrics,
} from '@appdyno/core';
import { stateDir } from '@appdyno/core';
import { probeFrames, probeHead, probeSummary, probeWindow } from './probe.js';
import { assertBundle, type Simctl } from './simctl.js';
import { helperBinary } from './simhelper.js';
import { parseTimeProfile, recordTrace, traceTable } from './trace.js';

const run = promisify(execFile);
const at = () => new Date().toISOString();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The probe's file shows what happened only after its next write (every 250 ms). */
const PROBE_FLUSH_MS = 350;

/** The app's first and last counts of `nettop -L`: what it has before the first are not the window's. */
export function parseNettop(csv: string): { rxBytes: number; txBytes: number } {
  const samples = csv
    .split(/^,bytes_in,bytes_out,\s*$/m)
    .slice(1)
    .map((s) => /^.+\.\d+,(\d+),(\d+),/m.exec(s));
  const count = (m: RegExpExecArray | null | undefined, i: 1 | 2) => Number(m?.[i] ?? 0);
  const first = samples[0];
  const last = samples.findLast((s) => s);
  return {
    rxBytes: count(last, 1) - count(first, 1),
    txBytes: count(last, 2) - count(first, 2),
  };
}

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

/** A simulator app's memory: its physical footprint as the Mac's memory tool counts it. */
export type IosMemory = { footprintKb: number; peakKb?: number };
export type IosCpu = { percent: number; windowMs: number; cpuMs: number };
export type IosHeap = { file: string; bytes: number; leaks?: number; leakedBytes?: number };

/** "Process 4242: 3 leaks for 192 total leaked bytes." */
export function parseLeaks(out: string): { leaks?: number; leakedBytes?: number } {
  const m = /:\s+(\d+) leaks? for (\d+) total leaked bytes/.exec(out);
  return m ? { leaks: Number(m[1]), leakedBytes: Number(m[2]) } : {};
}

export type IosLaunch = LaunchReading & {
  repeats: number;
  samplesMs: number[];
  medianMs: number;
};

/** "Physical footprint:  52.3M" (and the peak) from the memory tool's summary. */
export function parseFootprint(out: string): IosMemory | undefined {
  const size = (s: string) => {
    const m = /^([\d.]+)\s*([KMG])?/i.exec(s.trim());
    if (!m) return undefined;
    const k = { K: 1, M: 1024, G: 1024 * 1024 }[(m[2] ?? 'K').toUpperCase() as 'K' | 'M' | 'G'];
    return Math.round(Number(m[1]) * k);
  };
  // the memory tool ("Footprint: 52 MB") or the region map ("Physical footprint: 52.3M")
  const now =
    /\bFootprint:\s+([\d.]+\s*[KMG]?)/.exec(out)?.[1] ??
    /^Physical footprint:\s+(\S+)/m.exec(out)?.[1];
  const peak = /^Physical footprint \(peak\):\s+(\S+)/m.exec(out)?.[1];
  const kb = now ? size(now) : undefined;
  if (kb === undefined) return undefined;
  const p = peak ? size(peak) : undefined;
  return { footprintKb: kb, ...(p !== undefined && { peakKb: p }) };
}

/** `ps -o time=` (cumulative CPU, [[hh:]mm:]ss.cc) in ms. */
export function parseCpuTime(s: string): number {
  const parts = s.trim().split(':').map(Number);
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return Math.round(secs * 1000);
}

/** Kernel waits: where idle threads sit, never where the app spends its time. */
const IDLE =
  /^(mach_msg2?_trap|mach_msg_overwrite|__workq_kernreturn|__psynch_cvwait|__semwait_signal|kevent\w*|__ulock_wait2?|__sigsuspend|__select|poll|__psynch_mutexwait|semaphore_wait_trap|__wait4|read|__recvfrom)$/;

/** The "Sort by top of stack" section of a sample report: the busiest functions, idle waits left out. */
export function parseSampleTop(
  report: string,
  limit = 10,
): { samples: number; top: ProfileEntry[] } {
  const start = report.indexOf('Sort by top of stack');
  if (start < 0) return { samples: 0, top: [] };
  const rows: { symbol: string; samples: number }[] = [];
  for (const line of report.slice(start).split('\n').slice(1)) {
    const m =
      /^\s+(.+?)\s+\(in [^)]+\)\s+(\d+)\s*$/.exec(line) ?? /^\s+(\S.*?)\s+(\d+)\s*$/.exec(line);
    if (!m) {
      if (rows.length > 0 && line.trim() === '') break;
      continue;
    }
    rows.push({ symbol: m[1]!.trim(), samples: Number(m[2]) });
  }
  const busy = rows.filter((r) => !IDLE.test(r.symbol));
  const total = busy.reduce((a, r) => a + r.samples, 0);
  return {
    samples: total,
    top: busy
      .sort((a, b) => b.samples - a.samples)
      .slice(0, limit)
      .map((r) => ({
        symbol: r.symbol,
        samples: r.samples,
        percent: total ? Math.round((r.samples / total) * 1000) / 10 : 0,
      })),
  };
}

/**
 * The app's own functions by busy inclusive samples: the call graph's count at the function minus what
 * its callees spent waiting idle. Where the app's time goes even when a debug build spends it in
 * runtime helpers; idle threads (a main thread waiting for events) do not count.
 */
export function parseSampleApp(report: string, limit = 10): ProfileEntry[] {
  const exe = /^Path:\s+(.+)$/m.exec(report)?.[1]?.trim().split('/').pop();
  const start = report.indexOf('Call graph:');
  if (!exe || start < 0) return [];
  const own = new Set([exe, `${exe}.debug.dylib`]);
  const end = report.indexOf('Total number in stack');
  type N = { depth: number; count: number; symbol: string; image: string; kids: N[] };
  const roots: N[] = [];
  const stack: N[] = [];
  for (const line of report
    .slice(start, end < 0 ? undefined : end)
    .split('\n')
    .slice(1)) {
    const m = /^([\s+!:|]*?)(\d+)\s+(.+?)(?:\s+\(in ([^)]+)\))?(?:\s+\+\s+\d+.*)?$/.exec(line);
    if (!m) continue;
    const node: N = {
      depth: m[1]!.length,
      count: Number(m[2]),
      symbol: m[3]!.trim(),
      image: m[4] ?? '',
      kids: [],
    };
    while (stack.length && stack[stack.length - 1]!.depth >= node.depth) stack.pop();
    (stack.length ? stack[stack.length - 1]!.kids : roots).push(node);
    stack.push(node);
  }
  const busyOf = new Map<N, number>();
  const busy = (n: N): number => {
    const kids = n.kids.reduce((a, k) => a + k.count, 0);
    const self = Math.max(0, n.count - kids);
    const v = (IDLE.test(n.symbol) ? 0 : self) + n.kids.reduce((a, k) => a + busy(k), 0);
    busyOf.set(n, v);
    return v;
  };
  const total = roots.reduce((a, r) => a + busy(r), 0);
  const counts = new Map<string, number>();
  for (const [n, v] of busyOf)
    if (own.has(n.image)) counts.set(n.symbol, Math.max(counts.get(n.symbol) ?? 0, v));
  return [...counts]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([symbol, samples]) => ({
      symbol,
      samples,
      percent: total ? Math.round((samples / total) * 1000) / 10 : 0,
    }));
}

const median = (xs: number[]) => {
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
    const line = out.split('\n').find((l) => l.includes(`UIKitApplication:${bundle}[`));
    const pid = Number(line?.trim().split(/\s+/)[0]);
    if (!Number.isInteger(pid) || pid <= 0)
      throw new DeviceError('APP_NOT_RUNNING', `${bundle} is not running`);
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
    await new Promise((r) => setTimeout(r, windowMs));
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
        'opt in with `probe: true`: it relaunches the app with the probe in it',
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
    for (const end = Date.now() + 20_000; Date.now() < end; await pause(50)) {
      const head = probeHead(await readFile(file, 'utf8').catch(() => ''));
      if (head.pid === pid && head.launchMs !== undefined) return head.launchMs;
    }
    throw new DeviceError(
      'UNSUPPORTED',
      `the frame probe in ${bundle} reported no first frame within 20 s`,
      `its file is at ${file}`,
    );
  }

  /** Relaunches the app with the frame probe unless it runs under it already. */
  async attachProbe(bundle: string): Promise<void> {
    if (!(await this.probed(bundle))) await this.launchProbed(bundle);
  }

  async resetFrames(bundle: string): Promise<void> {
    await this.requireProbe(bundle);
    await appendFile(this.probeFile(bundle), `${JSON.stringify({ reset: Date.now() })}\n`);
  }

  /** The frames since the last reset, or since the app started under the probe. */
  async frames(bundle: string, opts: { reset?: boolean } = {}): Promise<Measured<FrameStats>> {
    await this.requireProbe(bundle);
    const to = Date.now();
    await pause(PROBE_FLUSH_MS);
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
    await Promise.all([during?.(), pause(seconds * 1000)]);
    const to = Date.now();
    await pause(PROBE_FLUSH_MS);
    const raw = probeWindow(await readFile(this.probeFile(bundle), 'utf8'), from, to);
    const dir = join(stateDir(), 'traces');
    await mkdir(dir, { recursive: true });
    const tracePath = join(dir, `probe-${to}.jsonl`);
    await writeFile(tracePath, `${raw}\n`);
    return {
      value: { kind: 'probe', tracePath, ...probeSummary(raw, from, to) },
      raw: tracePath,
      at: at(),
    };
  }

  /** The bytes of the app's sockets, counted by the Mac (a simulator app is a Mac process). */
  async network(
    bundle: string,
    windowMs: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<NetworkReading>> {
    const pid = await this.pid(bundle);
    const seconds = Math.max(Math.ceil(windowMs / 1000), 1);
    // into a pipe it says nothing until it ends by itself, and a signal loses what it holds
    const nettop = run(
      'nettop',
      [
        '-P',
        '-x',
        '-n',
        '-L',
        String(seconds + 2),
        '-s',
        '1',
        '-J',
        'bytes_in,bytes_out',
        '-p',
        String(pid),
      ],
      { timeout: (seconds + 30) * 1000 },
    ).catch((e: Error) => {
      throw new DeviceError('UNSUPPORTED', `nettop: ${e.message.slice(0, 200)}`);
    });
    // its first sample, what counts from: `during` starts after it
    const [{ stdout: raw }] = await Promise.all([nettop, pause(1_000).then(() => during?.())]);
    return {
      value: {
        // from its first sample to its last
        windowMs: (seconds + 1) * 1000,
        ...parseNettop(raw),
        note: "The app's own sockets, as the Mac's nettop counts them, loopback included.",
      },
      raw,
      at: at(),
    };
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
    opts: { mode?: LaunchMode; repeats?: number; env?: Record<string, string> } = {},
  ): Promise<Measured<IosLaunch>> {
    assertBundle(bundle);
    const mode = opts.mode ?? 'cold';
    const repeats = Math.min(Math.max(opts.repeats ?? 5, 1), 10);
    const samples: number[] = [];
    const raw: string[] = [];
    const probe = mode === 'cold' && (await this.probed(bundle));
    for (let i = 0; i < repeats + 1; i++) {
      if (mode === 'cold') await this.simctl.terminate(this.udid, bundle);
      else
        await this.simctl
          .exec(['launch', this.udid, 'com.apple.Preferences'])
          .catch(() => undefined);
      await new Promise((r) => setTimeout(r, 500));
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
        medianMs: median(samples),
        until: probe ? 'first frame (probe)' : 'the first screen is read',
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
   * A memory graph of the app (the Mac's leaks tool), saved at `path` for Xcode's memory graph viewer,
   * and the leaks it found. The file stays on this machine.
   */
  async heapGraph(bundle: string, path: string): Promise<Measured<IosHeap>> {
    const pid = await this.pid(bundle);
    // leaks exits 1 when it found leaks: its answer, not a failure
    const r = await run('leaks', [`--outputGraph=${path}`, String(pid)], {
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
    }).catch((e: { stdout?: string; code?: number }) => {
      if (e.code === 1 && e.stdout) return { stdout: e.stdout };
      throw new DeviceError('UNSUPPORTED', `no memory graph of ${bundle}`);
    });
    const { size } = await stat(path);
    // with a graph written the tool prints no summary: the saved graph is read again, offline
    const summary = await run('leaks', [path], {
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
    }).then(
      (x) => x.stdout,
      (e: { stdout?: string }) => e.stdout ?? '',
    );
    return {
      value: { file: path, bytes: size, ...parseLeaks(summary) },
      raw: `${r.stdout}\n---\n${summary}`,
      at: at(),
    };
  }
}
