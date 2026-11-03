import type {
  DeviceVitals,
  FrameStats,
  FrameSummary,
  FrameTimeline,
  ProfileEntry,
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
      // Android 16 (seen on a Xiaomi) sets bit 32 on ordinary frames, which a 0 alone would leave out
      if ((Number(v[flags]) & ~32) === 0 && Number.isFinite(ns) && ns > 0)
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
};

/** `dumpsys meminfo <pkg>`: the App Summary and the TOTAL line. */
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
  };
  for (const [k, v] of Object.entries(opt)) if (v !== undefined) Object.assign(out, { [k]: v });
  return out;
}

export type LaunchSample = { totalMs?: number; waitMs?: number; state?: string; status?: string };

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
  return {
    frames: rows.length,
    janky,
    jankyPercent: rows.length ? Math.round((janky / rows.length) * 1000) / 10 : 0,
    appDeadlineMissed: rows.filter((r) => has(r.jank, /App Deadline Missed/)).length,
    appJankPercent: rows.length
      ? Math.round(
          (rows.filter((r) => has(r.jank, /App Deadline Missed/)).length / rows.length) * 1000,
        ) / 10
      : 0,
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
