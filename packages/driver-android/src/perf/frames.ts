import {
  frozenMoments,
  refreshMsOf,
  sleep,
  stopsInLog,
  type Measured,
  type FrameStats,
  type FrameTimeline,
  type FrameTrace,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg } from '../adb.js';
import { logcatCommand, markOfLine } from '../logs.js';
import { traceProcessor } from '../tools.js';
import { frameCauseSql, parseFrameCauses } from './frame-cause.js';
import {
  parseFrameStats,
  parseFramestats,
  parseAndroidFrameStats,
  parseCsv,
  parseFrameTimelineCsv,
  type FrameRow,
} from './parse.js';
import { type PerfDevice, pidOf, sh, at } from './shared.js';
import { recordTrace, NAME_NEW_PROCESSES, PROCESS_STATS, queryFile } from './perfetto.js';

const frameStatsSql = (pkg: string) => `
INCLUDE PERFETTO MODULE android.frames.timeline;
INCLUDE PERFETTO MODULE android.frames.per_frame_metrics;
SELECT s.overrun, s.cpu_time FROM android_frame_stats s JOIN android_frames f USING (frame_id)
  WHERE f.process_name = '${pkg}';`;

const NOTHING_DRAWN: FrameStats = {
  totalFrames: 0,
  jankyFrames: 0,
  jankyPercent: 0,
  frozenFrames: 0,
  fewFrames: true,
};

/** Frames since the stats were last reset, then a reset (the next read starts a new window). */
export async function frames(
  d: PerfDevice,
  pkg: string,
  opts: { reset?: boolean; asItIs?: boolean } = {},
): Promise<Measured<FrameStats>> {
  if (!opts.asItIs) await d.readyToMeasure();
  assertPkg(pkg);
  const raw = await sh(
    d,
    `dumpsys gfxinfo ${pkg} framestats${opts.reset === false ? '' : `; dumpsys gfxinfo ${pkg} reset > /dev/null`}`,
  );
  if (/No process found/i.test(raw))
    throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not running`);
  // a process up for a broadcast or a job has no window, and prints no summary: it drew nothing
  if (!/Total frames rendered/.test(raw)) return { value: NOTHING_DRAWN, raw, at: at() };
  return { value: parseFrameStats(raw), raw, at: at() };
}

export async function resetFrames(d: PerfDevice, pkg: string) {
  await d.readyToMeasure();
  await sh(d, `dumpsys gfxinfo ${assertPkg(pkg)} reset > /dev/null`);
}

/** Often enough that the ring of the last ~120 frames loses none at 120 Hz. */
const RING_READ_MS = 300;
/** What a list coasts on after its swipes. */
const COAST_MS = 1_500;

/**
 * The frames of what `during` does. Frozen frames come from the rows, read as it goes: one stall of 1 s reads as 4 in
 * the summary of a Xiaomi with Android 16, as a stall holds up the next frame too, and its summary counts each frame
 * twice (142 frames rendered for 71 rows). The histogram keeps its slow share, a ratio the doubling leaves alone and a
 * row's length is no measure of, and takes its frozen frames and its frames for them from the rows.
 */
export async function framesDuring(
  d: PerfDevice,
  pkg: string,
  _seconds: number,
  during: () => Promise<unknown>,
): Promise<Measured<FrameStats>> {
  await resetFrames(d, pkg);
  const rows = new Map<number, FrameRow>();
  const keep = (text: string) => {
    for (const r of parseFramestats(text)) rows.set(r.startNs!, r);
  };
  let on = true;
  const reading = (async () => {
    while (on) {
      await d
        .shellAlongside(`LC_ALL=C dumpsys gfxinfo ${pkg} framestats`, 10_000)
        .then(keep, () => undefined);
      await sleep(RING_READ_MS);
    }
  })();
  try {
    await during();
    await sleep(COAST_MS);
  } finally {
    on = false;
    await reading;
  }
  const m = await frames(d, pkg);
  keep(m.raw);
  const moments = frozenMoments(
    [...rows.values()].map((r) => ({ start: r.startNs! / 1e6, ms: r.durationMs })),
  );
  // the summary saw one the rows did not: at least that
  const frozenFrames = m.value.frozenFrames > 0 ? Math.max(moments, 1) : moments;
  const histogram = m.value.histogram && {
    ...m.value.histogram,
    over700: frozenFrames,
    ...(rows.size > 0 && { rowFrames: rows.size }),
  };
  return { ...m, value: { ...m.value, frozenFrames, ...(histogram && { histogram }) } };
}

/**
 * Every frame of the app over `durationMs` from Perfetto's frame timeline (Android 12+): the time each
 * frame took and why it was late (the app, the compositor, buffer stuffing). `during` runs while it
 * records (a scroll, a transition). The trace is kept for later queries; atrace in it gives what each
 * frame cost (`android_frame_stats`). Needs the trace processor (`appdyno tools install`).
 */
export async function frameTimeline(
  d: PerfDevice,
  pkg: string,
  durationMs: number,
  during?: () => Promise<unknown>,
): Promise<Measured<FrameTimeline> & { tracePath?: string }> {
  await d.readyToMeasure();
  assertPkg(pkg);
  await traceProcessor();
  const ms = Math.min(Math.max(Math.round(durationMs), 500), 60_000);
  const file = await recordTrace(
    d,
    pkg,
    'frames',
    [
      'buffers { size_kb: 65536 fill_policy: RING_BUFFER }',
      'data_sources { config { name: "android.surfaceflinger.frametimeline" } }',
      // what a frame waited for: a monitor and the collector (dalvik), a binder call, and the main thread's state
      `data_sources { config { name: "linux.ftrace" ftrace_config { ${NAME_NEW_PROCESSES} ftrace_events: "sched/sched_switch" ftrace_events: "sched/sched_waking" ftrace_events: "binder/binder_transaction" ftrace_events: "binder/binder_transaction_received" atrace_categories: "view" atrace_categories: "gfx" atrace_categories: "dalvik" atrace_categories: "binder_driver" atrace_apps: "${pkg}" } } }`,
      PROCESS_STATS,
      `duration_ms: ${ms}`,
    ],
    during ? { during } : {},
  );
  const raw = await queryFile(
    file,
    `SELECT a.ts, a.dur, a.jank_type FROM actual_frame_timeline_slice a JOIN process p USING (upid) WHERE p.name = '${pkg}' ORDER BY a.ts;`,
  );
  const stats = parseAndroidFrameStats(await queryFile(file, frameStatsSql(pkg)));
  const causes = parseFrameCauses(await queryFile(file, frameCauseSql(pkg)));
  return {
    value: {
      ...parseFrameTimelineCsv(raw),
      ...(stats && { stats }),
      ...(causes && { causes }),
      tracePath: file,
    },
    raw,
    at: at(),
  };
}

/** The longest hold of the main thread the app's log told of since `sinceMs`, by the device's clock; none if it told of none. */
async function heldInLog(d: PerfDevice, pkg: string, sinceMs: number, refreshMs: number) {
  const pid = await pidOf(d, pkg).catch(() => undefined);
  if (pid === undefined) return undefined;
  const out = await sh(
    d,
    logcatCommand(String(pid), { since: sinceMs, level: 'info', maxLines: 0, timed: true }),
  ).catch(() => '');
  const lines = out.split(/\r?\n/);
  const stops = stopsInLog(lines, (i) => markOfLine(lines[i]!)?.at, refreshMs);
  return stops.length ? Math.round(Math.max(...stops.map((s) => s.ms))) : undefined;
}

/** The frame timeline over `seconds`. */
export async function frameTrace(
  d: PerfDevice,
  pkg: string,
  seconds: number,
  during?: () => Promise<unknown>,
): Promise<Measured<FrameTrace>> {
  await d.readyToMeasure();
  // the device's own time: a log is read by its clock, and a phone's need not be this Mac's
  const sinceMs = Math.floor(Number(await sh(d, 'date +%s%N')) / 1e6);
  const m = await frameTimeline(d, pkg, seconds * 1000, during);
  const { columns, rows } = parseCsv(m.raw);
  const refresh = refreshMsOf(rows.map((r) => Number(r[columns.indexOf('ts')]) / 1e6));
  const heldMs = await heldInLog(d, pkg, sinceMs, refresh);
  return {
    value: { kind: 'timeline', ...m.value, ...(heldMs !== undefined && { heldMs }) },
    raw: m.raw,
    at: m.at,
    source: 'perfetto frame timeline',
  };
}
