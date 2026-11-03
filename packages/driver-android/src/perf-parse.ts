import type {
  BuildType,
  DeviceVitals,
  EnergyReading,
  FrameStats,
  FrameSummary,
  FrameTimeline,
  ProfileEntry,
  StartupAnalysis,
  ThreadReading,
} from '@appdyno/core';

/**
 * Parsers of the platform's own measurement output (pure; unit tested on recorded outputs). Every number
 * a measurement reports comes from one of these and travels with the raw text it was read from.
 */

/** A frame longer than this stood still for the user (Android vitals' frozen frame). */
export const FROZEN_FRAME_MS = 700;
/** Below this many frames the shares say little (a few launch frames). */
export const MIN_FRAMES = 60;

const num = (re: RegExp, text: string) => {
  const v = re.exec(text)?.[1];
  return v === undefined ? undefined : Number(v);
};

/** The first (process) summary of `dumpsys gfxinfo <pkg>`. */
export function parseGfxSummary(text: string): FrameSummary {
  const total = num(/^\s*Total frames rendered:\s*(\d+)/m, text);
  const janky = /^\s*Janky frames:\s*(\d+)\s*\(([\d.]+)%\)/m.exec(text);
  if (total === undefined || !janky) throw new Error('no frame summary in gfxinfo output');
  const hist = /^HISTOGRAM:(.*)$/m.exec(text)?.[1] ?? '';
  let frozen = 0;
  for (const [, ms, n] of hist.matchAll(/(\d+)ms=(\d+)/g))
    if (Number(ms) >= FROZEN_FRAME_MS) frozen += Number(n);
  const out: FrameSummary = {
    totalFrames: total,
    jankyFrames: Number(janky[1]),
    jankyPercent: Number(janky[2]),
    frozenFrames: frozen,
    fewFrames: total < MIN_FRAMES,
  };
  const opt = {
    p50Ms: num(/^50th percentile:\s*(\d+)ms/m, text),
    p90Ms: num(/^90th percentile:\s*(\d+)ms/m, text),
    p95Ms: num(/^95th percentile:\s*(\d+)ms/m, text),
    p99Ms: num(/^99th percentile:\s*(\d+)ms/m, text),
    slowUiThread: num(/^Number Slow UI thread:\s*(\d+)/m, text),
    deadlineMissed: num(/^Number Frame deadline missed:\s*(\d+)/m, text),
  };
  for (const [k, v] of Object.entries(opt)) if (v !== undefined) Object.assign(out, { [k]: v });
  return out;
}

export type FrameRow = { durationMs: number; intervalMs: number; startNs?: number };

/**
 * Per-frame rows of `dumpsys gfxinfo <pkg> framestats` (the ring of the last ~120 frames): duration
 * IntendedVsync → FrameCompleted and the frame interval (the vsync period). Flagged rows (not a normal
 * frame) and broken rows are left out. Columns are found by their header: releases add columns.
 */
export function parseFramestats(text: string): FrameRow[] {
  const out: FrameRow[] = [];
  // one block per window of the process (an empty one for a window that drew nothing)
  for (const m of text.matchAll(/---PROFILEDATA---\n([\s\S]*?)---PROFILEDATA---/g)) {
    const [head, ...rows] = m[1]!.trim().split('\n');
    const cols = (head ?? '').split(',');
    const at = (c: string) => cols.indexOf(c);
    const [flags, start, end] = [at('Flags'), at('IntendedVsync'), at('FrameCompleted')];
    // some releases print FrameInterval and FrameStartTime in the other order than their header: the
    // interval is whichever of the two is a plausible vsync period (1 ms to 1 s), not a timestamp
    const intervalCols = [at('FrameInterval'), at('FrameStartTime')].filter((i) => i >= 0);
    if (flags < 0 || start < 0 || end < 0) continue;
    for (const r of rows) {
      const v = r.split(',');
      const ns = Number(v[end]) - Number(v[start]);
      const iv =
        intervalCols.map((i) => Number(v[i])).find((x) => x > 1e6 && x < 1e9) ?? 16_666_667;
      if (v[flags] === '0' && Number.isFinite(ns) && ns > 0)
        out.push({
          durationMs: Math.round(ns / 1e5) / 10,
          intervalMs: Math.round(iv / 1e5) / 10,
          startNs: Number(v[start]),
        });
    }
  }
  return out;
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] ?? 0;
};

/** The summary plus what the per-frame rows say: a frame over two vsync intervals is slow. */
export function parseFrameStats(text: string): FrameStats {
  const out: FrameStats = parseGfxSummary(text);
  const rows = parseFramestats(text);
  if (rows.length > 0) {
    const ms = rows.map((r) => r.durationMs);
    // a frame finishes about one interval after its vsync even when smooth (the render pipeline): slow is
    // over two intervals, a missed frame
    const slow = rows.filter((r) => r.durationMs > 2 * r.intervalMs).length;
    out.frames = {
      count: rows.length,
      slow,
      slowPercent: Math.round((slow / rows.length) * 1000) / 10,
      p50Ms: pct(ms, 0.5),
      p95Ms: pct(ms, 0.95),
      worstMs: Math.max(...ms),
      ...(worstWindow(rows) && { worstWindow: worstWindow(rows)! }),
    };
  }
  return out;
}

/** The one-second window (by vsync time) with the most slow frames, ties by the longer average. */
export function worstWindow(
  rows: FrameRow[],
): { frames: number; slow: number; avgMs: number } | undefined {
  const timed = rows.filter((r) => r.startNs !== undefined).sort((a, b) => a.startNs! - b.startNs!);
  if (timed.length === 0) return undefined;
  let best: { frames: number; slow: number; avgMs: number } | undefined;
  let j = 0;
  for (let i = 0; i < timed.length; i++) {
    while (timed[i]!.startNs! - timed[j]!.startNs! > 1e9) j++;
    const win = timed.slice(j, i + 1);
    const slow = win.filter((r) => r.durationMs > 2 * r.intervalMs).length;
    const avgMs = Math.round((win.reduce((a, r) => a + r.durationMs, 0) / win.length) * 10) / 10;
    if (!best || slow > best.slow || (slow === best.slow && avgMs > best.avgMs))
      best = { frames: win.length, slow, avgMs };
  }
  return best;
}

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

export type LaunchSample = {
  totalMs?: number;
  waitMs?: number;
  state?: string;
  status?: string;
  fullyDrawnMs?: number;
};

/** `am start -W`: TotalTime (the launch as the system saw it), WaitTime (includes am's own cost), LaunchState. */
export function parseAmStart(text: string): LaunchSample {
  const out: LaunchSample = {};
  const total = num(/^TotalTime:\s*(\d+)/m, text);
  const wait = num(/^WaitTime:\s*(\d+)/m, text);
  const state = /^LaunchState:\s*(\w+)/m.exec(text)?.[1];
  const status = /^Status:\s*(\w+)/m.exec(text)?.[1];
  if (total !== undefined) out.totalMs = total;
  if (wait !== undefined) out.waitMs = wait;
  if (state) out.state = state;
  if (status) out.status = status;
  return out;
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

/** One shell read of the device's own state (sections separated by marker lines). */
export function parseVitals(text: string): DeviceVitals {
  const section = (name: string) =>
    new RegExp(`==${name}==\\n([\\s\\S]*?)(?:\\n==|$)`).exec(text)?.[1] ?? '';
  const out: DeviceVitals = {};
  const load = section('load').trim().split(/\s+/).slice(0, 3).map(Number);
  if (load.length === 3 && load.every(Number.isFinite)) out.load = load;
  const pressure = num(/some avg10=([\d.]+)/, section('pressure'));
  if (pressure !== undefined) out.cpuPressure = pressure;
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
 * The frame-timeline query's CSV (trace processor output): one row per frame of the app's process with
 * its duration and jank type. Jank types: "None", "App Deadline Missed", "Buffer Stuffing",
 * "SurfaceFlinger CPU Deadline Missed", … (several may be listed, comma separated).
 */
export function parseFrameTimelineCsv(csv: string): FrameTimeline {
  const lines = csv.trim().split('\n');
  const head = (lines.shift() ?? '').split(',').map((h) => h.replace(/"/g, '').trim());
  const iDur = head.indexOf('dur');
  const iJank = head.indexOf('jank_type');
  if (iDur < 0 || iJank < 0)
    throw new Error('no dur/jank_type columns in the frame timeline output');
  const rows = lines
    .filter(Boolean)
    .map((l) => {
      // jank_type is quoted and may hold commas
      const cells = [...l.matchAll(/"([^"]*)"|([^,]+)/g)].map((m) => m[1] ?? m[2] ?? '');
      return { durMs: Number(cells[iDur]) / 1e6, jank: cells[iJank] ?? '' };
    })
    .filter((r) => Number.isFinite(r.durMs));
  const has = (j: string, kind: RegExp) => kind.test(j);
  const janky = rows.filter((r) => r.jank && r.jank !== 'None').length;
  const ms = rows.map((r) => r.durMs);
  const appJank = rows.filter((r) => has(r.jank, /App Deadline Missed|App Resynced Jitter/)).length;
  return {
    frames: rows.length,
    janky,
    jankyPercent: rows.length ? Math.round((janky / rows.length) * 1000) / 10 : 0,
    appDeadlineMissed: rows.filter((r) => has(r.jank, /App Deadline Missed/)).length,
    appResynced: rows.filter((r) => has(r.jank, /App Resynced Jitter/)).length,
    appJankPercent: rows.length ? Math.round((appJank / rows.length) * 1000) / 10 : 0,
    bufferStuffing: rows.filter((r) => has(r.jank, /Buffer Stuffing/)).length,
    surfaceFlinger: rows.filter((r) => has(r.jank, /SurfaceFlinger|Display HAL|Prediction Error/))
      .length,
    p50Ms: Math.round(pct(ms, 0.5) * 10) / 10,
    p95Ms: Math.round(pct(ms, 0.95) * 10) / 10,
    worstMs: Math.round((ms.length ? Math.max(...ms) : 0) * 10) / 10,
  };
}

/**
 * `simpleperf report --sort symbol -n` text: the functions taking the app's CPU time, most first. Rows look
 * like `12.34%  1234  java.lang.String.indexOf`.
 */
export function parseSimpleperfReport(text: string, limit = 15): ProfileEntry[] {
  const out: ProfileEntry[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*([\d.]+)%\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ percent: Number(m[1]), samples: Number(m[2]), symbol: m[3]! });
  }
  return out.sort((a, b) => b.percent - a.percent).slice(0, limit);
}

/** The trace processor's CSV: strings quoted (doubled quotes inside, line breaks allowed), numbers bare. */
export function parseCsv(csv: string): { columns: string[]; rows: string[][] } {
  const table: string[][] = [];
  let row: string[] = [];
  for (const m of csv.matchAll(/("(?:[^"]|"")*"|[^,\n]*)(,|\n|$)/g)) {
    const raw = m[1]!;
    row.push(raw.startsWith('"') ? raw.slice(1, -1).replace(/""/g, '"') : raw);
    if (m[2] !== ',') {
      if (row.some(Boolean)) table.push(row);
      row = [];
    }
    if (m[2] === '') break;
  }
  const [columns = [], ...rows] = table;
  return { columns, rows };
}

/** A cell as a number; the trace processor's NULL is none. */
const cellNum = (cell: string | undefined) => {
  const v = cell === undefined || cell === '' || cell === '[NULL]' ? NaN : Number(cell);
  return Number.isFinite(v) ? v : undefined;
};
const nsToMs = (ns: number) => Math.round(ns / 1e5) / 10;

/** `android_frame_stats` rows (`overrun`, `cpu_time`, ns) of one app; none when the trace lacks the slices. */
export function parseAndroidFrameStats(csv: string): FrameTimeline['stats'] {
  const { columns, rows } = parseCsv(csv);
  const col = (name: string) =>
    rows.flatMap((r) => cellNum(r[columns.indexOf(name)]) ?? []).map(nsToMs);
  const overrun = col('overrun');
  if (overrun.length === 0) return undefined;
  return {
    frames: rows.length,
    overrunP95Ms: pct(overrun, 0.95),
    overrunWorstMs: Math.max(...overrun),
    cpuP95Ms: pct(col('cpu_time'), 0.95),
  };
}

/** The app's last "Fully drawn" line of an `ActivityTaskManager` log: `... .MainActivity: +1s13ms`. */
export function parseFullyDrawn(log: string, pkg: string): number | undefined {
  const line = [...log.matchAll(/Fully drawn (\S+?)\/\S+: \+(?:(\d+)m)?(?:(\d+)s)?(\d+)ms/g)]
    .filter((m) => m[1] === pkg)
    .at(-1);
  if (!line) return undefined;
  return Number(line[2] ?? 0) * 60_000 + Number(line[3] ?? 0) * 1000 + Number(line[4]);
}

/** The compiler state in `dumpsys package dexopt`: `arm64: [status=verify] [reason=cmdline]`. */
export function parseCompileStatus(text: string): string | undefined {
  const m = /status=([\w-]+)\]?\s*\[reason=([\w-]+)/.exec(text);
  return m ? `status=${m[1]} reason=${m[2]}` : undefined;
}

const LIMITS: [name: string, metric: string, ms: number][] = [
  ['bindApplication', 'time_bind_application', 1250],
  ['inflate', 'time_inflate', 450],
  ['getResources', 'time_get_resources', 130],
];
const HOT_LIMIT_MS = 1500;

type StartupMetric = {
  package_name?: string;
  report_fully_drawn?: { dur_ms?: number };
  to_first_frame?: Record<string, { dur_ms?: number } | number | undefined>;
  slow_start_reason?: string[];
};

/**
 * What a startup trace says, from the query in `AndroidPerf` (rows of `k,a,b`: `type`, `display`,
 * `reason`, `odex`) and the `android_startup` metric's JSON. TTFD falls back to the metric: the display
 * table leaves it empty when no frame follows `reportFullyDrawn`.
 */
export function parseStartup(
  csv: string,
  metricJson: string,
  pkg: string,
  tracePath: string,
): StartupAnalysis {
  const { rows } = parseCsv(csv);
  const find = (k: string) => rows.find((r) => r[0] === k);
  const startups = (JSON.parse(metricJson) as { android_startup?: { startup?: StartupMetric[] } })
    .android_startup?.startup;
  const metric = startups?.filter((s) => s.package_name === pkg).at(-1);
  const type = find('type');
  const display = find('display');
  const durNs = cellNum(type?.[2]);
  const ttidNs = cellNum(display?.[1]);
  const ttfdNs = cellNum(display?.[2]);
  const drawnMs = metric?.report_fully_drawn?.dur_ms;
  const ttfdMs = ttfdNs !== undefined ? nsToMs(ttfdNs) : drawnMs && Math.round(drawnMs * 10) / 10;
  const odex = find('odex')?.[1];
  const findings = LIMITS.flatMap(([name, key, limit]) => {
    const part = metric?.to_first_frame?.[key];
    const ms = typeof part === 'object' ? part.dur_ms : undefined;
    return ms !== undefined && ms > limit
      ? [`${name} took ${Math.round(ms)} ms (limit ${limit} ms)`]
      : [];
  });
  if (type?.[1] === 'hot' && durNs !== undefined && durNs / 1e6 > HOT_LIMIT_MS)
    findings.push(`hot launch took ${Math.round(durNs / 1e6)} ms (limit ${HOT_LIMIT_MS} ms)`);
  return {
    tracePath,
    ...(type?.[1] && { startupType: type[1] }),
    ...(durNs !== undefined && { durMs: nsToMs(durNs) }),
    ...(ttidNs !== undefined && { ttidMs: nsToMs(ttidNs) }),
    ...(ttfdMs !== undefined && { ttfdMs }),
    reasons: metric?.slow_start_reason ?? [],
    breakdown: rows
      .filter((r) => r[0] === 'reason')
      .map((r) => ({ reason: r[1]!, ms: nsToMs(cellNum(r[2]) ?? 0) }))
      .sort((a, b) => b.ms - a.ms),
    findings,
    ...(odex && { odex }),
  };
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
  const row = new RegExp(`^\\s*UID ${name}: ([\\d.]+)[^(]*\\((.*)\\)\\s*$`, 'mi').exec(section);
  if (!row) return computed > 0 ? { mah: 0 } : {};
  const breakdown: Record<string, number> = {};
  for (const m of row[2]!.matchAll(/(\w+)=([\d.]+)/g)) breakdown[m[1]!] = Number(m[2]);
  return { mah: Number(row[1]), breakdown };
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
