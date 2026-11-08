import {
  must,
  FROZEN_FRAME_MS,
  MIN_FRAMES,
  quantile,
  round1,
  type FrameSummary,
  type FrameStats,
  type FrameTimeline,
} from '@appdyno/core';
import { num, parseCsv, cellNum, nsToMs } from './parse-common.js';

/**
 * Parsers of the platform's own measurement output (pure; unit tested on recorded outputs). Every number
 * a measurement reports comes from one of these and travels with the raw text it was read from.
 */

/** The first (process) summary of `dumpsys gfxinfo <pkg>`. */
export function parseGfxSummary(text: string): FrameSummary {
  const total = num(/^\s*Total frames rendered:\s*(\d+)/m, text);
  const janky = /^\s*Janky frames:\s*(\d+)\s*\(([\d.]+)%\)/m.exec(text);
  if (total === undefined || !janky) throw new Error('no frame summary in gfxinfo output');
  const hist = /^HISTOGRAM:(.*)$/m.exec(text)?.[1] ?? '';
  const histogram = { frames: 0, over16: 0, over700: 0 };
  for (const [, ms, n] of hist.matchAll(/(\d+)ms=(\d+)/g)) {
    histogram.frames += Number(n);
    if (Number(ms) > 16) histogram.over16 += Number(n);
    if (Number(ms) >= FROZEN_FRAME_MS) histogram.over700 += Number(n);
  }
  const out: FrameSummary = {
    totalFrames: total,
    jankyFrames: Number(janky[1]),
    jankyPercent: Number(janky[2]),
    frozenFrames: histogram.over700,
    fewFrames: total < MIN_FRAMES,
    ...(hist && { histogram }),
  };
  const opt = {
    // on no frames these are the top bucket of an empty histogram, with nothing behind them
    ...(total > 0 && {
      p50Ms: num(/^50th percentile:\s*(\d+)ms/m, text),
      p90Ms: num(/^90th percentile:\s*(\d+)ms/m, text),
      p95Ms: num(/^95th percentile:\s*(\d+)ms/m, text),
      p99Ms: num(/^99th percentile:\s*(\d+)ms/m, text),
    }),
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
export function parseFramestats(text: string): Required<FrameRow>[] {
  const out: Required<FrameRow>[] = [];
  // one block per window of the process (an empty one for a window that drew nothing)
  for (const m of text.matchAll(/---PROFILEDATA---\n([\s\S]*?)---PROFILEDATA---/g)) {
    const [head, ...rows] = must(m[1], 'a block').trim().split('\n');
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

/** The summary plus what the per-frame rows say: a frame over two vsync intervals is slow. */
export function parseFrameStats(text: string): FrameStats {
  const out: FrameStats = parseGfxSummary(text);
  const rows = parseFramestats(text);
  if (rows.length > 0) {
    const ms = rows.map((r) => r.durationMs);
    // a frame finishes about one interval after its vsync even when smooth (the render pipeline): slow is
    // over two intervals, a missed frame
    const slow = rows.filter((r) => r.durationMs > 2 * r.intervalMs).length;
    const worst = worstWindow(rows);
    out.frames = {
      count: rows.length,
      slow,
      slowPercent: Math.round((slow / rows.length) * 1000) / 10,
      p50Ms: round1(quantile(ms, 0.5)),
      p95Ms: round1(quantile(ms, 0.95)),
      worstMs: Math.max(...ms),
      ...(worst && { worstWindow: worst }),
    };
  }
  return out;
}

/** The one-second window (by vsync time) with the most slow frames, ties by the longer average. */
export function worstWindow(
  rows: FrameRow[],
): { frames: number; slow: number; avgMs: number } | undefined {
  const timed = rows
    .filter((r): r is Required<FrameRow> => r.startNs !== undefined)
    .sort((a, b) => a.startNs - b.startNs);
  if (timed.length === 0) return undefined;
  let best: { frames: number; slow: number; avgMs: number } | undefined;
  let j = 0;
  for (const [i, row] of timed.entries()) {
    while (row.startNs - must(timed[j], 'a frame').startNs > 1e9) j++;
    const win = timed.slice(j, i + 1);
    const slow = win.filter((r) => r.durationMs > 2 * r.intervalMs).length;
    const avgMs = Math.round((win.reduce((a, r) => a + r.durationMs, 0) / win.length) * 10) / 10;
    if (!best || slow > best.slow || (slow === best.slow && avgMs > best.avgMs))
      best = { frames: win.length, slow, avgMs };
  }
  return best;
}

/**
 * The frame-timeline query's CSV (trace processor output): one row per frame of the app's process with
 * its duration and jank type. Jank types: "None", "App Deadline Missed", "Buffer Stuffing",
 * "SurfaceFlinger CPU Deadline Missed", … (several may be listed, comma separated).
 */
export function parseFrameTimelineCsv(csv: string): FrameTimeline {
  const { columns, rows: cells } = parseCsv(csv);
  const iDur = columns.indexOf('dur');
  const iJank = columns.indexOf('jank_type');
  if (iDur < 0 || iJank < 0)
    throw new Error('no dur/jank_type columns in the frame timeline output');
  const rows = cells.flatMap((r) => {
    const dur = cellNum(r[iDur]);
    return dur === undefined ? [] : [{ durMs: dur / 1e6, jank: r[iJank] ?? '' }];
  });
  const has = (j: string, kind: RegExp) => kind.test(j);
  const janky = rows.filter((r) => r.jank && r.jank !== 'None').length;
  const ms = rows.map((r) => r.durMs);
  const appJank = rows.filter((r) => has(r.jank, /App Deadline Missed|App Resynced Jitter/)).length;
  return {
    frames: rows.length,
    janky,
    jankyPercent: rows.length ? Math.round((janky / rows.length) * 1000) / 10 : 0,
    appDeadlineMissed: rows.filter((r) => has(r.jank, /App Deadline Missed/)).length,
    frozen: ms.filter((x) => x >= FROZEN_FRAME_MS).length,
    appResynced: rows.filter((r) => has(r.jank, /App Resynced Jitter/)).length,
    appJankPercent: rows.length ? Math.round((appJank / rows.length) * 1000) / 10 : 0,
    bufferStuffing: rows.filter((r) => has(r.jank, /Buffer Stuffing/)).length,
    surfaceFlinger: rows.filter((r) => has(r.jank, /SurfaceFlinger|Display HAL|Prediction Error/))
      .length,
    p50Ms: ms.length ? round1(quantile(ms, 0.5)) : 0,
    p95Ms: ms.length ? round1(quantile(ms, 0.95)) : 0,
    worstMs: Math.round((ms.length ? Math.max(...ms) : 0) * 10) / 10,
  };
}

/** `android_frame_stats` rows (`overrun`, `cpu_time`, ns) of one app; none when the trace lacks the slices. */
export function parseAndroidFrameStats(csv: string): FrameTimeline['stats'] {
  const { columns, rows } = parseCsv(csv);
  const col = (name: string) =>
    rows.flatMap((r) => cellNum(r[columns.indexOf(name)]) ?? []).map(nsToMs);
  const overrun = col('overrun');
  if (overrun.length === 0) return undefined;
  const cpu = col('cpu_time');
  return {
    frames: rows.length,
    overrunP95Ms: round1(quantile(overrun, 0.95)),
    overrunWorstMs: Math.max(...overrun),
    ...(cpu.length > 0 && { cpuP95Ms: round1(quantile(cpu, 0.95)) }),
  };
}
