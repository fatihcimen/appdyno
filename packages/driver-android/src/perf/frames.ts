import {
  frozenMoments,
  sleep,
  type Measured,
  type FrameStats,
  type FrameTimeline,
  type FrameTrace,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg } from '../adb.js';
import { traceProcessor } from '../tools.js';
import {
  parseFrameStats,
  parseFramestats,
  parseAndroidFrameStats,
  parseFrameTimelineCsv,
  type FrameRow,
} from './parse.js';
import { type PerfDevice, sh, at } from './shared.js';
import { recordTrace, NAME_NEW_PROCESSES, PROCESS_STATS, queryFile } from './perfetto.js';

const frameStatsSql = (pkg: string) => `
INCLUDE PERFETTO MODULE android.frames.timeline;
INCLUDE PERFETTO MODULE android.frames.per_frame_metrics;
SELECT s.overrun, s.cpu_time FROM android_frame_stats s JOIN android_frames f USING (frame_id)
  WHERE f.process_name = '${pkg}';`;

/** Frames since the stats were last reset, then a reset (the next read starts a new window). */
export async function frames(
  d: PerfDevice,
  pkg: string,
  opts: { reset?: boolean } = {},
): Promise<Measured<FrameStats>> {
  await d.readyToMeasure();
  assertPkg(pkg);
  const raw = await sh(
    d,
    `dumpsys gfxinfo ${pkg} framestats${opts.reset === false ? '' : `; dumpsys gfxinfo ${pkg} reset > /dev/null`}`,
  );
  if (/No process found/i.test(raw))
    throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not running`);
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
 * twice (142 frames rendered for 71 rows).
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
  return { ...m, value: { ...m.value, frozenFrames } };
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
      'buffers { size_kb: 32768 fill_policy: RING_BUFFER }',
      'data_sources { config { name: "android.surfaceflinger.frametimeline" } }',
      `data_sources { config { name: "linux.ftrace" ftrace_config { ${NAME_NEW_PROCESSES} atrace_categories: "view" atrace_categories: "gfx" atrace_apps: "${pkg}" } } }`,
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
  return {
    value: { ...parseFrameTimelineCsv(raw), ...(stats && { stats }), tracePath: file },
    raw,
    at: at(),
  };
}

/** The frame timeline over `seconds`. */
export async function frameTrace(
  d: PerfDevice,
  pkg: string,
  seconds: number,
  during?: () => Promise<unknown>,
): Promise<Measured<FrameTrace>> {
  await d.readyToMeasure();
  const m = await frameTimeline(d, pkg, seconds * 1000, during);
  return { value: { kind: 'timeline', ...m.value }, raw: m.raw, at: m.at };
}
