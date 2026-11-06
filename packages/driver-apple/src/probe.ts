import type { FrameMark, FrameStats, ProbeSummary } from '@appdyno/core';
import { FROZEN_FRAME_MS, MIN_FRAMES, quantile, round1 } from '@appdyno/core';

export const PROBE_LIMITS =
  "The probe sees the app's main-thread pacing, not the render server or GPU, and the speed is the Mac's: it finds stalls and regressions on this machine and does not predict a phone's frame rate.";

const STALL_MS = 100;
/** An interval over this many of the display's counts as a frame missed. */
const LATE_VSYNCS = 1.5;

type Line = {
  loaded?: string;
  pid?: number;
  t?: number;
  dt?: number;
  v?: number;
  launchMs?: number;
  phases?: Record<string, number>;
  input?: number;
  open?: number;
  ms?: number;
  reset?: number;
};

/** The file's lines (the last may still be half written). */
function lines(text: string): Line[] {
  return text.split('\n').flatMap((l) => {
    try {
      return l ? [JSON.parse(l) as Line] : [];
    } catch {
      return [];
    }
  });
}

/** What the probe's file says of its process: who wrote it, when it started, the last reset. */
export function probeHead(text: string): {
  pid?: number;
  bundle?: string;
  loadedAt?: number;
  launchMs?: number;
  phases?: Record<string, number>;
  resetAt?: number;
} {
  const all = lines(text);
  const head = all.findLast((l) => l.loaded !== undefined);
  const launchMs = all.findLast((l) => l.launchMs !== undefined)?.launchMs;
  const resetAt = all.findLast((l) => l.reset !== undefined)?.reset;
  const phases = all.findLast((l) => l.phases !== undefined)?.phases;
  return {
    ...(head && { pid: head.pid!, bundle: head.loaded!, loadedAt: head.t! }),
    ...(launchMs !== undefined && { launchMs }),
    ...(phases && { phases }),
    ...(resetAt !== undefined && { resetAt }),
  };
}

/** The file's lines from a window, whole; what has no time of its own (who wrote it, the launch) is kept. */
export function probeWindow(text: string, fromMs: number, toMs: number): string {
  return text
    .split('\n')
    .filter((raw) => {
      const l = lines(raw)[0];
      if (!l || l.reset !== undefined) return false;
      const t = l.loaded === undefined ? (l.t ?? l.open ?? l.input) : undefined;
      return t === undefined || (t > fromMs && t <= toMs);
    })
    .join('\n');
}

function stats(windowText: string, fromMs: number, toMs: number) {
  const all = lines(windowText);
  const frames = all.filter((l) => l.dt !== undefined);
  const intervals = frames.map((l) => l.dt!);
  const lastFrame = frames.at(-1)?.t ?? 0;
  // a stall still running when the window ends has no frame of its own yet
  const open = all.findLast((l) => l.open !== undefined);
  if (open && open.open! > lastFrame) intervals.push(toMs - (open.open! - open.ms!));
  const vsync = frames.map((l) => l.v!).sort((a, b) => a - b)[frames.length >> 1] ?? 0;
  const sorted = intervals.toSorted((a, b) => a - b);
  const at = (p: number) => (sorted.length ? quantile(sorted, p) : 0);
  const missed = intervals.filter((x) => vsync > 0 && x > vsync * LATE_VSYNCS).length;
  const stalled = intervals.filter((x) => x > STALL_MS);
  const lastInput = all.findLast((l) => l.input !== undefined)?.input;
  const summary: ProbeSummary = {
    durationMs: Math.round(toMs - fromMs),
    frames: intervals.length,
    missed,
    missedPercent: intervals.length ? round1((missed / intervals.length) * 100) : 0,
    frozen: intervals.filter((x) => x >= FROZEN_FRAME_MS).length,
    p50Ms: round1(at(0.5)),
    p95Ms: round1(at(0.95)),
    worstMs: round1(sorted.at(-1) ?? 0),
    stalls: {
      count: stalled.length,
      worstMs: round1(Math.max(0, ...stalled)),
      totalMs: round1(stalled.reduce((a, b) => a + b, 0)),
    },
    ...(lastInput !== undefined && { lastInputMsAgo: Math.round(toMs - lastInput) }),
    limits: PROBE_LIMITS,
  };
  return { summary, p90Ms: round1(at(0.9)), p99Ms: round1(at(0.99)), sorted };
}

/** A window of the probe's lines as frames: each interval on the wall clock its process read, late over 1.5 vsync. */
export const probeMarks = (windowText: string): FrameMark[] =>
  lines(windowText)
    .filter((l) => l.dt !== undefined)
    .map((l) => ({
      at: l.t! - l.dt!,
      ms: l.dt!,
      ...(l.dt! > l.v! * LATE_VSYNCS && { late: true }),
    }));

/** A window of the probe's lines (`probeWindow`), summed up. */
export const probeSummary = (windowText: string, fromMs: number, toMs: number): ProbeSummary =>
  stats(windowText, fromMs, toMs).summary;

/** The same as the frame reading every platform gives. */
export function probeFrames(windowText: string, fromMs: number, toMs: number): FrameStats {
  const { summary: s, p90Ms, p99Ms } = stats(windowText, fromMs, toMs);
  return {
    totalFrames: s.frames,
    jankyFrames: s.missed,
    jankyPercent: s.missedPercent,
    p50Ms: s.p50Ms,
    p90Ms,
    p95Ms: s.p95Ms,
    p99Ms,
    frozenFrames: s.frozen,
    fewFrames: s.frames < MIN_FRAMES,
    limits: s.limits,
    stalls: s.stalls,
  };
}
