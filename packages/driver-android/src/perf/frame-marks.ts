import { type FrameMarks, type InputMark, type Measured } from '@appdyno/core';
import { assertPkg } from '../adb.js';
import { traceProcessor } from '../tools.js';
import { cellNum, nsToMs, parseCsv } from './parse-common.js';
import {
  NAME_NEW_PROCESSES,
  PROCESS_STATS,
  queryFile,
  recordTrace,
  REMOTE_TRACES,
} from './perfetto.js';
import { at, type PerfDevice } from './shared.js';

const TRACE_NAME = 'timeline';

/** What says a frame was the app's fault, as the frame reading counts it. */
const APP_LATE = /App Deadline Missed|App Resynced Jitter/;

/** Events this close are one touch: a swipe is an event every few ms. */
const SAME_TOUCH_MS = 150;

/** This config wrote 120 KB a second on an emulator drawing all the time; four times that, for a screen of 120 Hz. */
const KB_A_SECOND = 512;
const WHOLE_RING_KB = 65_536;
const LEAST_RING_KB = 8_192;

const ringKb = (keepSeconds?: number) =>
  keepSeconds === undefined
    ? WHOLE_RING_KB
    : Math.max(LEAST_RING_KB, Math.min(keepSeconds * KB_A_SECOND, WHOLE_RING_KB));

/**
 * Lean, so that it can run for minutes: no scheduler or binder events, which fill a ring in under a minute, and which
 * only say why a frame was late. `view` holds the frames' doFrame and every input event the app is handed.
 */
const config = (pkg: string, ms: number, keepSeconds?: number) => [
  `buffers { size_kb: ${ringKb(keepSeconds)} fill_policy: RING_BUFFER }`,
  'data_sources { config { name: "android.surfaceflinger.frametimeline" } }',
  `data_sources { config { name: "linux.ftrace" ftrace_config { ${NAME_NEW_PROCESSES} atrace_categories: "view" atrace_apps: "${pkg}" } } }`,
  PROCESS_STATS,
  `duration_ms: ${ms}`,
];

// in µs: a wall clock in ns is past what a double holds, and the CSV is read into doubles
const framesSql = (pkg: string) => `
SELECT to_realtime(a.ts) / 1000 AS at_us, a.dur, a.jank_type
FROM actual_frame_timeline_slice a JOIN process p USING (upid)
WHERE p.name = '${pkg}' ORDER BY a.ts;`;

const inputSql = (pkg: string) => `
SELECT to_realtime(s.ts) / 1000 AS at_us, s.dur
FROM slice s JOIN thread_track tt ON s.track_id = tt.id JOIN thread t USING (utid) JOIN process p USING (upid)
WHERE p.name = '${pkg}' AND s.name GLOB 'deliverInputEvent*' ORDER BY s.ts;`;

const usToMs = (us: number) => us / 1_000;

/** The frames query's rows, as frames on the device's clock. */
export function parseFrameMarks(csv: string): FrameMarks['frames'] {
  const { columns, rows } = parseCsv(csv);
  const cell = (r: string[], name: string) => r[columns.indexOf(name)];
  return rows.flatMap((r) => {
    const us = cellNum(cell(r, 'at_us'));
    const dur = cellNum(cell(r, 'dur'));
    if (us === undefined || dur === undefined) return [];
    return [
      {
        at: usToMs(us),
        ms: nsToMs(dur),
        ...(APP_LATE.test(cell(r, 'jank_type') ?? '') && { late: true }),
      },
    ];
  });
}

/** The input query's rows as touches: events in a run make one, from its first to the end of its last. */
export function parseInputMarks(csv: string): InputMark[] {
  const { columns, rows } = parseCsv(csv);
  const out: InputMark[] = [];
  for (const r of rows) {
    const us = cellNum(r[columns.indexOf('at_us')]);
    const dur = cellNum(r[columns.indexOf('dur')]) ?? 0;
    if (us === undefined) continue;
    const from = usToMs(us);
    const to = from + nsToMs(dur);
    const last = out.at(-1);
    if (last && from - (last.at + last.ms) < SAME_TOUCH_MS) last.ms = to - last.at;
    else out.push({ at: from, ms: to - from });
  }
  return out;
}

const LIMITS =
  "Perfetto's frame timeline. A main thread held up while the render thread goes on animating draws no long frame: the log's Skipped frames lines show those.";

/** Frames and input as Perfetto has them, on the wall clock its own clock snapshots give. */
export async function frameMarks(
  d: PerfDevice,
  pkg: string,
  seconds: number,
  during: () => Promise<unknown>,
  keepSeconds?: number,
): Promise<Measured<FrameMarks>> {
  await d.readyToMeasure();
  assertPkg(pkg);
  await traceProcessor();
  // a process that died with one running leaves its file, and only this name says whose it was
  await d.shell(`rm -f ${REMOTE_TRACES}/appdyno-${TRACE_NAME}-*`).catch(() => undefined);
  const tracePath = await recordTrace(
    d,
    pkg,
    TRACE_NAME,
    config(pkg, seconds * 1000, keepSeconds),
    { during, stop: true },
  );
  const raw = await queryFile(tracePath, framesSql(pkg));
  return {
    value: {
      frames: parseFrameMarks(raw),
      input: parseInputMarks(await queryFile(tracePath, inputSql(pkg))),
      limits: LIMITS,
      tracePath,
    },
    raw,
    at: at(),
    source: 'perfetto frame timeline',
  };
}
