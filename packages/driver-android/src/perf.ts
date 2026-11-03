import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import {
  stateDir,
  type BuildType,
  type CompileMode,
  type CpuProfile,
  type DeviceVitals,
  type EnergyReading,
  type ExitReading,
  type FrameStats,
  type FrameTimeline,
  type FrameTrace,
  type HeapProfile,
  type HeapProfileKind,
  type HeapReading,
  type LaunchMode,
  type LaunchReading,
  type Measured,
  type MeasureSource,
  type MemoryReading,
  type NetworkReading,
  type SizeReading,
  type StartupAnalysis,
  type ThreadReading,
  type TraceDigest,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { shq } from './adb.js';
import { parseExitInfo } from './crashes.js';
import { traceProcessor } from './tools.js';
import type { AndroidDevice } from './device.js';
import {
  parseAmStart,
  parseAndroidFrameStats,
  parseBatteryUsage,
  usageSince,
  parseBuildType,
  parseCompileStatus,
  parseCsv,
  parseDiskstats,
  parseFrameStats,
  parseFrameTimelineCsv,
  parseFullyDrawn,
  parseMeminfo,
  parseNetstatsUid,
  parseProcStatTicks,
  parseStartup,
  parseThreadReads,
  parseVitals,
  type LaunchSample,
  type MemoryStats,
  parseSimpleperfReport,
} from './perf-parse.js';

const run = promisify(execFile);

export type HeapDump = { file: string; bytes: number };

export type CpuStats = {
  percent: number;
  windowMs: number;
  ticks: number;
  clockTicksPerSec: number;
};
export type LaunchStats = LaunchReading & { samples: LaunchSample[] };

const PKG = /^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/;
const assertPkg = (p: string) => {
  if (!PKG.test(p)) throw new DeviceError('INVALID_ARGUMENT', `not a package name: ${p}`);
  return p;
};
const at = () => new Date().toISOString();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return undefined;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1]! + s[m]!) / 2);
};

/** How long a launch's first run waits for "Fully drawn": an app that never reports it costs this once. */
const FULLY_DRAWN_WAIT_MS = 5_000;
/** `am start -f`: NEW_TASK | CLEAR_TASK, the activity made anew in a live process (as Macrobenchmark's warm). */
const RECREATE_ACTIVITY = '0x10008000';

/**
 * Without these a process born during the trace keeps the name zygote gave it, and nothing in the trace
 * is about the app (the start scan of `linux.process_stats` sees only what runs already).
 */
const NAME_NEW_PROCESSES =
  'ftrace_events: "task/task_newtask" ftrace_events: "task/task_rename" ftrace_events: "sched/sched_process_exit" ftrace_events: "sched/sched_process_free"';
const PROCESS_STATS =
  'data_sources { config { name: "linux.process_stats" target_buffer: 0 process_stats_config { scan_all_processes_on_start: true } } }';

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

const frameStatsSql = (pkg: string) => `
INCLUDE PERFETTO MODULE android.frames.timeline;
INCLUDE PERFETTO MODULE android.frames.per_frame_metrics;
SELECT s.overrun, s.cpu_time FROM android_frame_stats s JOIN android_frames f USING (frame_id)
  WHERE f.process_name = '${pkg}';`;

/** Memory still held, by the function that asked for it: the leaf of a stack is malloc or operator new. */
const HEAPPROFD_SITES_SQL = `
WITH RECURSIVE up(leaf, depth, parent, name) AS (
  SELECT c.id, c.depth, c.parent_id, f.name
    FROM stack_profile_callsite c JOIN stack_profile_frame f ON f.id = c.frame_id
    WHERE c.id IN (SELECT callsite_id FROM heap_profile_allocation)
  UNION ALL
  SELECT up.leaf, c.depth, c.parent_id, f.name
    FROM up JOIN stack_profile_callsite c ON c.id = up.parent JOIN stack_profile_frame f ON f.id = c.frame_id
    WHERE up.name GLOB '*alloc*' OR up.name GLOB '_Zn[wa]*'
), site AS (SELECT leaf, name, MIN(depth) FROM up GROUP BY leaf)
SELECT s.name AS name, SUM(a.size) AS bytes, SUM(a.count) AS count
  FROM heap_profile_allocation a JOIN site s ON s.leaf = a.callsite_id
  GROUP BY s.name HAVING bytes > 0 ORDER BY bytes DESC;`;

/** The trace processor's answer to `sql`, as its CSV text. */
async function queryFile(file: string, sql: string): Promise<string> {
  const tp = await traceProcessor();
  const dir = await mkdtemp(join(tmpdir(), 'appdyno-trace-'));
  try {
    const query = join(dir, 'query.sql');
    await writeFile(query, sql);
    const { stdout } = await run(tp, ['-q', query, file], {
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const CELL_CHARS = 200;
const INCLUDE = /^\s*INCLUDE\s+PERFETTO\s+MODULE\s+[\w.*]+\s*;/i;
// strings, quoted names and comments, whatever they hold, say nothing about what the statement does
const LITERALS = /'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\//g;
// a WITH may lead a write; SELECT cannot hold one
const WRITES =
  /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|REPLACE\s+INTO)\b/i;

/** Module includes, then one SELECT or WITH that writes nothing, or a DeviceError. */
export function assertReadOnlySql(sql: string): void {
  const refuse = (why: string) =>
    new DeviceError(
      'INVALID_ARGUMENT',
      `not a read-only query: ${why}`,
      'INCLUDE PERFETTO MODULE lines, then one SELECT or WITH',
    );
  let rest = sql.replace(LITERALS, ' ');
  if (/['"`]|\/\*/.test(rest)) throw refuse('an unclosed string or comment');
  while (INCLUDE.test(rest)) rest = rest.replace(INCLUDE, '');
  if (!/^\s*(SELECT|WITH)\b/i.test(rest)) throw refuse('it must be one SELECT or WITH');
  if (rest.replace(/;\s*$/, '').includes(';')) throw refuse('more than one statement');
  const write = WRITES.exec(rest);
  if (write) throw refuse(`it holds ${write[1]}`);
}

/** A bounded table from a kept Perfetto trace; undefined for a file of another kind. */
export async function queryTrace(
  tracePath: string,
  q: { sql?: string; limit: number },
): Promise<TraceDigest | undefined> {
  if (!/\.(pftrace|perfetto-trace)$/.test(tracePath)) return undefined;
  if (!q.sql) throw new DeviceError('INVALID_ARGUMENT', 'a Perfetto trace is asked with sql');
  assertReadOnlySql(q.sql);
  // absolute: a path that starts with a dash would read as an option
  const file = resolve(tracePath);
  const csv = await queryFile(file, q.sql).catch((e: { stderr?: string; message: string }) => {
    if (e instanceof DeviceError) throw e;
    const why = (e.stderr ?? e.message).split('\n').slice(-6).join('\n').trim();
    throw new DeviceError('INVALID_ARGUMENT', `the trace processor refused: ${why}`);
  });
  const { columns, rows } = parseCsv(csv);
  const limit = Math.max(q.limit, 0);
  return {
    tracePath: file,
    source: 'perfetto trace processor',
    columns,
    rows: rows.slice(0, limit).map((r) => r.map((c) => c.slice(0, CELL_CHARS))),
    dropped: Math.max(rows.length - limit, 0),
  };
}

/**
 * The app's and the device's performance on Android, from the platform's own tools: frames (gfxinfo,
 * Perfetto's frame timeline), memory (meminfo), CPU (/proc), launch time (`am start -W`) and the
 * device's state while measuring (load, CPU pressure, memory, thermal status, battery temperature).
 * Commands run in the C locale (a localized device writes `0,0`).
 */
export class AndroidPerf implements MeasureSource {
  constructor(private readonly device: AndroidDevice) {}

  get virtual() {
    return /^emulator-/.test(this.device.serial);
  }

  private sh(cmd: string, timeoutMs?: number) {
    return this.device.shell(`LC_ALL=C ${cmd}`, timeoutMs);
  }

  /** Frames since the stats were last reset, then a reset (the next read starts a new window). */
  async frames(pkg: string, opts: { reset?: boolean } = {}): Promise<Measured<FrameStats>> {
    await this.device.readyToMeasure();
    assertPkg(pkg);
    const raw = await this.sh(
      `dumpsys gfxinfo ${pkg} framestats${opts.reset === false ? '' : `; dumpsys gfxinfo ${pkg} reset > /dev/null`}`,
    );
    if (/No process found/i.test(raw))
      throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not running`);
    return { value: parseFrameStats(raw), raw, at: at() };
  }

  async resetFrames(pkg: string) {
    await this.device.readyToMeasure();
    await this.sh(`dumpsys gfxinfo ${assertPkg(pkg)} reset > /dev/null`);
  }

  async memory(pkg: string): Promise<Measured<MemoryStats & MemoryReading>> {
    assertPkg(pkg);
    const raw = await this.sh(`dumpsys meminfo ${pkg}`);
    if (/No process found/i.test(raw))
      throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not running`);
    const stats = parseMeminfo(raw);
    return { value: { ...stats, kb: stats.pssKb, kind: 'pss' }, raw, at: at() };
  }

  async pid(pkg: string): Promise<number> {
    const out = (await this.sh(`pidof ${assertPkg(pkg)}`)).trim();
    const pid = Number(out.split(/\s+/)[0]);
    if (!out || !Number.isInteger(pid))
      throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not running`);
    return pid;
  }

  /** The app's CPU over `windowMs`: its CPU time before and after, as % of one core. */
  async cpu(pkg: string, windowMs = 2_000): Promise<Measured<CpuStats>> {
    const pid = await this.pid(pkg);
    const read = () => this.sh(`cat /proc/${pid}/stat; getconf CLK_TCK`);
    const a = await read();
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, windowMs));
    const b = await read();
    const ms = Date.now() - t0;
    const hz = Number(b.trim().split('\n').pop()) || 100;
    const ticks = parseProcStatTicks(b.split('\n')[0]!) - parseProcStatTicks(a.split('\n')[0]!);
    const percent = Math.round(((ticks / hz) * 1000 * 1000) / ms) / 10;
    return {
      value: { percent, windowMs: ms, ticks, clockTicksPerSec: hz },
      raw: `${a}\n---\n${b}`,
      at: at(),
    };
  }

  /**
   * Launch time: `repeats` launches after one warm-up, the median of their TotalTime (TTID) and of their
   * "Fully drawn" (TTFD). Cold: the app is stopped first; warm: from home, its activity made anew in the
   * live process; hot: from home, its activity brought back. Only launches the system reports in the
   * asked state count. `compile` holds for the whole measure and is reset after; `trace` adds one launch
   * inside a Perfetto recording, which is kept and analysed.
   */
  async launch(
    pkg: string,
    opts: { mode?: LaunchMode; repeats?: number; compile?: CompileMode; trace?: boolean } = {},
  ): Promise<Measured<LaunchStats>> {
    await this.device.readyToMeasure();
    assertPkg(pkg);
    const mode = opts.mode ?? 'cold';
    const repeats = Math.min(Math.max(opts.repeats ?? 3, 1), 10);
    if (opts.trace) await traceProcessor();
    const component = (
      await this.sh(
        `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${pkg}`,
      )
    )
      .trim()
      .split('\n')
      .pop()!;
    if (!component.includes('/'))
      throw new DeviceError('APP_NOT_RUNNING', `${pkg} has no launcher activity`);
    const flags = mode === 'warm' ? `-f ${RECREATE_ACTIVITY} ` : '';
    const prepare = async () => {
      // measuring takes longer than a phone's screen stays on, and a dark one starts nothing: it reads UNKNOWN (0)
      await this.device.ensureAwake();
      if (mode === 'cold') await this.sh(`am force-stop ${pkg}`);
      else {
        await this.sh('input keyevent KEYCODE_HOME');
        await pause(800);
      }
    };
    const raws: string[] = [];
    let drawnWaitMs = mode === 'hot' ? 0 : FULLY_DRAWN_WAIT_MS;
    /** One launch and its "Fully drawn" line, read from the log since it began (the log stays as it is). */
    const launchOnce = async (): Promise<LaunchSample> => {
      const since = (await this.sh('date +%s.%N')).trim();
      const raw = await this.sh(`am start -W ${flags}-n ${component}`, 60_000);
      const s = parseAmStart(raw);
      const started = Date.now();
      let log: string;
      let drawn: number | undefined;
      do {
        await pause(200);
        log = await this.sh(
          `logcat -v epoch -d -T ${since} -s ActivityTaskManager:I ActivityManager:I`,
        );
        drawn = parseFullyDrawn(log, pkg);
      } while (drawn === undefined && Date.now() - started < drawnWaitMs);
      await pause(Math.max(0, 1_000 - (Date.now() - started)));
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
        await this.sh(`cmd package compile -m ${opts.compile} -f ${pkg}`, 300_000);
        const status = parseCompileStatus(await this.dexoptState(pkg));
        compile = { asked: opts.compile, ...(status && { status }) };
      }
      // warm and hot start from one known task: a task begun by another intent gets a new activity on top
      if (mode !== 'cold') {
        await this.sh(`am force-stop ${pkg}`);
        await this.sh(`am start -W -n ${component} > /dev/null`, 60_000);
      }
      for (let i = 0; i <= repeats; i++) {
        await prepare();
        const s = await launchOnce();
        if (i === 0) {
          if (s.fullyDrawnMs === undefined) drawnWaitMs = 0;
        } else samples.push(s); // the first launch warms caches up
      }
      if (opts.trace) {
        await prepare();
        const trace = await this.record(pkg, 'launch', startupConfig(pkg), {
          during: launchOnce,
          stop: true,
        });
        startup = await this.analyseStartup(pkg, trace);
      }
    } finally {
      if (opts.compile) await this.sh(`cmd package compile --reset ${pkg}`, 300_000);
    }
    const want = mode.toUpperCase();
    const ok = samples.filter((s) => s.totalMs !== undefined && s.state === want);
    const m = median(ok.map((s) => s.totalMs!));
    const drawn = median(ok.flatMap((s) => s.fullyDrawnMs ?? []));
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
  private dexoptState(pkg: string) {
    return this.sh(`dumpsys package dexopt | grep -A 3 '\\[${pkg}\\]'`, 60_000);
  }

  /**
   * The app as it is built: what a number of this build can be compared with. Android 14 prints no
   * profileable flag in `dumpsys package` even for a profileable build; Perfetto's package list has it
   * (so without the trace processor a build that is not debuggable is unknown).
   */
  async buildType(pkg: string): Promise<BuildType> {
    assertPkg(pkg);
    const flags = parseBuildType(
      await this.sh(`dumpsys package ${pkg} | grep -E '^ *(pkg|private|privatePkg)?[fF]lags=\\['`),
    );
    if (flags !== 'release') return flags;
    try {
      await traceProcessor();
      const file = await this.record(pkg, 'packages', [
        'buffers { size_kb: 4096 }',
        'data_sources { config { name: "android.packages_list" } }',
        'duration_ms: 100',
      ]);
      try {
        const csv = await queryFile(
          file,
          `SELECT profileable_from_shell FROM package_list WHERE package_name = '${pkg}';`,
        );
        return parseCsv(csv).rows[0]?.[0] === '1' ? 'profileable' : 'release';
      } finally {
        await rm(file, { force: true });
      }
    } catch {
      return 'unknown';
    }
  }

  /** The uid the app's processes run as. */
  private async uid(pkg: string): Promise<number> {
    assertPkg(pkg);
    const out = await this.sh(`pm list packages -U ${pkg}`);
    const uid = new RegExp(`^package:${pkg.replace(/\./g, '\\.')} uid:(\\d+)`, 'm').exec(out)?.[1];
    if (!uid) throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not installed`);
    return Number(uid);
  }

  /**
   * Each thread's CPU over the window, read every 500 ms by one shell loop on the device (so adb's own
   * delays do not move the reads). `over90Ms`: how long a thread stayed above 90 percent of a core.
   */
  async threads(pkg: string, windowMs: number): Promise<Measured<ThreadReading>> {
    const pid = await this.pid(pkg);
    const reads = Math.max(Math.round(windowMs / 500), 1) + 1;
    const raw = await this.device.shellAlongside(
      `echo hz $(getconf CLK_TCK); i=0; while [ $i -lt ${reads} ]; do ` +
        `echo "== $(date +%s%N)"; cat /proc/${pid}/task/*/stat 2>/dev/null; ` +
        `i=$((i+1)); [ $i -lt ${reads} ] && sleep 0.5; done`,
      windowMs + 30_000,
    );
    return { value: parseThreadReads(raw), raw, at: at() };
  }

  /**
   * What the app's uid sent and received over the window (Android's own traffic accounting). netstats
   * counts on poll: `--poll` first, and it prints nothing else, so the read is a second command.
   */
  async network(
    pkg: string,
    windowMs: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<NetworkReading>> {
    const uid = await this.uid(pkg);
    const read = async () => {
      await this.sh('dumpsys netstats --poll');
      return this.sh('dumpsys netstats --uid', 60_000);
    };
    const a = await read();
    const t0 = Date.now();
    await Promise.all([during?.(), pause(windowMs)]);
    const b = await read();
    const [before, after] = [parseNetstatsUid(a, uid), parseNetstatsUid(b, uid)];
    return {
      value: {
        windowMs: Date.now() - t0,
        rxBytes: after.rxBytes - before.rxBytes,
        txBytes: after.txBytes - before.txBytes,
        note: `everything uid ${uid} moved over the network, IP and TCP headers included; not loopback, and not what another process fetched for the app`,
      },
      raw: `${a}\n---\n${b}`,
      at: at(),
    };
  }

  /**
   * The charge batterystats estimates for the app over the window: the difference of its count since the last
   * charge, whose history is left alone. It counts on battery only, so the phone is told it is unplugged for the
   * time (and told the truth after). An estimate from the power profile's model, not a measure.
   */
  async energy(pkg: string, windowMs: number): Promise<Measured<EnergyReading>> {
    const uid = await this.uid(pkg);
    const noModel = (why: string) =>
      new DeviceError('UNSUPPORTED', `no energy estimate on ${this.device.serial}: ${why}`);
    // the emulator's power profile is all zeros: even a core busy for seconds reads cpu=0
    if (this.virtual) throw noModel('an emulator has no power model, it computes zero');
    try {
      await this.sh('dumpsys battery unplug');
      const read = () => this.sh(`dumpsys batterystats --charged ${pkg}`, 60_000);
      const before = parseBatteryUsage(await read(), uid);
      await pause(windowMs);
      const raw = await read();
      const after = parseBatteryUsage(raw, uid);
      if (after.mah === undefined) throw noModel('batterystats computed no drain at all');
      return {
        value: {
          ...usageSince(before, after),
          note: 'model-based: batterystats multiplies time in each state by the power profile, it does not read a power meter',
        },
        raw,
        at: at(),
      };
    } finally {
      await this.sh('dumpsys battery reset');
    }
  }

  /** How the app's processes ended, as far back as the system keeps (16 by default): crashes and ANRs apart. */
  async exits(pkg: string): Promise<Measured<ExitReading>> {
    assertPkg(pkg);
    const raw = await this.sh(`dumpsys activity exit-info ${pkg}`, 30_000);
    const exits = parseExitInfo(raw);
    return {
      value: {
        crashes: exits.filter((e) => /CRASH/i.test(e.reason)).length,
        anrs: exits.filter((e) => /\bANR\b/i.test(e.reason)).length,
        total: exits.length,
        recent: exits.slice(0, 10).map((e) => ({
          at: e.at,
          reason: e.reason,
          ...(e.detail && { description: e.detail }),
        })),
      },
      raw,
      at: at(),
    };
  }

  /** The installed apks' bytes, each a part; with what `dumpsys diskstats` lists for the app, if it does. */
  async size(pkg: string): Promise<Measured<SizeReading>> {
    assertPkg(pkg);
    const paths = (await this.sh(`pm path ${pkg}`)).match(/(?<=^package:).+/gm) ?? [];
    if (paths.length === 0) throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not installed`);
    const stat = await this.sh(`stat -c '%s %n' ${paths.map((p) => shq(p.trim())).join(' ')}`);
    const disk = await this.sh('dumpsys diskstats', 30_000);
    const parts: Record<string, number> = {};
    for (const [, bytes, path] of stat.matchAll(/^(\d+) (.+)$/gm))
      parts[basename(path!.trim())] = Number(bytes);
    const bytes = Object.values(parts).reduce((a, b) => a + b, 0);
    const listed = parseDiskstats(disk, pkg);
    return {
      value: {
        bytes,
        parts: { ...parts, ...listed },
        note:
          Object.keys(listed).length > 0
            ? '`bytes` counts the apks; code, data and cache are the last daily count of dumpsys diskstats'
            : '`bytes` counts the apks; dumpsys diskstats does not list the app yet',
      },
      raw: `${stat}\n---\n${disk}`,
      at: at(),
    };
  }

  /**
   * A Perfetto heap profile with its largest classes (`java_hprof`, one heap snapshot taken as its data
   * source starts, so after `seconds` and `during`) or allocation sites (`heapprofd`, native memory
   * allocated and not freed while it records). The platform allows either only on a debuggable or
   * profileable build.
   */
  async heapProfile(
    pkg: string,
    kind: HeapProfileKind,
    seconds: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<HeapProfile>> {
    await traceProcessor();
    const build = await this.buildType(pkg);
    if (build !== 'debug' && build !== 'profileable')
      throw new DeviceError(
        'UNSUPPORTED',
        `${kind} needs a debuggable or profileable build of ${pkg}; this one is ${build}`,
        'add <profileable android:shell="true"/> to the manifest',
      );
    await this.pid(pkg);
    const s = Math.min(Math.max(Math.round(seconds), 1), 120);
    if (kind === 'java_hprof') await Promise.all([during?.(), pause(s * 1000)]);
    const trace = await this.record(
      pkg,
      kind,
      kind === 'java_hprof'
        ? [
            'buffers { size_kb: 262144 fill_policy: DISCARD }',
            `data_sources { config { name: "android.java_hprof" java_hprof_config { process_cmdline: "${pkg}" } } }`,
            'data_source_stop_timeout_ms: 100000',
            'duration_ms: 1000',
          ]
        : [
            'buffers { size_kb: 65536 fill_policy: DISCARD }',
            `data_sources { config { name: "android.heapprofd" heapprofd_config { sampling_interval_bytes: 4096 process_cmdline: "${pkg}" shmem_size_bytes: 8388608 block_client: true } } }`,
            'data_source_stop_timeout_ms: 60000',
            `duration_ms: ${s * 1000}`,
          ],
      kind === 'heapprofd' && during ? { during } : {},
    );
    const raw = await queryFile(
      trace,
      kind === 'java_hprof'
        ? `SELECT c.name AS name, SUM(o.self_size) AS bytes, COUNT(*) AS count FROM heap_graph_object o
           JOIN heap_graph_class c ON o.type_id = c.id WHERE o.reachable GROUP BY c.name ORDER BY bytes DESC;`
        : HEAPPROFD_SITES_SQL,
    );
    const rows = parseCsv(raw).rows.map((r) => ({
      name: r[0]!,
      bytes: Number(r[1]),
      count: Number(r[2]),
    }));
    if (rows.length === 0)
      throw new DeviceError('UNSUPPORTED', `${kind} recorded nothing of ${pkg}`);
    return {
      value: {
        kind,
        tracePath: trace,
        top: rows.slice(0, 20),
        totalBytes: rows.reduce((a, r) => a + r.bytes, 0),
      },
      raw: parseCsv(raw).rows.slice(0, 50).join('\n'),
      at: at(),
    };
  }

  /**
   * Records a Perfetto trace while `during` runs and keeps it under the state directory. It ends at its
   * `duration_ms`, or as soon as `during` is over with `stop`.
   */
  private async record(
    pkg: string,
    name: string,
    config: string[],
    opts: { during?: () => Promise<unknown>; stop?: boolean } = {},
  ): Promise<string> {
    const remote = `/data/misc/perfetto-traces/appdyno-${randomBytes(4).toString('hex')}.pftrace`;
    // --background-wait: a launch right after it is inside the recording
    const started = await this.device.shell(
      `echo '${config.join('\n')}' | perfetto --txt -c - -o ${remote} --background-wait 2>&1`,
      45_000,
    );
    const pid = Number(/^(\d+)\s*$/m.exec(started)?.[1]);
    if (!pid)
      throw new DeviceError(
        'UNSUPPORTED',
        `perfetto did not start: ${started.trim().slice(0, 200)}`,
      );
    try {
      if (opts.during) await opts.during();
      if (opts.stop) await this.device.shell(`kill -TERM ${pid}`);
      // the longest asked for, with the time a heap dump may take to end
      const end = Date.now() + 200_000;
      while (
        Date.now() < end &&
        (await this.device.shell(`[ -d /proc/${pid} ] && echo up`)).includes('up')
      )
        await pause(300);
      const trace = await this.device.shellBuffer(`cat ${remote}`, 120_000);
      if (trace.length === 0) throw new DeviceError('INTERNAL', 'the trace is empty');
      const dir = join(stateDir(), 'traces');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, `${pkg}-${name}-${Date.now()}.pftrace`);
      await writeFile(file, trace, { mode: 0o600 });
      return file;
    } finally {
      await this.device.shell(`rm -f ${remote}`).catch(() => undefined);
    }
  }

  private async analyseStartup(pkg: string, file: string): Promise<StartupAnalysis> {
    const csv = await queryFile(file, startupSql(pkg));
    const { stdout: metric } = await run(
      await traceProcessor(),
      ['--run-metrics', 'android_startup', '--metrics-output=json', file],
      { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
    );
    return parseStartup(csv, metric, pkg, file);
  }

  /** The device's own state: load, CPU pressure, memory, thermal status, battery temperature. */
  async vitals(): Promise<Measured<DeviceVitals>> {
    const raw = await this.sh(
      'echo ==load==; cat /proc/loadavg; echo ==parked==; ps -A -o STAT,PID,PPID,WCHAN:24,NAME 2>/dev/null | grep "^D"; ' +
        'echo ==pressure==; cat /proc/pressure/cpu 2>/dev/null; ' +
        'echo ==mem==; head -3 /proc/meminfo; echo ==thermal==; dumpsys thermalservice 2>/dev/null | head -5; ' +
        'echo ==battery==; dumpsys battery 2>/dev/null',
    );
    return { value: parseVitals(raw), raw, at: at() };
  }

  /**
   * Where the app's CPU time goes: `simpleperf` samples its threads for `durationMs` (the app must be
   * debuggable or profileable) and reports the functions by their share of the samples.
   */
  async cpuProfile(
    pkg: string,
    durationMs = 3_000,
    during?: () => Promise<unknown>,
  ): Promise<Measured<CpuProfile>> {
    await this.device.readyToMeasure();
    assertPkg(pkg);
    await this.pid(pkg);
    const s = Math.min(Math.max(Math.round(durationMs / 1000), 1), 30);
    const file = `/data/local/tmp/appdyno-${randomBytes(4).toString('hex')}.data`;
    try {
      const rec = this.device.shellAlongside(
        // the CPU clock (time-based sampling) works on every device; emulators have no cycle counter
        `LC_ALL=C simpleperf record --app ${pkg} -e cpu-clock -f 1000 --duration ${s} -o ${file} 2>&1`,
        (s + 30) * 1000,
      );
      if (during) await during();
      const recorded = await rec;
      if (/ E |error|fail|not supported/i.test(recorded) && !/Samples recorded/i.test(recorded))
        throw new DeviceError(
          'UNSUPPORTED',
          `simpleperf could not record ${pkg}: ${recorded.trim().slice(0, 300)}`,
        );
      const report = await this.sh(
        `simpleperf report -i ${file} --sort symbol -n --percent-limit 0.3 2>&1`,
        60_000,
      );
      const total = Number(/^Samples:\s*(\d+)/m.exec(report)?.[1] ?? 0);
      return {
        value: { durationMs: s * 1000, samples: total, top: parseSimpleperfReport(report) },
        raw: `${recorded}\n---\n${report}`,
        at: at(),
      };
    } finally {
      await this.device.shell(`rm -f ${file}`).catch(() => undefined);
    }
  }

  /** A heap dump of the app (HPROF, for a memory analyser) saved at `localPath`; the file stays on this machine. */
  async heapDump(pkg: string, localPath: string): Promise<Measured<HeapDump>> {
    assertPkg(pkg);
    await this.pid(pkg);
    const remote = `/data/local/tmp/appdyno-${randomBytes(4).toString('hex')}.hprof`;
    try {
      const out = await this.sh(`am dumpheap ${pkg} ${remote} 2>&1`, 120_000);
      // the dump is written by the app after the command returns: wait until its size stops growing
      let last = -1;
      for (let i = 0; i < 120; i++) {
        const size = Number(
          (await this.device.shell(`stat -c %s ${remote} 2>/dev/null`)).trim() || -1,
        );
        if (size > 0 && size === last) break;
        last = size;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (last <= 0)
        throw new DeviceError('UNSUPPORTED', `no heap dump of ${pkg}: ${out.trim().slice(0, 200)}`);
      await this.device.pull(remote, localPath);
      return { value: { file: localPath, bytes: last }, raw: out, at: at() };
    } finally {
      await this.device.shell(`rm -f ${remote}`).catch(() => undefined);
    }
  }

  /**
   * Every frame of the app over `durationMs` from Perfetto's frame timeline (Android 12+): the time each
   * frame took and why it was late (the app, the compositor, buffer stuffing). `during` runs while it
   * records (a scroll, a transition). The trace is kept for later queries; atrace in it gives what each
   * frame cost (`android_frame_stats`). Needs the trace processor (`appdyno tools install`).
   */
  async frameTimeline(
    pkg: string,
    durationMs: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<FrameTimeline> & { tracePath?: string }> {
    await this.device.readyToMeasure();
    assertPkg(pkg);
    await traceProcessor();
    const ms = Math.min(Math.max(Math.round(durationMs), 500), 60_000);
    const file = await this.record(
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

  /** The Java heap into a new HPROF file under `dir`. */
  async heap(pkg: string, dir: string): Promise<Measured<HeapReading>> {
    const m = await this.heapDump(pkg, join(dir, `heap-${pkg}-${Date.now()}.hprof`));
    return { ...m, value: { ...m.value, kind: 'hprof' } };
  }

  /** The frame timeline over `seconds`. */
  async frameTrace(
    pkg: string,
    seconds: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<FrameTrace>> {
    await this.device.readyToMeasure();
    const m = await this.frameTimeline(pkg, seconds * 1000, during);
    return { value: { kind: 'timeline', ...m.value }, raw: m.raw, at: m.at };
  }
}
