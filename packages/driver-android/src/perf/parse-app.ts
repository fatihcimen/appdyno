import type {
  AnonMemory,
  DeviceVitals,
  ProcessMemoryState,
  ProfileEntry,
  ThreadReading,
  EnergyReading,
  BuildType,
} from '@appdyno/core';
import { PROFILE_FUNCTIONS } from '@appdyno/core';
import { num } from './parse-common.js';

export type MemoryStats = {
  /** TOTAL PSS: what the system charges the app. */
  pssKb: number;
  rssKb?: number;
  javaHeapKb?: number;
  nativeHeapKb?: number;
  graphicsKb?: number;
  privateDirtyKb?: number;
  /** Live objects from the Objects section: growing across rounds with no other change is a leak. */
  viewRootImpl?: number;
  appContexts?: number;
  activities?: number;
};

/** `dumpsys meminfo <pkg>`: the App Summary, the TOTAL line and the Objects section. */
export function parseMeminfo(text: string): MemoryStats {
  const pss = num(/TOTAL PSS:\s*(\d+)/, text) ?? num(/^\s*TOTAL\s+(\d+)/m, text);
  if (pss === undefined) throw new Error('no TOTAL PSS in meminfo output');
  const out: MemoryStats = { pssKb: pss };
  const opt = {
    rssKb: num(/TOTAL RSS:\s*(\d+)/, text),
    javaHeapKb: num(/^\s*Java Heap:\s*(\d+)/m, text),
    nativeHeapKb: num(/^\s*Native Heap:\s*(\d+)/m, text),
    graphicsKb: num(/^\s*Graphics:\s*(\d+)/m, text),
    // the TOTAL row of the table: Pss Total, Private Dirty, …
    privateDirtyKb: num(/^\s*TOTAL\s+\d+\s+(\d+)/m, text),
    viewRootImpl: num(/ViewRootImpl:\s*(\d+)/, text),
    appContexts: num(/AppContexts:\s*(\d+)/, text),
    activities: num(/Activities:\s*(\d+)/, text),
  };
  for (const [k, v] of Object.entries(opt)) if (v !== undefined) Object.assign(out, { [k]: v });
  return out;
}

/**
 * ActivityManager's process states, as Android vitals' memory table groups them: what is on the screen; a service the
 * user knows of; the rest of what is at work; and what is only kept in case.
 */
const stateOf = (procState: number): ProcessMemoryState => {
  if (procState <= 3) return 'foreground';
  if (procState <= 6) return 'service';
  return procState >= 16 ? 'cached' : 'background';
};

/** The lines `anonMemory` asks for: `RssAnon:`, `VmSwap:`, `MemTotal:`, `curProcState=`, `Bitmap (malloced):`. */
export function parseAnonMemory(text: string): AnonMemory {
  const rssAnonKb = num(/^RssAnon:\s*(\d+)/m, text);
  const memTotalKb = num(/^MemTotal:\s*(\d+)/m, text);
  const processState = num(/curProcState=(\d+)/, text);
  if (rssAnonKb === undefined || memTotalKb === undefined || processState === undefined)
    throw new Error('no RssAnon, MemTotal or process state in the memory read');
  const swapKb = num(/^VmSwap:\s*(\d+)/m, text) ?? 0;
  const bitmaps = ['malloced', 'nonmalloced'].flatMap(
    (name) => num(new RegExp(`Bitmap \\(${name}\\):\\s+\\d+\\s+(\\d+)`), text) ?? [],
  );
  return {
    kb: rssAnonKb + swapKb,
    rssAnonKb,
    swapKb,
    state: stateOf(processState),
    processState,
    ...(bitmaps.length && { bitmapKb: bitmaps.reduce((x, y) => x + y, 0) }),
    ramMb: Math.round(memTotalKb / 1024),
  };
}

/** utime + stime (clock ticks) of `/proc/<pid>/stat`, fields counted after the `(comm)` (which may hold spaces). */
export function parseProcStatTicks(text: string): number {
  const rest = text
    .slice(text.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/);
  const ticks = Number(rest[11]) + Number(rest[12]);
  if (!Number.isFinite(ticks)) throw new Error('no utime/stime in /proc/<pid>/stat');
  return ticks;
}

/** The share of all cores at work between two `cpu` lines of /proc/stat: idle and waiting on storage are no work. */
export function busyPercent(before: string, after: string): number | undefined {
  const fields = (l: string) => l.trim().split(/\s+/).slice(1).map(Number);
  const moved = fields(after).map((n, i) => n - (fields(before)[i] ?? NaN));
  const total = moved.reduce((a, b) => a + b, 0);
  const idle = moved[3]! + moved[4]!;
  return total > 0 && Number.isFinite(idle)
    ? Math.round((100 * (total - idle)) / total)
    : undefined;
}

/** One shell read of the device's own state (sections separated by marker lines). */
export function parseVitals(text: string): DeviceVitals {
  const section = (name: string) =>
    new RegExp(`==${name}==\\n([\\s\\S]*?)(?:\\n==|$)`).exec(text)?.[1] ?? '';
  const out: DeviceVitals = {};
  const load = section('load').trim().split(/\s+/).slice(0, 3).map(Number);
  // three zeros from a running phone are a kernel that hides its load, not a calm device: a Samsung's, with tasks running
  if (load.length === 3 && load.every(Number.isFinite) && load.some((l) => l > 0)) out.load = load;
  // a kernel thread's parent is kthreadd, process 2
  if (text.includes('==parked=='))
    out.parkedKernelThreads = [...section('parked').matchAll(/^D\S*\s+\d+\s+2\s/gm)].length;
  const pressure = num(/some avg10=([\d.]+)/, section('pressure'));
  if (pressure !== undefined) out.cpuPressure = pressure;
  const [before, after] = section('stat')
    .split('\n')
    .filter((l) => l.startsWith('cpu '));
  const busy = before && after ? busyPercent(before, after) : undefined;
  if (busy !== undefined) out.cpuBusyPercent = busy;
  const mem = section('mem');
  const avail = num(/^MemAvailable:\s*(\d+)/m, mem);
  const total = num(/^MemTotal:\s*(\d+)/m, mem);
  if (avail !== undefined) out.memAvailableKb = avail;
  if (total !== undefined) out.memTotalKb = total;
  const thermal = num(/Thermal Status:\s*(\d+)/, section('thermal'));
  if (thermal !== undefined) out.thermalStatus = thermal;
  const temp = num(/^\s*temperature:\s*(\d+)/m, section('battery'));
  if (temp !== undefined) out.batteryTempC = temp / 10;
  return out;
}

/**
 * `simpleperf report --sort symbol -n` text: the functions taking the app's CPU time, most first. Rows look
 * like `12.34%  1234  java.lang.String.indexOf`.
 */
export function parseSimpleperfReport(text: string, limit = PROFILE_FUNCTIONS): ProfileEntry[] {
  const out: ProfileEntry[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*([\d.]+)%\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ percent: Number(m[1]), samples: Number(m[2]), symbol: m[3]! });
  }
  return out.sort((a, b) => b.percent - a.percent).slice(0, limit);
}

const THREAD_LIMIT_PERCENT = 90;

/**
 * The shell loop's reads of every thread's `stat` under `/proc/<pid>/task`: a `== <ns>` line, then one stat
 * line per thread; the first line is `hz <clock ticks per second>`. A thread new since the last read started
 * from zero. `over90Ms` adds up the time above the limit, as Flashlight does.
 */
export function parseThreadReads(text: string): ThreadReading {
  const hz = num(/^hz (\d+)/m, text) || 100;
  const reads = text
    .split(/^== /m)
    .slice(1)
    .map((block) => {
      const [time, ...lines] = block.trim().split('\n');
      const ticks = new Map<number, { name: string; ticks: number }>();
      for (const line of lines) {
        const m = /^(\d+) \((.*)\) /.exec(line);
        if (m) ticks.set(Number(m[1]), { name: m[2]!, ticks: parseProcStatTicks(line) });
      }
      return { ms: Number(time) / 1e6, ticks };
    });
  const windowMs = reads.length > 1 ? Math.round(reads.at(-1)!.ms - reads[0]!.ms) : 0;
  const seen = new Map<number, { name: string; steps: { ms: number; busyMs: number }[] }>();
  reads.slice(1).forEach((read, i) => {
    const before = reads[i]!;
    for (const [tid, t] of read.ticks) {
      const busyMs = ((t.ticks - (before.ticks.get(tid)?.ticks ?? 0)) / hz) * 1000;
      const row = seen.get(tid) ?? { name: t.name, steps: [] };
      row.steps.push({ ms: read.ms - before.ms, busyMs });
      seen.set(tid, row);
    }
  });
  const high = (s?: { ms: number; busyMs: number }) =>
    s !== undefined && (s.busyMs / s.ms) * 100 > THREAD_LIMIT_PERCENT;
  const threads = [...seen]
    .map(([tid, t]) => {
      const busyMs = t.steps.reduce((a, s) => a + s.busyMs, 0);
      // the steps a busy stretch begins and ends in count for what it ran: else the 500 ms between reads
      // cut up to a read's worth from each end
      const over90Ms = t.steps.reduce((a, s, i) => {
        if (high(s)) return a + s.ms;
        return high(t.steps[i - 1]) || high(t.steps[i + 1]) ? a + s.busyMs : a;
      }, 0);
      return {
        tid,
        name: t.name,
        percent: windowMs ? Math.round((busyMs * 1000) / windowMs) / 10 : 0,
        over90Ms: Math.round(over90Ms),
      };
    })
    .sort((a, b) => b.percent - a.percent);
  return {
    windowMs,
    reads: reads.length,
    threads,
    worstOver90Ms: Math.max(0, ...threads.map((t) => t.over90Ms)),
  };
}

/** Bytes of one uid in `dumpsys netstats --uid`, every network and foreground state, tag 0 (all of it). */
export function parseNetstatsUid(text: string, uid: number): { rxBytes: number; txBytes: number } {
  let mine = false;
  let rxBytes = 0;
  let txBytes = 0;
  for (const line of text.split('\n')) {
    const head = /\buid=(-?\d+) set=\S+ tag=(\S+)/.exec(line);
    if (head) mine = Number(head[1]) === uid && head[2] === '0x0';
    const bucket = mine && /^\s*st=\d+ rb=(\d+) rp=\d+ tb=(\d+)/.exec(line);
    if (bucket) {
      rxBytes += Number(bucket[1]);
      txBytes += Number(bucket[2]);
    }
  }
  return { rxBytes, txBytes };
}

/**
 * `dumpsys batterystats --charged <pkg>`: the "Estimated power use (mAh)" section. Global `Computed drain`
 * and the app's `UID u0a193: 1.23 fg: 1.1 ( cpu=1.00 (1s 123ms) screen=0.2 )` row (no row when it drew
 * nothing). `mah` is absent when the device computes nothing at all: it has no power model.
 */
export function parseBatteryUsage(text: string, uid: number): Omit<EnergyReading, 'note'> {
  const section = /Estimated power use \(mAh\):\n([\s\S]*?)(?:\n\s*\n|$)/.exec(text)?.[1] ?? '';
  const computed = num(/Computed drain: ([\d.]+)/, section) ?? 0;
  const name = uid >= 10_000 ? `u0a${uid - 10_000}` : String(uid);
  // the parts follow on the same line, or (Android 16) on the next, then again by state
  const row = new RegExp(`^\\s*UID ${name}: ([\\d.]+)(.*)(?:\\n\\s+(\\w+=.*))?$`, 'mi').exec(
    section,
  );
  if (!row) return computed > 0 ? { mah: 0 } : {};
  const breakdown: Record<string, number> = {};
  for (const m of `${row[2]} ${row[3] ?? ''}`.matchAll(/(?:^|\s)(\w+)=([\d.]+)/g))
    breakdown[m[1]!] = Number(m[2]);
  return { mah: Number(row[1]), breakdown };
}

/** What a count since the last charge grew by; what fell (a charge reset it meanwhile) counts from zero. */
export function usageSince(
  before: Omit<EnergyReading, 'note'>,
  after: Omit<EnergyReading, 'note'>,
): Omit<EnergyReading, 'note'> {
  const grew = (a = 0, b = 0) => Math.max(0, Math.round((a - b) * 1e4) / 1e4);
  return {
    mah: grew(after.mah, before.mah),
    breakdown: Object.fromEntries(
      Object.entries(after.breakdown ?? {}).map(([k, v]) => [k, grew(v, before.breakdown?.[k])]),
    ),
  };
}

/** The flags of `dumpsys package <pkg>`. */
export function parseBuildType(text: string): BuildType {
  const flags = [...text.matchAll(/^\s*(?:pkg|private|privatePkg)?[fF]lags=\[(.*)\]/gm)].map(
    (m) => m[1]!,
  );
  if (flags.length === 0) return 'unknown';
  if (flags.some((f) => /\bDEBUGGABLE\b/.test(f))) return 'debug';
  return flags.some((f) => /\bPROFILEABLE/.test(f)) ? 'profileable' : 'release';
}

/** One app's row in `dumpsys diskstats`, where it lists apps: arrays in the order of `Package Names`. */
export function parseDiskstats(text: string, pkg: string): Record<string, number> {
  const list = (name: string): unknown[] => {
    try {
      return JSON.parse(new RegExp(`^${name}: (\\[.*\\])`, 'm').exec(text)?.[1] ?? '[]');
    } catch {
      return [];
    }
  };
  const i = list('Package Names').indexOf(pkg);
  if (i < 0) return {};
  const out: Record<string, number> = {};
  for (const [part, name] of [
    ['code', 'App Sizes'],
    ['data', 'App Data Sizes'],
    ['cache', 'Cache Sizes'],
  ] as const) {
    const v = list(name)[i];
    if (typeof v === 'number') out[part] = v;
  }
  return out;
}
