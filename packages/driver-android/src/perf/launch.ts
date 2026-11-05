import {
  sleep,
  type LaunchReading,
  median,
  type LaunchMode,
  type CompileMode,
  type Measured,
  type StartupAnalysis,
  run,
  reportProgress,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg } from '../adb.js';
import { traceProcessor } from '../tools.js';
import {
  type LaunchSample,
  parseAmStart,
  parseFullyDrawn,
  parseCompileStatus,
  parseStartup,
} from './parse.js';
import { NAME_NEW_PROCESSES, PROCESS_STATS, recordTrace, queryFile } from './perfetto.js';
import { type PerfDevice, sh, at } from './shared.js';

export type LaunchStats = LaunchReading & { samples: LaunchSample[] };

/** In whole milliseconds, as the system reports a launch; nothing for no samples. */
const medianMs = (xs: number[]) => (xs.length ? Math.round(median(xs)) : undefined);

/** How long a launch's first run waits for "Fully drawn": an app that never reports it costs this once. */
const FULLY_DRAWN_WAIT_MS = 5_000;

/** `am start -f`: NEW_TASK | CLEAR_TASK, the activity made anew in a live process (as Macrobenchmark's warm). */
const RECREATE_ACTIVITY = '0x10008000';

const startupConfig = (pkg: string) => [
  'buffers { size_kb: 65536 fill_policy: RING_BUFFER }',
  `data_sources { config { name: "linux.ftrace" ftrace_config { ftrace_events: "sched/sched_switch" ftrace_events: "sched/sched_waking" ftrace_events: "sched/sched_blocked_reason" ${NAME_NEW_PROCESSES} atrace_categories: "am" atrace_categories: "view" atrace_categories: "gfx" atrace_categories: "dalvik" atrace_categories: "res" atrace_categories: "binder_driver" atrace_apps: "${pkg}" } } }`,
  // the time to initial display is read off the frame timeline
  'data_sources { config { name: "android.surfaceflinger.frametimeline" } }',
  'data_sources { config { name: "android.packages_list" } }',
  PROCESS_STATS,
  'duration_ms: 60000',
];

const startupSql = (pkg: string) => `
INCLUDE PERFETTO MODULE android.startup.startups;
INCLUDE PERFETTO MODULE android.startup.startup_breakdowns;
INCLUDE PERFETTO MODULE android.startup.time_to_display;
WITH s AS (SELECT * FROM android_startups WHERE package = '${pkg}' ORDER BY ts DESC LIMIT 1)
SELECT 'type' AS k, s.startup_type AS a, s.dur AS b FROM s
UNION ALL
SELECT 'display', d.time_to_initial_display, d.time_to_full_display
  FROM android_startup_time_to_display d JOIN s USING (startup_id)
UNION ALL
SELECT 'reason', b.reason, SUM(b.dur)
  FROM android_startup_opinionated_breakdown b JOIN s USING (startup_id) GROUP BY b.reason
UNION ALL
SELECT 'odex', sl.name, NULL
  FROM slice sl JOIN thread_track tt ON sl.track_id = tt.id JOIN thread t USING (utid) JOIN process p USING (upid)
  WHERE p.name = '${pkg}' AND sl.name GLOB 'location=* status=* filter=* reason=*';`;

/**
 * Launch time: `repeats` launches after one warm-up, the median of their TotalTime (TTID) and of their
 * "Fully drawn" (TTFD). Cold: the app is stopped first; warm: from home, its activity made anew in the
 * live process; hot: from home, its activity brought back. Only launches the system reports in the
 * asked state count. `compile` holds for the whole measure and is reset after; `trace` adds one launch
 * inside a Perfetto recording, which is kept and analysed.
 */
export async function launch(
  d: PerfDevice,
  pkg: string,
  opts: { mode?: LaunchMode; repeats?: number; compile?: CompileMode; trace?: boolean } = {},
): Promise<Measured<LaunchStats>> {
  await d.readyToMeasure();
  assertPkg(pkg);
  const mode = opts.mode ?? 'cold';
  const repeats = Math.min(Math.max(opts.repeats ?? 3, 1), 10);
  if (opts.trace) await traceProcessor();
  const component = (
    await sh(d, `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${pkg}`)
  )
    .trim()
    .split('\n')
    .pop()!;
  if (!component.includes('/'))
    throw new DeviceError('APP_NOT_RUNNING', `${pkg} has no launcher activity`);
  const flags = mode === 'warm' ? `-f ${RECREATE_ACTIVITY} ` : '';
  const prepare = async () => {
    // measuring takes longer than a phone's screen stays on, and a dark one starts nothing: it reads UNKNOWN (0)
    await d.ensureAwake();
    if (mode === 'cold') await sh(d, `am force-stop ${pkg}`);
    else {
      await sh(d, 'input keyevent KEYCODE_HOME');
      await sleep(800);
    }
  };
  const raws: string[] = [];
  let drawnWaitMs = mode === 'hot' ? 0 : FULLY_DRAWN_WAIT_MS;
  /** One launch and its "Fully drawn" line, read from the log since it began (the log stays as it is). */
  const launchOnce = async (): Promise<LaunchSample> => {
    const since = (await sh(d, 'date +%s.%N')).trim();
    const raw = await sh(d, `am start -W ${flags}-n ${component}`, 60_000);
    const s = parseAmStart(raw);
    const started = Date.now();
    let log: string;
    let drawn: number | undefined;
    do {
      await sleep(200);
      log = await sh(
        d,
        `logcat -v epoch -d -T ${since} -s ActivityTaskManager:I ActivityManager:I`,
      );
      drawn = parseFullyDrawn(log, pkg);
    } while (drawn === undefined && Date.now() - started < drawnWaitMs);
    await sleep(Math.max(0, 1_000 - (Date.now() - started)));
    raws.push(
      raw,
      log
        .split('\n')
        .filter((l) => l.includes(pkg))
        .join('\n'),
    );
    if (drawn !== undefined) s.fullyDrawnMs = drawn;
    return s;
  };
  let compile: LaunchReading['compile'];
  let startup: StartupAnalysis | undefined;
  const samples: LaunchSample[] = [];
  try {
    if (opts.compile) {
      await sh(d, `cmd package compile -m ${opts.compile} -f ${pkg}`, 300_000);
      const status = parseCompileStatus(await dexoptState(d, pkg));
      compile = { asked: opts.compile, ...(status && { status }) };
    }
    // warm and hot start from one known task: a task begun by another intent gets a new activity on top
    if (mode !== 'cold') {
      await sh(d, `am force-stop ${pkg}`);
      await sh(d, `am start -W -n ${component} > /dev/null`, 60_000);
    }
    for (let i = 0; i <= repeats; i++) {
      reportProgress(`launch ${i + 1} of ${repeats + 1}`);
      await prepare();
      const s = await launchOnce();
      if (i === 0) {
        if (s.fullyDrawnMs === undefined) drawnWaitMs = 0;
      } else samples.push(s); // the first launch warms caches up
    }
    if (opts.trace) {
      await prepare();
      const trace = await recordTrace(d, pkg, 'launch', startupConfig(pkg), {
        during: launchOnce,
        stop: true,
      });
      startup = await analyseStartup(pkg, trace);
    }
  } finally {
    if (opts.compile) await sh(d, `cmd package compile --reset ${pkg}`, 300_000);
  }
  const want = mode.toUpperCase();
  const ok = samples.filter((s) => s.totalMs !== undefined && s.state === want);
  const m = medianMs(ok.map((s) => s.totalMs!));
  const drawn = medianMs(ok.flatMap((s) => s.fullyDrawnMs ?? []));
  return {
    value: {
      mode,
      samples,
      ...(m !== undefined && { medianMs: m }),
      ...(drawn !== undefined && { fullyDrawnMedianMs: drawn }),
      ...(compile && { compile }),
      ...(startup && { startup }),
    },
    raw: raws.join('\n---\n'),
    at: at(),
  };
}

/** What the device says about the app's compiled code; both formats name status and reason. */
export function dexoptState(d: PerfDevice, pkg: string) {
  return sh(d, `dumpsys package dexopt | grep -A 3 '\\[${pkg}\\]'`, 60_000);
}

export async function analyseStartup(pkg: string, file: string): Promise<StartupAnalysis> {
  const csv = await queryFile(file, startupSql(pkg));
  const { stdout: metric } = await run(
    await traceProcessor(),
    ['--run-metrics', 'android_startup', '--metrics-output=json', file],
    { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
  );
  return parseStartup(csv, metric, pkg, file);
}
