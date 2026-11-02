import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AndroidDevice, traceProcessor, type Screen } from 'appdyno';

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
    await d.shell(`am start -W -a android.intent.action.VIEW -d gdfixture://open/${screen} ${APP}`);
    await new Promise((r) => setTimeout(r, 1_200));
    return d.read(APP);
  };
  const byId = (s: Screen, id: string) => s.list.find((e) => e.id === id)!;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    d = new AndroidDevice(serial!);
    await d.open();
  });
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
    // the app's own share tells them apart (an emulator marks nearly every frame janky: display prediction)
    expect(heavy.appDeadlineMissed).toBeGreaterThanOrEqual(15);
    expect(heavy.appDeadlineMissed).toBeGreaterThan(5 * light.appDeadlineMissed);
    expect(heavy.p95Ms).toBeGreaterThanOrEqual(40);
    expect(light.p95Ms).toBeLessThan(heavy.p95Ms);
  }, 90_000);
});
