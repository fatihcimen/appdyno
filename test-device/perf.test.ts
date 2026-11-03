import { mkdtempSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AndroidDevice,
  androidProvider,
  sleep as pause,
  traceProcessor,
  type Screen,
} from 'appdyno';

/**
 * Measurement accuracy against fixture screens of known cost (APPDYNO_ANDROID_SERIAL; run on a quiet
 * machine): frames whose draw takes ~1 ms or 40 ms, 50 MB of Java heap held, one core busy for 3 s, and
 * launch times cross-checked with the system's own "Displayed" line.
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const APP = 'dev.appdyno.fixture';

describe.skipIf(!serial)('android perf accuracy', () => {
  let d: AndroidDevice;
  const open = async (screen: string): Promise<Screen> => {
    // the query makes each link a new intent: one equal to the task's root only brings the task to front
    await d.shell(
      `am start -W -a android.intent.action.VIEW -d 'appdyno-fixture://open/${screen}?n=${Date.now()}' ${APP}`,
    );
    // on a loaded host it comes when it comes; then its opening animation has to end
    for (let i = 0; i < 50; i++) {
      if ((await d.read(APP)).list.some((e) => e.id?.startsWith(screen))) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 1_200));
    return d.read(APP);
  };
  const byId = (s: Screen, id: string) => s.list.find((e) => e.id === id)!;

  beforeAll(async () => {
    d = new AndroidDevice(serial!);
    // an agent another suite started from its own state folder holds UI automation for a moment yet
    await d.stopAgent();
    await d.shell('pkill -f dev.appdyno.agent.Main || true');
    await d.open();
  });
  // these tests go by shell, and a phone's screen goes off by itself meanwhile
  beforeEach(() => d.ensureAwake());
  afterAll(() => d?.close());

  it('frames: a light animation is smooth, a 40 ms draw misses every deadline', async () => {
    const s = await open('frames');
    await d.measure.resetFrames(APP);
    await d.tap(byId(s, 'frames_light'), { settle: false });
    await pause(2_500);
    const light = (await d.measure.frames(APP)).value;
    await d.tap(byId(s, 'frames_heavy'), { settle: false });
    await pause(2_500);
    const heavy = (await d.measure.frames(APP)).value;
    expect(light.totalFrames).toBeGreaterThanOrEqual(60);
    expect(light.jankyPercent).toBeLessThan(25);
    expect(light.frames!.slowPercent).toBeLessThan(20);
    // 2 s of 40+ ms frames: about 45 frames, nearly all late
    expect(heavy.totalFrames).toBeGreaterThanOrEqual(20);
    expect(heavy.totalFrames).toBeLessThan(light.totalFrames);
    expect(heavy.frames!.slowPercent).toBeGreaterThan(80);
    expect(heavy.frames!.p50Ms).toBeGreaterThanOrEqual(40);
  });

  it('memory: 50 MB of Java heap held shows in the Java heap within 15 %', async () => {
    const s = await open('memory');
    await d.tap(byId(s, 'memory_free'), { settle: false });
    await pause(1_500);
    const before = (await d.measure.memory(APP)).value;
    await d.tap(byId(s, 'memory_alloc'), { settle: false });
    await pause(1_500);
    const after = (await d.measure.memory(APP)).value;
    const delta = after.javaHeapKb! - before.javaHeapKb!;
    expect(delta).toBeGreaterThan(50 * 1024 * 0.85);
    expect(delta).toBeLessThan(50 * 1024 * 1.15);
    expect(after.pssKb - before.pssKb).toBeGreaterThan(50 * 1024 * 0.85);
    await d.tap(byId(s, 'memory_free'), { settle: false });
  });

  it('CPU: one busy core reads as about 100 % of a core', async () => {
    const s = await open('cpu');
    await d.tap(byId(s, 'cpu_load'), { settle: false });
    await pause(300);
    const cpu = (await d.measure.cpu(APP, 2_000)).value;
    expect(cpu.percent).toBeGreaterThan(80);
    expect(cpu.percent).toBeLessThan(125);
    await pause(1_000);
  });

  it('launch: cold starts are COLD and match the system log; warm starts are faster', async () => {
    await d.shell('logcat -c');
    const cold = (await d.measure.launch(APP, { mode: 'cold', repeats: 3 })).value;
    // under memory pressure the system may kill or keep a process: most launches are in the asked state
    expect(cold.samples.filter((x) => x.state === 'COLD').length).toBeGreaterThanOrEqual(2);
    expect(cold.medianMs).toBeGreaterThan(0);
    const log = await d.shell(
      'logcat -d -s ActivityTaskManager:I | grep "Displayed dev.appdyno.fixture"',
    );
    const displayed = [...log.matchAll(/\+(?:(\d+)s)?(\d+)ms/g)].map(
      (m) => Number(m[1] ?? 0) * 1000 + Number(m[2]),
    );
    const last = cold.samples.at(-1)!.totalMs!;
    expect(displayed.length).toBeGreaterThan(0);
    expect(Math.min(...displayed.map((x) => Math.abs(x - last)))).toBeLessThanOrEqual(50);
    const warm = (await d.measure.launch(APP, { mode: 'warm', repeats: 3 })).value;
    expect(
      warm.samples.filter((x) => x.state === 'WARM' || x.state === 'HOT').length,
    ).toBeGreaterThanOrEqual(2);
    expect(warm.medianMs!).toBeLessThan(cold.medianMs!);
  }, 120_000);

  it('CPU profile: the busy loop of the fixture is the top function', async () => {
    const s = await open('cpu');
    const prof = (
      await d.measure.cpuProfile(APP, 2_000, async () => {
        await pause(200);
        await d.tap(byId(s, 'cpu_load'), { settle: false });
      })
    ).value;
    expect(prof.samples).toBeGreaterThan(100);
    // the loop runs in a lambda of the CPU screen: the top function belongs to it
    expect(prof.top[0]!.symbol).toMatch(/CpuActivity/);
    expect(prof.top[0]!.percent).toBeGreaterThan(30);
    await pause(1_500);
  }, 60_000);

  it('heap dump: 50 MB held makes a dump over 50 MB', async () => {
    const s = await open('memory');
    await d.tap(byId(s, 'memory_alloc'), { settle: false });
    await pause(1_000);
    const file = join(mkdtempSync(join(tmpdir(), 'appdyno-heap-')), 'heap.hprof');
    const dump = (await d.measure.heapDump(APP, file)).value;
    expect(dump.bytes).toBeGreaterThan(50 * 1024 * 1024);
    expect(statSync(file).size).toBe(dump.bytes);
    await d.tap(byId(s, 'memory_free'), { settle: false });
  }, 180_000);

  it('vitals: load, memory and thermal state of the device', async () => {
    const v = (await d.measure.vitals()).value;
    expect(v.load).toHaveLength(3);
    expect(v.memAvailableKb).toBeGreaterThan(0);
    expect(v.memTotalKb).toBeGreaterThan(v.memAvailableKb!);
  });

  it('frame timeline: the 40 ms draw is late by the app, the light one mostly on time', async () => {
    const tp = await traceProcessor().catch(() => undefined);
    if (!tp) return; // the trace processor is not installed (doctor says so)
    const s = await open('frames');
    const heavy = (
      await d.measure.frameTimeline(APP, 4_000, async () => {
        await pause(500);
        await d.tap(byId(s, 'frames_heavy'), { settle: false });
      })
    ).value;
    const light = (
      await d.measure.frameTimeline(APP, 4_000, async () => {
        await pause(500);
        await d.tap(byId(s, 'frames_light'), { settle: false });
      })
    ).value;
    console.log('frames heavy, light:', heavy.appDeadlineMissed, light.appDeadlineMissed);
    console.log('frame stats heavy, light:', heavy.stats, light.stats);
    // the app's own share tells them apart (an emulator marks nearly every frame janky: display prediction)
    expect(heavy.appDeadlineMissed).toBeGreaterThanOrEqual(15);
    expect(heavy.appDeadlineMissed).toBeGreaterThan(5 * light.appDeadlineMissed);
    expect(heavy.p95Ms).toBeGreaterThanOrEqual(40);
    expect(light.p95Ms).toBeLessThan(heavy.p95Ms);
    // what each frame cost: the 40 ms draw is over 30 ms, the light one far less
    expect(heavy.stats!.overrunP95Ms).toBeGreaterThan(30);
    expect(heavy.stats!.overrunP95Ms).toBeGreaterThan(2 * light.stats!.overrunP95Ms);
    // the kept trace answers later queries, bounded
    const digest = await androidProvider().queryTrace!(heavy.tracePath!, {
      sql: 'SELECT name FROM process',
      limit: 2,
    });
    expect(digest!.columns).toEqual(['name']);
    expect(digest!.rows).toHaveLength(2);
    expect(digest!.dropped).toBeGreaterThan(0);
  }, 90_000);

  /** Known costs of the fixture's start, in its own files. */
  const setCost = (file: 'startup_ms' | 'ttfd_ms', ms: number) =>
    d.shell(`run-as ${APP} sh -c 'mkdir -p files; echo ${ms} > files/${file}'`);
  const clearCosts = () => d.shell(`run-as ${APP} sh -c 'rm -f files/startup_ms files/ttfd_ms'`);

  it('launch: 400 ms more of slow start raises the time to display by 400 ms', async () => {
    // from a start that is slow already: from none, seven rounds read 200 ms as +65, 400 ms as +226 and
    // 800 ms as +766 here; 200 to 600 holds. Turn by turn: the host's load drifts over a minute, and one
    // after the other reads the drift too.
    const raised: number[] = [];
    try {
      for (let i = 0; i < 5; i++) {
        await setCost('startup_ms', 200);
        const base = (await d.measure.launch(APP, { mode: 'cold', repeats: 2 })).value;
        await setCost('startup_ms', 600);
        const slow = (await d.measure.launch(APP, { mode: 'cold', repeats: 2 })).value;
        raised.push(slow.medianMs! - base.medianMs!);
      }
    } finally {
      await clearCosts();
    }
    console.log('startup 400 ms:', raised);
    const median = [...raised].sort((a, b) => a - b)[2]!;
    expect(Math.abs(median - 400)).toBeLessThanOrEqual(100);
  }, 300_000);

  it('launch: a 1500 ms start is named by the trace analysis, with its slow part', async () => {
    await setCost('startup_ms', 1500);
    try {
      const m = (await d.measure.launch(APP, { mode: 'cold', repeats: 1, trace: true })).value;
      const startup = m.startup!;
      console.log('startup 1500 ms:', JSON.stringify(startup));
      expect(statSync(startup.tracePath).size).toBeGreaterThan(0);
      expect(startup.tracePath).toMatch(/\.pftrace$/);
      expect(startup.startupType).toBe('cold');
      expect(startup.durMs).toBeGreaterThan(1500);
      expect(startup.ttidMs).toBeGreaterThan(1500);
      expect(startup.findings.join()).toMatch(/bindApplication took \d+ ms/);
      expect(startup.reasons.join()).toMatch(/bindApplication/);
      expect(startup.breakdown[0]!.reason).toBe('bind_application');
      expect(startup.breakdown[0]!.ms).toBeGreaterThan(1500);
      expect(startup.odex).toMatch(/^location=.* status=.* filter=.* reason=/);
    } finally {
      await clearCosts();
    }
  }, 120_000);

  it('launch: fully drawn comes its known time after the first frame, in the log and the trace', async () => {
    await setCost('ttfd_ms', 400);
    try {
      const m = (await d.measure.launch(APP, { mode: 'cold', repeats: 5, trace: true })).value;
      const gaps = m.samples.map((s) => s.fullyDrawnMs! - s.totalMs!).sort((a, b) => a - b);
      console.log('ttfd 400 ms:', gaps, m.startup?.ttidMs, m.startup?.ttfdMs);
      expect(m.fullyDrawnMedianMs).toBeGreaterThan(m.medianMs!);
      expect(Math.abs(gaps[2]! - 400)).toBeLessThanOrEqual(100);
      // the trace has one launch, not a median: it says the same more loosely
      expect(Math.abs(m.startup!.ttfdMs! - m.startup!.ttidMs! - 400)).toBeLessThanOrEqual(200);
    } finally {
      await clearCosts();
    }
  }, 180_000);

  it('launch: hot is under warm and warm under cold, each in the state asked; compile is restored', async () => {
    await clearCosts();
    const cold = (await d.measure.launch(APP, { mode: 'cold', repeats: 3, compile: 'speed' }))
      .value;
    // turn by turn, as the slow start above: the two are near, and the host's load drifts
    const warm: number[] = [];
    const hot: number[] = [];
    for (let i = 0; i < 3; i++) {
      const w = (await d.measure.launch(APP, { mode: 'warm', repeats: 3 })).value;
      const h = (await d.measure.launch(APP, { mode: 'hot', repeats: 3, trace: i === 0 })).value;
      expect(w.samples.filter((s) => s.state === 'WARM').length).toBeGreaterThanOrEqual(2);
      expect(h.samples.filter((s) => s.state === 'HOT').length).toBeGreaterThanOrEqual(2);
      if (i === 0) expect(h.startup!.startupType).toBe('hot');
      warm.push(w.medianMs!);
      hot.push(h.medianMs!);
    }
    const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[1]!;
    console.log('hot warm cold:', hot, warm, cold.medianMs, cold.compile);
    expect(cold.samples.filter((s) => s.state === 'COLD').length).toBeGreaterThanOrEqual(2);
    expect(mid(hot)).toBeLessThan(mid(warm));
    expect(mid(warm)).toBeLessThan(cold.medianMs!);
    // what the device says: a debuggable build asked for speed stays at verify
    expect(cold.compile).toEqual({ asked: 'speed', status: 'status=verify reason=cmdline' });
    expect(await d.shell(`dumpsys package dexopt | grep -A 3 '\\[${APP}\\]'`)).not.toMatch(
      /reason=cmdline/,
    );
  }, 240_000);

  it('memory: Activities grows by the leaks and stays flat without', async () => {
    const link = async (screen: string) => {
      await d.shell(
        `am start -W -a android.intent.action.VIEW -d appdyno-fixture://open/${screen} ${APP}`,
      );
      await pause(300);
      // the link's home screen goes again
      await d.shell('input keyevent KEYCODE_BACK');
      await pause(700);
    };
    const live = async (expected?: number) => {
      // the count includes what the collector has not reached yet, and an activity the system destroys
      // late (it takes seconds on a loaded host); ART collects on this signal
      for (let i = 0; ; i++) {
        await d.shell(`run-as ${APP} kill -10 ${await d.measure.pid(APP)}`);
        await pause(1_500);
        const m = (await d.measure.memory(APP)).value;
        if (expected === undefined || m.activities === expected || i === 9) return m;
      }
    };
    await d.shell(`am force-stop ${APP}`);
    await d.shell(`am start -W -n ${APP}/.MainActivity`);
    await pause(1_000);
    const base = await live();
    for (let i = 0; i < 3; i++) await link('nothing');
    const control = await live(base.activities);
    for (let i = 0; i < 3; i++) await link('leak');
    const leaked = await live(base.activities! + 3);
    console.log('activities:', base.activities, control.activities, leaked.activities);
    expect(control.activities).toBe(base.activities);
    expect(leaked.activities).toBe(base.activities! + 3);
    expect(base.viewRootImpl).toBe(1);
    expect(base.appContexts).toBeGreaterThan(0);
  }, 120_000);

  it('threads: the busy thread stays above 90 % for about its 3 s', async () => {
    const s = await open('cpu');
    await d.tap(byId(s, 'cpu_load'), { settle: false });
    const m = (await d.measure.threads(APP, 5_000)).value;
    console.log('threads:', m.reads, m.windowMs, m.worstOver90Ms, m.threads.slice(0, 2));
    expect(m.reads).toBeGreaterThanOrEqual(10);
    expect(m.threads[0]!.over90Ms).toBe(m.worstOver90Ms);
    expect(m.worstOver90Ms).toBeGreaterThanOrEqual(3_000 * 0.7);
    expect(m.worstOver90Ms).toBeLessThanOrEqual(3_000 * 1.3);
  }, 60_000);

  it('network: a 5 MB download reads 5 MB received', async (ctx) => {
    let reached = false;
    const size = 5 * 1024 * 1024;
    const body = Buffer.alloc(size, 7);
    let served!: () => void;
    const done = new Promise<void>((r) => (served = r));
    const server = createServer((_req, res) => {
      res.on('finish', served);
      res.writeHead(200, { 'content-length': size }).end(body);
    });
    await new Promise<void>((r) => server.listen(0, '0.0.0.0', r));
    const port = (server.address() as AddressInfo).port;
    try {
      // the count leaves out the loopback, so not by `adb reverse`: an emulator reaches this machine at 10.0.2.2,
      // and a phone on this network at its address
      const lan = Object.values(networkInterfaces())
        .flat()
        .find((a) => a?.family === 'IPv4' && !a.internal)?.address;
      const host = serial!.startsWith('emulator-') ? '10.0.2.2' : lan;
      const url = `appdyno-fixture://open/network?url=http://${host}:${port}/x`;
      const m = (
        await d.measure.network(APP, 1_000, async () => {
          await d.shell(`am start -W -a android.intent.action.VIEW -d '${url}' ${APP}`);
          reached = await Promise.race([done.then(() => true), pause(20_000).then(() => false)]);
          await pause(1_000);
        })
      ).value;
      console.log('network:', m);
      // a phone on another network never asked
      if (!reached && !serial!.startsWith('emulator-')) return ctx.skip();
      expect(m.rxBytes).toBeGreaterThan(size * 0.85);
      expect(m.rxBytes).toBeLessThan(size * 1.15);
      expect(m.txBytes).toBeGreaterThan(0);
      expect(m.txBytes).toBeLessThan(size * 0.15);
    } finally {
      server.close();
    }
  }, 60_000);

  it('size: the apks read as the file on disk', async () => {
    const m = (await d.measure.size(APP)).value;
    const path = (await d.shell(`pm path ${APP}`)).match(/(?<=^package:).+/m)![0]!.trim();
    const local = join(mkdtempSync(join(tmpdir(), 'appdyno-apk-')), 'base.apk');
    await d.pull(path, local);
    const size = statSync(local).size;
    console.log('size:', m, size);
    expect(m.parts['base.apk']).toBe(size);
    expect(Math.abs(m.bytes - size)).toBeLessThanOrEqual(size * 0.01);
  });

  it('exits: pressing Crash raises the crash count by one', async () => {
    // the system keeps 16 exits of a package: a full list would not grow
    await d.shell(`am clear-exit-info ${APP}`);
    const before = (await d.measure.exits(APP)).value;
    await d.shell(`am force-stop ${APP}`);
    await d.shell(`am start -W -n ${APP}/.MainActivity`);
    await pause(1_000);
    const s = await d.read(APP);
    await d.tap(
      s.list.find((e) => /^crash$/i.test(e.label))!,
      { settle: false },
    );
    await pause(2_000);
    const after = (await d.measure.exits(APP)).value;
    await d.shell(`am force-stop ${APP}`);
    console.log('exits:', before.crashes, after.crashes, after.recent[0]);
    expect(after.crashes).toBe(before.crashes + 1);
    expect(after.total).toBe(before.total + 1);
    expect(after.recent[0]!.reason).toMatch(/CRASH/);
  }, 60_000);

  it('heap profile: 50 MB held shows in byte[] of the Java heap; other builds are refused', async () => {
    const s = await open('memory');
    await d.tap(byId(s, 'memory_alloc'), { settle: false });
    await pause(1_000);
    const m = (await d.measure.heapProfile(APP, 'java_hprof', 1)).value;
    await d.tap(byId(s, 'memory_free'), { settle: false });
    console.log('java_hprof:', m.top.slice(0, 3), m.totalBytes, m.tracePath);
    expect(m.top.find((t) => t.name === 'byte[]')!.bytes).toBeGreaterThanOrEqual(40 * 1024 * 1024);
    expect(statSync(m.tracePath).size).toBeGreaterThan(0);
    await expect(
      d.measure.heapProfile('com.android.settings', 'java_hprof', 1),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED', message: /debuggable or profileable/ });
  }, 240_000);

  it('heap profile: heapprofd sees the native allocations while it records', async () => {
    const s = await open('frames');
    const m = (
      await d.measure.heapProfile(APP, 'heapprofd', 4, async () => {
        await pause(500);
        await d.tap(byId(s, 'frames_light'), { settle: false });
      })
    ).value;
    console.log('heapprofd:', m.top.slice(0, 3), m.totalBytes);
    expect(m.totalBytes).toBeGreaterThan(0);
    expect(m.top[0]!.bytes).toBeGreaterThan(0);
  }, 120_000);

  it('build type: the fixture is a debug build, a system app a release one', async () => {
    expect(await d.measure.buildType(APP)).toBe('debug');
    expect(await d.measure.buildType('com.android.settings')).toBe('release');
    expect(await d.measure.buildType('no.such.app')).toBe('unknown');
  });

  it('energy: an emulator says it has no power model; a phone estimates, and its history stays', async () => {
    const onBattery = async () =>
      Number(
        /Time on battery: (?:(\d+)h )?(?:(\d+)m )?/
          .exec(await d.shell('dumpsys batterystats --charged | head -20'))
          ?.slice(1, 3)
          .reduce((a, b, i) => a + Number(b ?? 0) * (i === 0 ? 60 : 1), 0) ?? 0,
      );
    if (serial!.startsWith('emulator-')) {
      await expect(d.measure.energy(APP, 500)).rejects.toMatchObject({
        code: 'UNSUPPORTED',
        message: /power model/,
      });
      return;
    }
    const before = await onBattery();
    await open('cpu');
    const m = (await d.measure.energy(APP, 5_000)).value;
    console.log('energy:', JSON.stringify(m));
    expect(m.mah).toBeGreaterThanOrEqual(0);
    expect(m.note).toMatch(/model/);
    // a reset would take the time on battery back to nothing
    expect(await onBattery()).toBeGreaterThanOrEqual(before);
    expect(await d.shell('dumpsys battery')).not.toMatch(/UPDATES STOPPED/);
  }, 120_000);
});
