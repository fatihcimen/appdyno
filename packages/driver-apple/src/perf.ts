import { execFile } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DeviceError } from '@appdyno/protocol';
import type {
  CpuProfile,
  HeapReading,
  LaunchReading,
  Measured,
  MeasureSource,
  MemoryReading,
  ProfileEntry,
} from '@appdyno/core';
import { assertBundle, type Simctl } from './simctl.js';

const run = promisify(execFile);
const at = () => new Date().toISOString();

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
 * a CPU profile (the Mac's sampler).
 */
export class IosSimulatorPerf implements MeasureSource {
  readonly virtual = true;

  constructor(
    private readonly udid: string,
    private readonly simctl: Simctl,
    /** Reads the screen once; true when the app's window shows content. */
    private readonly appShown: (bundle: string) => Promise<boolean>,
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

  /** Time from the launch request until the app's screen first reads with content; median of `repeats`. */
  async launch(
    bundle: string,
    opts: { mode?: 'cold' | 'warm'; repeats?: number } = {},
  ): Promise<Measured<IosLaunch>> {
    assertBundle(bundle);
    const mode = opts.mode ?? 'cold';
    const repeats = Math.min(Math.max(opts.repeats ?? 5, 1), 10);
    const samples: number[] = [];
    const raw: string[] = [];
    for (let i = 0; i < repeats + 1; i++) {
      if (mode === 'cold') await this.simctl.terminate(this.udid, bundle);
      else
        await this.simctl
          .exec(['launch', this.udid, 'com.apple.Preferences'])
          .catch(() => undefined);
      await new Promise((r) => setTimeout(r, 500));
      const t = performance.now();
      raw.push(await this.simctl.exec(['launch', this.udid, bundle]));
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
        until: 'the first screen is read',
      },
      raw: raw.join('\n'),
      at: at(),
    };
  }

  /** The Mac's sampler on the app for `durationMs`; `during` runs while it samples. */
  async cpuProfile(
    bundle: string,
    durationMs = 3_000,
    during?: () => Promise<unknown>,
  ): Promise<Measured<CpuProfile & { appTop: ProfileEntry[] }>> {
    const pid = await this.pid(bundle);
    const s = Math.min(Math.max(Math.round(durationMs / 1000), 1), 30);
    const rec = run('sample', [String(pid), String(s), '-mayDie'], {
      timeout: (s + 60) * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (during) await during();
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
