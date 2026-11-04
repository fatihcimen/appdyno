import type { FrameCause, SlowFrameCauses } from '@appdyno/core';
import { parseCsv, cellNum } from './parse-common.js';

/**
 * Where the main thread's time went during the frames that missed, from Perfetto's modules. Each frame's window is its
 * `doFrame`.
 * shortcut: a stall before `doFrame` began, or on the render thread, is not in that window, and reads as unexplained;
 * widen the window to the frame's vsync if a real app shows those
 */
export const frameCauseSql = (pkg: string) => `
INCLUDE PERFETTO MODULE android.frames.timeline;
INCLUDE PERFETTO MODULE android.frames.per_frame_metrics;
INCLUDE PERFETTO MODULE android.monitor_contention;
INCLUDE PERFETTO MODULE android.binder;
WITH slow AS (
  SELECT f.frame_id, d.ts AS start_ts, d.ts + d.dur AS end_ts, f.ui_thread_utid AS utid
  FROM android_frames f
  JOIN android_frame_stats s USING (frame_id)
  JOIN slice d ON d.id = f.do_frame_id
  WHERE f.process_name = '${pkg}' AND s.overrun > 0
), spans AS (
  SELECT 'lock' AS cause, blocked_utid AS utid, ts, dur,
    blocking_thread_name || ' in ' || short_blocking_method AS detail
  FROM android_monitor_contention
  UNION ALL
  SELECT 'binder', client_utid, client_ts, client_dur, COALESCE(aidl_name, server_process)
  FROM android_binder_txns
  UNION ALL
  SELECT 'gc', t.utid, s.ts, s.dur, s.name
  FROM slice s JOIN thread_track t ON s.track_id = t.id
  WHERE s.name GLOB 'GC: Wait For Completion*'
  UNION ALL
  SELECT CASE WHEN state = 'Running' THEN 'busy' WHEN state GLOB 'R*' THEN 'starved'
    WHEN state GLOB 'D*' THEN 'io' ELSE 'sleeping' END, utid, ts, dur, NULL
  FROM thread_state
), hit AS (
  SELECT p.cause, w.frame_id, MIN(p.ts + p.dur, w.end_ts) - MAX(p.ts, w.start_ts) AS ns, p.detail
  FROM slow w JOIN spans p ON p.utid = w.utid AND p.ts < w.end_ts AND p.ts + p.dur > w.start_ts
)
SELECT cause, SUM(ns) AS ns, COUNT(DISTINCT frame_id) AS frames, MAX(ns) AS longest, detail
FROM hit GROUP BY cause
UNION ALL SELECT 'slow_frames', 0, COUNT(*), 0, NULL FROM slow;`;

/** Less than this a slow frame, or this share of its main thread's time, names nothing: it would be a guess. */
const FLOOR_MS_A_FRAME = 10;
const FLOOR_SHARE = 0.4;

/** What waits sleeping on the main thread, and so is counted in `sleeping` as well: it is taken out of that. */
const SLEEPS: FrameCause[] = ['lock', 'binder', 'gc'];

/** The rows of `frameCauseSql`, longest first, with the one that clears the floors. */
export function parseFrameCauses(csv: string): SlowFrameCauses | undefined {
  const { columns, rows } = parseCsv(csv);
  const col = (r: string[], name: string) => r[columns.indexOf(name)];
  const slowFrames = cellNum(
    col(rows.find((r) => col(r, 'cause') === 'slow_frames') ?? [], 'frames'),
  );
  if (!slowFrames) return slowFrames === 0 ? { slowFrames: 0, causes: [] } : undefined;
  const read = rows
    .filter((r) => col(r, 'cause') !== 'slow_frames')
    .map((r) => ({
      cause: col(r, 'cause') as FrameCause,
      ms: (cellNum(col(r, 'ns')) ?? 0) / 1e6,
      frames: cellNum(col(r, 'frames')) ?? 0,
      detail: col(r, 'detail'),
    }));
  const asleepOther = read.filter((c) => SLEEPS.includes(c.cause)).reduce((a, c) => a + c.ms, 0);
  const spent = read
    .map((c) => (c.cause === 'sleeping' ? { ...c, ms: Math.max(0, c.ms - asleepOther) } : c))
    .filter((c) => c.ms > 0)
    .sort((a, b) => b.ms - a.ms);
  const whole = spent.reduce((a, c) => a + c.ms, 0);
  const causes = spent.map((c) => ({
    cause: c.cause,
    msPerFrame: Math.round((c.ms / slowFrames) * 10) / 10,
    share: Math.round((c.ms / whole) * 1000) / 10,
    frames: c.frames,
    ...(c.detail && c.detail !== '[NULL]' && { detail: c.detail }),
  }));
  const first = causes[0];
  const clears = first && first.msPerFrame >= FLOOR_MS_A_FRAME && first.share >= FLOOR_SHARE * 100;
  return { slowFrames, causes, ...(clears && { top: first.cause }) };
}
