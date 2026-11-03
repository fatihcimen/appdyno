import type { Measured, FrameStats, FrameTimeline, FrameTrace } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg } from '../adb.js';
import { traceProcessor } from '../tools.js';
import { parseFrameStats, parseAndroidFrameStats, parseFrameTimelineCsv } from './parse.js';
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
