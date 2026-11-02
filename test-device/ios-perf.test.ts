import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IosSimulatorDevice, Simctl, buildScreen } from 'appdyno';
import { mkdtempSync, statSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Accuracy of the iOS simulator perf tools against the fixture's measurement screens (APPDYNO_IOS_UDID):
 * 50 MB held shows in the footprint, a 3 s busy loop shows as one core and tops the profile, a cold
 * launch takes longer than a warm one.
 */
const udid = process.env.APPDYNO_IOS_UDID;
const APP = 'dev.appdyno.fixture';
const PRODUCTS = join(import.meta.dirname, '../ios/.derived/Build/Products/Debug-iphonesimulator');
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * On macOS 27 (Darwin 27) `sample` leaves out a simulator app's running thread: no busy sample while `ps`
 * shows that app at 85 % of a core. A Mac process's running thread is still there.
 */
const sampleMissesRunningThreads = Number(release().split('.')[0]) >= 27;

describe.skipIf(!udid)('ios simulator perf accuracy', () => {
  let d: IosSimulatorDevice;
  const open = async (screen: string) => {
    await d.terminate(APP);
    await d.launch(APP);
    await d.openUrl(`appdyno-fixture://open/${screen}`, APP);
    await pause(800);
    return buildScreen(await d.tree(), { platform: 'ios', appId: APP });
  };
  const byId = (s: Awaited<ReturnType<typeof open>>, id: string) => {
    const e = s.list.find((x) => x.id === id);
    if (!e) throw new Error(`no ${id}`);
    return e;
  };

  beforeAll(async () => {
    await new Simctl().install(udid!, join(PRODUCTS, 'Fixture.app'));
    d = new IosSimulatorDevice(udid!);
    await d.open();
  }, 240_000);
  // the runner does not stay on a shared simulator after the run
  afterAll(() => d?.stopAgent());

  it('memory: 50 MB held shows in the footprint (within 15 %)', async () => {
    const s = await open('memory');
    const before = (await d.measure.memory(APP)).value.footprintKb;
    await d.tap(byId(s, 'memory_alloc'), { settle: false });
    await pause(1_500);
    const after = (await d.measure.memory(APP)).value.footprintKb;
    await d.tap(byId(s, 'memory_free'), { settle: false });
    expect((after - before) / 1024).toBeGreaterThan(50 * 0.85);
    expect((after - before) / 1024).toBeLessThan(50 * 1.15);
  });

  it('CPU: a busy loop on one thread reads as one core', async () => {
    const s = await open('cpu');
    await d.tap(byId(s, 'cpu_load'), { settle: false });
    await pause(200);
    const cpu = (await d.measure.cpu(APP, 2_000)).value;
    expect(cpu.percent).toBeGreaterThan(80);
    expect(cpu.percent).toBeLessThan(125);
    await pause(1_500);
  });

  it('CPU profile: the busy loop is the top function', async (t) => {
    const s = await open('cpu');
    const prof = (
      await d.measure.cpuProfile(APP, 2_000, async () => {
        await pause(200);
        await d.tap(byId(s, 'cpu_load'), { settle: false });
      })
    ).value;
    if (prof.samples === 0 && sampleMissesRunningThreads) return t.skip();
    expect(prof.samples).toBeGreaterThan(100);
    // a debug build spends the loop's own time in runtime helpers: the app's functions rank by busy inclusive time
    expect(prof.appTop[0]?.symbol).toMatch(/CpuScreen/);
    expect(prof.appTop[0]!.percent).toBeGreaterThan(30);
    await pause(2_000);
  }, 60_000);

  it('frames: says plainly that hitches need a phone', async () => {
    expect(() => d.hitches()).toThrow(/on an iPhone only/);
  });

  it('heap: a memory graph with the leaks summary', async () => {
    const s = await open('memory');
    await d.tap(byId(s, 'memory_alloc'), { settle: false });
    await pause(1_000);
    const file = join(mkdtempSync(join(tmpdir(), 'appdyno-heap-')), 'heap.memgraph');
    const g = (await d.measure.heapGraph(APP, file)).value;
    await d.tap(byId(s, 'memory_free'), { settle: false });
    expect(statSync(file).size).toBe(g.bytes);
    expect(g.bytes).toBeGreaterThan(100 * 1024);
    expect(g.leaks).toBeGreaterThanOrEqual(0);
  }, 180_000);

  it('launch: a cold start takes longer than a warm one', async () => {
    const cold = (await d.measure.launch(APP, { mode: 'cold', repeats: 3 })).value;
    const warm = (await d.measure.launch(APP, { mode: 'warm', repeats: 3 })).value;
    expect(cold.samplesMs).toHaveLength(3);
    expect(cold.medianMs).toBeLessThan(10_000);
    expect(warm.medianMs).toBeLessThan(cold.medianMs);
  }, 180_000);
});
