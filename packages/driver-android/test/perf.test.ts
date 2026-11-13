import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assert, describe, expect, it, vi } from 'vitest';
import { quantile, type CompileMode } from '@appdyno/core';
import { parseExitInfo } from '../src/crashes.js';
import { THERMAL_READ } from '../src/perf/app.js';
import { AndroidPerf } from '../src/perf/index.js';
import { launch } from '../src/perf/launch.js';
import { memory } from '../src/perf/memory.js';
import type { PerfDevice } from '../src/perf/shared.js';
import { assertReadOnlySql, queryTrace, recordTrace } from '../src/perf/perfetto.js';
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
  parseFramestats,
  parseFullyDrawn,
  parseMeminfo,
  parseNetstatsUid,
  parseProcStatTicks,
  parseSlowStartReasons,
  parseStartup,
  parseThreadReads,
  parseVitals,
} from '../src/perf/parse.js';

const fx = (name: string) =>
  readFileSync(new URL(`./fixtures/android/${name}`, import.meta.url), 'utf8');

describe('android perf parsers on recorded outputs', () => {
  it('counts a frame with the bit Android 16 sets on ordinary frames, not a window change', () => {
    const rows = parseFramestats(
      `---PROFILEDATA---\nFlags,IntendedVsync,FrameCompleted,\n32,1000000,17000000,\n33,1000000,17000000,\n2,1000000,17000000,\n---PROFILEDATA---\n`,
    );
    expect(rows.map((r) => r.durationMs)).toEqual([16]);
  });

  it('reads the gfxinfo summary and the per-frame rows', () => {
    const s = parseFrameStats(fx('android-gfxinfo-framestats.txt'));
    expect(s).toMatchObject({
      totalFrames: 144,
      jankyFrames: 9,
      jankyPercent: 6.25,
      p50Ms: 21,
      p99Ms: 150,
      deadlineMissed: 9,
      fewFrames: false,
    });
    assert(s.frames);
    expect(s.frames.count).toBeGreaterThan(50);
    expect(s.frames.worstMs).toBeGreaterThanOrEqual(s.frames.p95Ms);
    // the first row: IntendedVsync 851716987249 → FrameCompleted 851744228572 is 27.2 ms at a 16.7 ms interval
    expect(parseFramestats(fx('android-gfxinfo-framestats.txt'))[0]).toEqual({
      durationMs: 27.2,
      intervalMs: 16.7,
      startNs: 851716987249,
    });
  });

  it('reads on from the newest frame a reader saw, with no reset between: the rows a device keeps outlive a second', () => {
    const text = fx('android-gfxinfo-framestats.txt');
    const rows = parseFramestats(text).toSorted((a, b) => a.startNs - b.startNs);
    const every = parseFrameStats(text).frames;
    const cut = rows.at(-3)?.startNs;
    assert(every && cut !== undefined);
    expect(parseFrameStats(text, cut).frames).toMatchObject({ count: 2, newestNs: every.newestNs });
    expect(parseFrameStats(text, every.newestNs).frames).toBeUndefined();
  });

  it('reads the rows of every window block, an empty block first', () => {
    const block = (rows: string) =>
      `---PROFILEDATA---\nFlags,IntendedVsync,FrameCompleted,\n${rows}---PROFILEDATA---\n`;
    const text = `${block('')}${block('0,1000000000,1040000000,\n0,2000000000,2010000000,\n1,3000000000,3500000000,\n')}`;
    expect(parseFramestats(text)).toEqual([
      { durationMs: 40, intervalMs: 16.7, startNs: 1e9 },
      { durationMs: 10, intervalMs: 16.7, startNs: 2e9 },
    ]);
  });

  it('gives no percentile on no frames, where gfxinfo prints its top bucket', () => {
    const text =
      'Total frames rendered: 0\nJanky frames: 0 (0.00%)\n50th percentile: 4950ms\n95th percentile: 4950ms\n';
    const s = parseFrameStats(text);
    expect(s).toMatchObject({ totalFrames: 0, fewFrames: true });
    expect(s).not.toHaveProperty('p50Ms');
    expect(s).not.toHaveProperty('p95Ms');
  });

  it('counts frozen frames from the histogram buckets from 700 ms on', () => {
    const text =
      'Total frames rendered: 100\nJanky frames: 5 (5.00%)\nHISTOGRAM: 5ms=90 700ms=2 1150ms=1\n';
    expect(parseFrameStats(text)).toMatchObject({ frozenFrames: 3, fewFrames: false });
    expect(() => parseFrameStats('nothing')).toThrow(/no frame summary/);
  });

  it('reads meminfo PSS, heaps and private dirty', () => {
    const m = parseMeminfo(fx('android-meminfo.txt'));
    expect(m.pssKb).toBeGreaterThan(0);
    expect(m.javaHeapKb).toBeGreaterThan(0);
    expect(m.nativeHeapKb).toBeGreaterThan(0);
    expect(m.privateDirtyKb).toBeGreaterThan(0);
  });

  it('reads am start -W', () => {
    expect(parseAmStart(fx('android-am-start-W.txt'))).toEqual({
      totalMs: 609,
      waitMs: 613,
      state: 'COLD',
      status: 'ok',
    });
  });

  it('reads utime and stime past a process name with spaces and parentheses', () => {
    expect(parseProcStatTicks('123 (a b) c) S 1 2 3 4 5 6 7 8 9 10 250 50 0 0')).toBe(300);
  });

  it('reads the device vitals sections', () => {
    const v = parseVitals(
      '==load==\n1.20 0.80 0.50 1/1900 1234\n==pressure==\nsome avg10=12.50 avg60=3.00\n==mem==\nMemTotal: 2000000 kB\nMemFree: 1 kB\nMemAvailable: 900000 kB\n==thermal==\nIsStatusOverride: false\nThermal Status: 0\n==battery==\n  level: 100\n  temperature: 250\n',
    );
    expect(v).toEqual({
      load: [1.2, 0.8, 0.5],
      cpuPressure: 12.5,
      memAvailableKb: 900000,
      memTotalKb: 2000000,
      thermalStatus: 0,
      batteryTempC: 25,
    });
  });

  it('counts the kernel threads a Xiaomi keeps parked, not a parked app', () => {
    const v = parseVitals(
      `==load==\n14.31 14.85 15.34 1/6605 9249\n==parked==\n${fx('xiaomi-parked.txt')}D       4242  1683 0                        dev.appdyno.fixture\n==pressure==\n==mem==\nMemTotal: 2000000 kB\n`,
    );
    expect(v.load).toEqual([14.31, 14.85, 15.34]);
    expect(v.parkedKernelThreads).toBe(14);
  });

  it('reads how busy the CPU was between two lines of /proc/stat, from a Xiaomi at rest and at work', () => {
    const atRest = parseVitals(
      '==load==\n23.35 22.74 18.93 1/7340 4033\n==stat==\n' +
        'cpu  6908478 1597606 6477298 379887089 48021 1870020 410860 0 0 0\n' +
        'cpu  6908501 1597606 6477357 379888636 48022 1870033 410863 0 0 0\n',
    );
    expect(atRest.cpuBusyPercent).toBe(6);
    const atWork = parseVitals(
      '==stat==\n' +
        'cpu  6891923 1594216 6467317 379857143 48000 1868663 410550 0 0 0\n' +
        'cpu  6892987 1594392 6467750 379857162 48000 1868709 410559 0 0 0\n',
    );
    expect(atWork.cpuBusyPercent).toBe(99);
    expect(parseVitals('==stat==\n').cpuBusyPercent).toBeUndefined();
    expect(parseVitals('==stat==\ncpu  1 2 3\n').cpuBusyPercent).toBeUndefined();
  });

  it('takes a load of three zeros for one the kernel hides, and keeps its pressure', () => {
    // a Samsung SM-A525F, tasks running; a Xiaomi hides the pressure instead
    const v = parseVitals(
      '==load==\n0.00 0.00 0.00 4/4877 14151\n==parked==\n==pressure==\nsome avg10=4.85 avg60=4.80 avg300=4.35 total=13618980047\n==mem==\n==thermal==\nThermal Status: 0\n',
    );
    expect(v.load).toBeUndefined();
    expect(v.cpuPressure).toBe(4.85);
    expect(v.thermalStatus).toBe(0);
  });

  it("reads the thermal status from the tenth line of a phone's dump", () => {
    const dump = fileURLToPath(new URL('./fixtures/android/thermalservice.txt', import.meta.url));
    const read = THERMAL_READ.replace('dumpsys thermalservice', `cat ${dump}`);
    const out = execSync(read, { encoding: 'utf8' });
    expect(parseVitals(`==thermal==\n${out}`).thermalStatus).toBe(0);
  });

  it('counts none when nothing is parked, and does not read on into the next section', () => {
    const v = parseVitals('==load==\n1 1 1 1/9 9\n==parked==\n==mem==\nMemTotal: 2 kB\n');
    expect(v.parkedKernelThreads).toBe(0);
  });

  it('reads the frame timeline query output with its jank types', () => {
    expect(parseFrameTimelineCsv(fx('frame-timeline.csv'))).toEqual({
      frames: 5,
      janky: 3,
      jankyPercent: 60,
      appDeadlineMissed: 2,
      frozen: 0,
      appResynced: 0,
      appJankPercent: 40,
      bufferStuffing: 1,
      surfaceFlinger: 1,
      p50Ms: 16,
      p95Ms: 42,
      worstMs: 45,
    });
  });

  it('keeps its columns where a cell is empty, and a frame with no duration is no frame', () => {
    const csv =
      '"ts","surface","dur","jank_type"\n1,,2000000,"Buffer Stuffing, App Deadline Missed"\n2,,[NULL],"None"\n3,,,"None"\n';
    expect(parseFrameTimelineCsv(csv)).toMatchObject({
      frames: 1,
      appDeadlineMissed: 1,
      bufferStuffing: 1,
      worstMs: 2,
    });
  });

  it('reads a percentile as every measurement does', () => {
    const frames = [10, 20, 30, 40].map((ms, i) => `${i},${ms * 1e6},"None"`).join('\n');
    const read = parseFrameTimelineCsv(`"ts","dur","jank_type"\n${frames}\n`);
    expect(read.p50Ms).toBe(quantile([10, 20, 30, 40], 0.5));
    expect(read.p95Ms).toBe(38.5);
  });

  it('counts app resynced jitter as the app jank', () => {
    const csv =
      '"ts","dur","jank_type"\n1,1000000,"App Resynced Jitter"\n2,1000000,"None"\n3,1000000,"App Deadline Missed"\n4,1000000,"None"\n';
    expect(parseFrameTimelineCsv(csv)).toMatchObject({
      appDeadlineMissed: 1,
      appResynced: 1,
      appJankPercent: 50,
    });
  });

  it('reads the objects of meminfo', () => {
    expect(parseMeminfo(fx('android-meminfo.txt'))).toMatchObject({
      viewRootImpl: 1,
      appContexts: 11,
      activities: 1,
    });
  });

  it('reads android_frame_stats, nanoseconds to ms', () => {
    const s = parseAndroidFrameStats(fx('frame-stats.csv'));
    assert(s);
    expect(s.frames).toBe(32);
    expect(s.overrunWorstMs).toBeGreaterThanOrEqual(s.overrunP95Ms);
    expect(s.overrunWorstMs).toBeCloseTo(316.5, 0);
    expect(parseAndroidFrameStats('overrun,cpu_time\n1000000,[NULL]\n')).toEqual({
      frames: 1,
      overrunP95Ms: 1,
      overrunWorstMs: 1,
    });
    expect(s.cpuP95Ms).toBeGreaterThan(40);
    expect(parseAndroidFrameStats('"overrun","cpu_time"\n')).toBeUndefined();
  });

  it('reads the app-s fully drawn time, the last one, with seconds and minutes', () => {
    const log = fx('android-logcat-launch.txt');
    expect(parseFullyDrawn(log, 'dev.appdyno.fixture')).toBe(123);
    expect(parseFullyDrawn(log, 'other.app')).toBeUndefined();
    expect(parseFullyDrawn('Fully drawn a.b/.Main: +1m2s13ms\n', 'a.b')).toBe(62_013);
  });

  it('reads the compile state the device reports', () => {
    expect(
      parseCompileStatus(
        '  [dev.appdyno.fixture]\n    path: /data/app/base.apk\n      arm64: [status=verify] [reason=cmdline] [primary-abi]\n',
      ),
    ).toBe('status=verify reason=cmdline');
    expect(parseCompileStatus('nothing')).toBeUndefined();
  });

  it('reads a startup trace: type, times, the platform-s reasons, breakdown, findings, odex', () => {
    const s = parseStartup(
      fx('startup-query.csv'),
      parseSlowStartReasons(fx('startup-metric.json'), 'dev.appdyno.fixture'),
      '/traces/x.pftrace',
    );
    expect(s).toMatchObject({
      tracePath: '/traces/x.pftrace',
      startupType: 'cold',
      durMs: 1867.5,
      ttidMs: 1878.6,
      ttfdMs: 2139.5,
      reasons: [
        'No baseline or cloud profiles',
        'App in debuggable mode',
        'Time spent in bindApplication',
      ],
      findings: ['bindApplication took 1533 ms (limit 1250 ms)'],
    });
    const [first] = s.breakdown;
    assert(first);
    expect(first.reason).toBe('bind_application');
    expect(first.ms).toBeGreaterThan(1500);
    expect(s.odex).toMatch(
      /^location=.*base\.odex status=up-to-date filter=verify reason=install$/,
    );
  });

  it('finds a slow hot launch and nothing else on empty metrics', () => {
    const s = parseStartup(
      '"k","a","b"\n"type","hot",1600000000\n"drawn","[NULL]","[NULL]"\n',
      parseSlowStartReasons('{"android_startup":{"startup":[]}}', 'a.b'),
      '/t.pftrace',
    );
    expect(s.findings).toEqual(['hot launch took 1600 ms (limit 1500 ms)']);
    expect(s.reasons).toEqual([]);
    expect(s.ttfdMs).toBeUndefined();
    expect(s.breakdown).toEqual([]);
    expect(s.ttidMs).toBeUndefined();
  });

  it('reads each thread between reads, a new one from zero', () => {
    const line = (tid: number, name: string, ticks: number) =>
      `${tid} (${name}) R 1 2 3 4 5 6 7 8 9 10 ${ticks} 0 0 0`;
    const text = [
      'hz 100',
      '== 1000000000',
      line(1, 'main a', 0),
      line(2, 'idle', 100),
      '== 1500000000',
      line(1, 'main a', 50),
      line(2, 'idle', 101),
      line(3, 'Thread-5', 40),
      '== 2000000000',
      line(1, 'main a', 60),
      line(2, 'idle', 101),
      line(3, 'Thread-5', 90),
    ].join('\n');
    expect(parseThreadReads(text)).toEqual({
      windowMs: 1000,
      reads: 3,
      threads: [
        // 500 ms above the limit, and what it ran in the step next to it
        { tid: 3, name: 'Thread-5', percent: 90, over90Ms: 900 },
        { tid: 1, name: 'main a', percent: 60, over90Ms: 600 },
        { tid: 2, name: 'idle', percent: 1, over90Ms: 0 },
      ],
      worstOver90Ms: 900,
    });
  });

  it('reads thread stats recorded from a busy app', () => {
    const m = parseThreadReads(fx('android-threads.txt'));
    expect(m.reads).toBe(5);
    expect(m.windowMs).toBe(2061);
    expect(m.threads.length).toBeGreaterThan(5);
    // it ran through the 2 s of the reads, the first step (88 %) on the way up
    expect(m.threads[0]).toMatchObject({ name: 'Thread-3', over90Ms: 2000 });
    expect(m.worstOver90Ms).toBe(2000);
  });

  it('adds up one uid in netstats, no other uid and no tag', () => {
    const m = parseNetstatsUid(fx('android-netstats-uid.txt'), 10193);
    expect(m).toEqual({ rxBytes: 10777544, txBytes: 94378 });
    expect(parseNetstatsUid(fx('android-netstats-uid.txt'), 99999)).toEqual({
      rxBytes: 0,
      txBytes: 0,
    });
    const tagged = [
      'ident=[{type=1}] uid=7 set=DEFAULT tag=0x0',
      '  NetworkStatsHistory: bucketDuration=7200',
      '    st=1 rb=10 rp=1 tb=20 tp=1 op=0',
      '    st=2 rb=1 rp=1 tb=2 tp=1 op=0',
      'ident=[{type=1}] uid=7 set=FOREGROUND tag=0x0',
      '    st=1 rb=100 rp=1 tb=200 tp=1 op=0',
      'ident=[{type=1}] uid=7 set=DEFAULT tag=0xffff',
      '    st=1 rb=1000 rp=1 tb=2000 tp=1 op=0',
    ].join('\n');
    expect(parseNetstatsUid(tagged, 7)).toEqual({ rxBytes: 111, txBytes: 222 });
  });

  it('takes the energy of a window as what the count since the last charge grew by', () => {
    expect(
      usageSince(
        { mah: 1.5, breakdown: { cpu: 1, screen: 0.5 } },
        { mah: 1.75, breakdown: { cpu: 1.25, screen: 0.5, wifi: 0.01 } },
      ),
    ).toEqual({ mah: 0.25, breakdown: { cpu: 0.25, screen: 0, wifi: 0.01 } });
    // a charge reset it meanwhile
    expect(usageSince({ mah: 2 }, { mah: 0.1 })).toEqual({ mah: 0, breakdown: {} });
  });

  it('reads the row as Android 16 prints it, its parts on the next line', () => {
    const android16 = [
      '  Estimated power use (mAh):',
      '    Capacity: 6000, Computed drain: 0, actual drain: 0',
      '  UID u0a404: 5.19 fg: 4.05 (4m 49s 572ms) bg: 0.901 (13s 585ms) cached: 0.246 (13s 432ms)',
      '      cpu=5.19 (3m 6s 935ms) cpu:fg=4.05 (2m 25s 235ms) cpu:bg=0.901 (32s 865ms)',
      '      (not on battery, screen on) cpu=4.50 (2m 41s 553ms)',
      '',
    ].join('\n');
    expect(parseBatteryUsage(android16, 10404)).toEqual({ mah: 5.19, breakdown: { cpu: 5.19 } });
  });

  it('reads the app-s estimated charge; an emulator-s zeros are no estimate', () => {
    expect(parseBatteryUsage(fx('android-batterystats-charged.txt'), 10193)).toEqual({});
    // the row as a phone prints it (not recorded: there is no phone for these tests)
    const phone = [
      '  Estimated power use (mAh):',
      '    Capacity: 4355, Computed drain: 25.2, actual drain: 0-35.1',
      '    Global',
      '      screen: 5.00 apps: 5.00 duration: 5m 0s 0ms',
      '    UID u0a193: 1.23 fg: 1.10 ( cpu=1.00 (1s 123ms) screen=0.230 (5m 0s 0ms) ) ',
      '    UID 1000: 0.500 ( cpu=0.500 ) ',
      '',
      '  Resource Power Manager Stats',
    ].join('\n');
    expect(parseBatteryUsage(phone, 10193)).toEqual({
      mah: 1.23,
      breakdown: { cpu: 1, screen: 0.23 },
    });
    expect(parseBatteryUsage(phone, 10194)).toEqual({ mah: 0 });
    expect(parseBatteryUsage('', 10193)).toEqual({});
  });

  it('tells the build from the package flags', () => {
    expect(parseBuildType(fx('android-package-flags-debug.txt'))).toBe('debug');
    expect(parseBuildType(fx('android-package-flags-release.txt'))).toBe('release');
    // Android 14 does not print this one (the driver asks Perfetto); kept for releases that do
    expect(parseBuildType('    privateFlags=[ PROFILEABLE_BY_SHELL ]\n')).toBe('profileable');
    expect(parseBuildType('Unable to find package: no.such.app\n')).toBe('unknown');
  });

  it('finds the app in dumpsys diskstats where it lists apps', () => {
    // the emulator's own: no list
    expect(parseDiskstats(fx('android-diskstats.txt'), 'dev.appdyno.fixture')).toEqual({});
    // the documented format (a phone's daily count; not recorded here)
    const listed = [
      'Package Names: ["a.b","dev.appdyno.fixture"]',
      'App Sizes: [1,2]',
      'App Data Sizes: [3,4]',
      'Cache Sizes: [5,6]',
    ].join('\n');
    expect(parseDiskstats(listed, 'dev.appdyno.fixture')).toEqual({ code: 2, data: 4, cache: 6 });
    expect(parseDiskstats(`${listed}\nApp Sizes: [broken`, 'other')).toEqual({});
  });

  it('reads the trace processor-s csv: quotes, commas, doubled quotes, line breaks, NULL', () => {
    expect(parseCsv('"a","b"\n1,"x, ""y"""\n"line\nbreak",[NULL]\n\n')).toEqual({
      columns: ['a', 'b'],
      rows: [
        ['1', 'x, "y"'],
        ['line\nbreak', '[NULL]'],
      ],
    });
    expect(parseCsv('')).toEqual({ columns: [], rows: [] });
  });

  it('counts crashes and ANRs from a recorded exit list', () => {
    // the force stop in the same list is nobody's fault: not a death
    expect(parseExitInfo(fx('android-exit-info.txt'))).toMatchObject([
      { at: '2026-11-03 03:41:06.868', reason: 'APP CRASH(EXCEPTION)', detail: 'crash' },
    ]);
  });
});

describe('the read-only guard of trace queries', () => {
  const ok = [
    'SELECT 1',
    'SELECT 1;',
    '  select name from process ;  ',
    'WITH a AS (SELECT 1 AS x) SELECT x FROM a;',
    'INCLUDE PERFETTO MODULE android.startup.startups; SELECT * FROM android_startups',
    'include perfetto module a.b;\nINCLUDE PERFETTO MODULE c.*;\nSELECT 1;',
    "SELECT 'DROP TABLE x; DELETE FROM y' AS a",
    "SELECT \"update\", replace(name, 'a', 'b') FROM t -- ; DROP TABLE t\n",
    '/* INSERT; */ SELECT [create] FROM t',
  ];
  it.each(ok)('passes %s', (sql) => {
    expect(() => assertReadOnlySql(sql)).not.toThrow();
  });

  const bad = [
    '',
    'DROP TABLE slice',
    'INSERT INTO t VALUES (1)',
    'PRAGMA table_info(slice)',
    'CREATE PERFETTO TABLE t AS SELECT 1',
    'SELECT 1; SELECT 2',
    'SELECT 1; DROP TABLE slice',
    'SELECT 1;;',
    'WITH a AS (SELECT 1) DELETE FROM t',
    'WITH a AS (SELECT 1) INSERT INTO t SELECT * FROM a',
    'WITH a AS (SELECT 1) REPLACE INTO t SELECT * FROM a',
    'WITH a AS (SELECT 1) UPDATE t SET x = 1',
    'INCLUDE PERFETTO MODULE a.b; DROP TABLE t',
    'INCLUDE PERFETTO MODULE a.b',
    "INCLUDE PERFETTO MODULE a'; SELECT 1",
    'SELECT 1 /* never closed',
    "SELECT 'never closed",
    "SELECT 'a'; ATTACH 'x' AS y",
  ];
  it.each(bad)('refuses %s', (sql) => {
    let code: string | undefined;
    try {
      assertReadOnlySql(sql);
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe('INVALID_ARGUMENT');
  });

  it('leaves other trace kinds to their own driver', async () => {
    await expect(queryTrace('/t/x.trace', { sql: 'SELECT 1', limit: 1 })).resolves.toBeUndefined();
    await expect(queryTrace('/t/x.pftrace', { limit: 1 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(
      queryTrace('/t/x.perfetto-trace', { sql: 'DROP TABLE t', limit: 1 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('profile and frame windows', () => {
  it('reads the simpleperf symbol report, most first', async () => {
    const { parseSimpleperfReport } = await import('../src/perf/parse.js');
    const report = [
      'Cmdline: /system/bin/simpleperf record --app dev.app',
      'Samples: 2997',
      'Overhead  Sample  Symbol',
      '62.10%    1861    dev.appdyno.fixture.CpuActivity.onCreate$lambda$0$lambda$1',
      '20.02%    600     art::interpreter::Execute',
      '5.50%     165     [kernel.kallsyms]',
    ].join('\n');
    expect(parseSimpleperfReport(report)).toEqual([
      {
        percent: 62.1,
        samples: 1861,
        symbol: 'dev.appdyno.fixture.CpuActivity.onCreate$lambda$0$lambda$1',
      },
      { percent: 20.02, samples: 600, symbol: 'art::interpreter::Execute' },
      { percent: 5.5, samples: 165, symbol: '[kernel.kallsyms]' },
    ]);
  });

  it('finds the worst second of frames', async () => {
    const { worstWindow } = await import('../src/perf/parse.js');
    const row = (s: number, ms: number) => ({ startNs: s * 1e6, durationMs: ms, intervalMs: 16.7 });
    // a smooth second, then a second with three missed frames
    const rows = [
      ...Array.from({ length: 60 }, (_, i) => row(i * 16, 12)),
      row(1500, 80),
      row(1600, 90),
      row(1700, 70),
      row(1800, 12),
    ];
    expect(worstWindow(rows)).toMatchObject({ slow: 3 });
  });
});

describe('the measures of a device', () => {
  const on = (serial: string, answer: string) =>
    new AndroidPerf({
      serial,
      shell: () => Promise.resolve(answer),
      shellAlongside: () => Promise.resolve(answer),
      shellBuffer: () => Promise.resolve(Buffer.from(answer)),
      pull: () => Promise.resolve(),
      readyToMeasure: () => Promise.resolve(),
      ensureAwake: () => Promise.resolve({ woke: false, unlocked: false, locked: false }),
    });

  it('says what it has no way of measuring', async () => {
    const perf = on('R58M', '');
    expect(perf.framesByProbe).toBe(false);
    await expect(perf.attachProbe()).rejects.toThrow('cannot measure through a frame probe');
    await expect(perf.hangs()).rejects.toThrow('cannot measure hangs');
    await expect(perf.xctMetrics()).rejects.toThrow("cannot measure XCTest's metrics");
  });

  it('reaches the device from a measure taken off the object, as the operations do', async () => {
    const { pid } = on('R58M', '4242\n');
    await expect(pid('dev.app')).resolves.toBe(4242);
  });

  it('refuses a measure of an app that is not running', async () => {
    await expect(on('R58M', 'No process found').frames('dev.app')).rejects.toMatchObject({
      code: 'APP_NOT_RUNNING',
    });
  });

  it('keeps no size of an app whose files it could not read, where none would read as 0 bytes', async () => {
    const device = {
      serial: 'R58M',
      shell: (cmd: string) =>
        Promise.resolve(cmd.includes('pm path') ? 'package:/data/app/a.apk\n' : 'nope'),
      shellAlongside: () => Promise.resolve(''),
      shellBuffer: () => Promise.resolve(Buffer.from('')),
      pull: () => Promise.resolve(),
      readyToMeasure: () => Promise.resolve(),
      ensureAwake: () => Promise.resolve({ woke: false, unlocked: false, locked: false }),
    };
    await expect(new AndroidPerf(device).size('dev.app')).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  });

  it('hears a recording that fails after what it was around threw', async () => {
    const heard: unknown[] = [];
    const note = (e: unknown) => void heard.push(e);
    process.on('unhandledRejection', note);
    let fail: (e: Error) => void = () => undefined;
    const recording = new Promise<string>((_, reject) => (fail = reject));
    const device = {
      serial: 'R58M',
      shell: () => Promise.resolve('4242\n'),
      shellAlongside: () => recording,
      shellBuffer: () => Promise.resolve(Buffer.from('')),
      pull: () => Promise.resolve(),
      readyToMeasure: () => Promise.resolve(),
      ensureAwake: () => Promise.resolve({ woke: false, unlocked: false, locked: false }),
    };
    const during = () => {
      return Promise.reject(new Error('the swipe failed'));
    };
    await expect(new AndroidPerf(device).cpuProfile('dev.app', 1_000, during)).rejects.toThrow(
      'the swipe failed',
    );
    fail(new Error('the device went away'));
    await new Promise((r) => setImmediate(r));
    process.off('unhandledRejection', note);
    expect(heard).toEqual([]);
  });

  it('stops a trace no one will read, when what it was around threw', async () => {
    const sent: string[] = [];
    const device = {
      serial: 'R58M',
      shell: (cmd: string) => {
        sent.push(cmd);
        return Promise.resolve(cmd.includes('perfetto') ? '4242\n' : '');
      },
      shellAlongside: () => Promise.resolve(''),
      shellBuffer: () => Promise.resolve(Buffer.from('')),
      pull: () => Promise.resolve(),
      readyToMeasure: () => Promise.resolve(),
      ensureAwake: () => Promise.resolve({ woke: false, unlocked: false, locked: false }),
    };
    const during = () => {
      return Promise.reject(new Error('the swipe failed'));
    };
    await expect(recordTrace(device, 'dev.app', 'frames', [], { during })).rejects.toThrow(
      'the swipe failed',
    );
    expect(sent).toContain('kill -TERM 4242');
    expect(sent.at(-1)).toMatch(/^rm -f /);
  });

  it('readies the device for frames that are measured, and not for what only looks', async () => {
    const ready = vi.fn(() => Promise.resolve());
    const device = {
      serial: 'R58M',
      shell: () => Promise.resolve(''),
      shellAlongside: () => Promise.resolve(''),
      shellBuffer: () => Promise.resolve(Buffer.from('')),
      pull: () => Promise.resolve(),
      readyToMeasure: ready,
      ensureAwake: () => Promise.resolve({ woke: false, unlocked: false, locked: false }),
    };
    await new AndroidPerf(device).frames('dev.app', { asItIs: true });
    expect(ready).not.toHaveBeenCalled();
    await new AndroidPerf(device).frames('dev.app');
    expect(ready).toHaveBeenCalledOnce();
  });
});

describe('a launch in a compile state', () => {
  it('sends the device no compile filter but those a launch asks for, as a kept run may name any', async () => {
    const asked: string[] = [];
    const d = {
      readyToMeasure: () => Promise.resolve(),
      shell: (command: string) => {
        asked.push(command);
        return Promise.resolve('');
      },
    } as unknown as PerfDevice;
    await expect(
      launch(d, 'com.example.app', { compile: 'speed; reboot #' as CompileMode }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(asked).toEqual([]);
  });
});

describe('memory the system did not say', () => {
  it('is a timeout to ask again, with what the system said, and no bare parse error', async () => {
    const d = {
      readyToMeasure: () => Promise.resolve(),
      shell: () =>
        Promise.resolve('Applications Memory Usage (in Kilobytes):\nUptime: 1 Realtime: 1\n'),
    } as unknown as PerfDevice;
    await expect(memory(d, 'com.example.app')).rejects.toMatchObject({
      code: 'TIMEOUT',
      message:
        "the system's answer held no total of com.example.app's memory: Applications Memory Usage (in Kilobytes):",
      hint: expect.stringContaining('ask again') as unknown,
    });
  });
});
