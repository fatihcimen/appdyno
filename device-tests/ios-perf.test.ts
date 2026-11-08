import { assert, beforeAll, describe, expect, it } from 'vitest';
import {
  IosSimulatorDevice,
  Simctl,
  simulatorProvider,
  buildScreen,
  sleep as pause,
  recordTrace,
} from './workspace.js';
import { DeviceError } from '@appdyno/protocol';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, statSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIM_FIXTURE } from './helpers.js';

/**
 * Accuracy of the iOS simulator perf tools against the fixture's measurement screens (APPDYNO_IOS_UDID):
 * 50 MB held shows in the footprint, a 3 s busy loop shows as one core and tops the profile, a cold
 * launch takes longer than a warm one, a 500 ms stall and a 500 ms slow start show in the frame probe,
 * retain cycles in the leaks count and 5 MB fetched in the network bytes.
 */
const udid = process.env.APPDYNO_IOS_UDID ?? '';
const APP = 'dev.appdyno.fixture';

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
    return buildScreen(await d.tree(), { port: d.platformScreen, appId: APP });
  };
  const byId = (s: Awaited<ReturnType<typeof open>>, id: string) => {
    const e = s.list.find((x) => x.id === id);
    if (!e) throw new Error(`no ${id}`);
    return e;
  };

  beforeAll(async () => {
    await new Simctl().install(udid, SIM_FIXTURE);
    d = new IosSimulatorDevice(udid);
    // the runner does not stay on a shared simulator after the run, nor after an open that failed
    return () => d.stopAgent();
  }, 240_000);
  beforeAll(() => d.open(), 240_000);

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
    expect(prof.appTop[0]?.percent).toBeGreaterThan(30);
    await pause(2_000);
  }, 60_000);

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

  it('leaks: each retain cycle made counts', async () => {
    const s = await open('leak');
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-leak-'));
    const before = (await d.measure.heapGraph(APP, join(dir, 'before.memgraph'))).value.leaks;
    for (let i = 0; i < 5; i++) await d.tap(byId(s, 'leak_make'), { settle: false });
    const after = (await d.measure.heapGraph(APP, join(dir, 'after.memgraph'))).value.leaks;
    console.log(`leaks ${String(before)} -> ${String(after)} after 5 cycles of 2 objects`);
    assert(before !== undefined && after !== undefined, 'a leaks count');
    expect(after - before).toBeGreaterThanOrEqual(5);
  }, 240_000);

  it('size and build type of the debug fixture', async () => {
    const size = (await d.measure.size(APP)).value;
    console.log('size', size.bytes, JSON.stringify(size.parts));
    expect(size.bytes).toBeGreaterThan(100 * 1024);
    expect(size.bytes).toBe(Object.values(size.parts).reduce((a, b) => a + b, 0));
    expect(await d.measure.buildType(APP)).toBe('debug');
  });

  it('network: 5 MB fetched shows in the bytes (within 15 %)', async () => {
    const bytes = 5 * 1000 * 1000;
    const server = createServer((_, res) => {
      res.writeHead(200, { 'Content-Length': bytes, Connection: 'close' });
      res.end(Buffer.alloc(bytes, 7));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const port = (server.address() as AddressInfo).port;
      await d.terminate(APP);
      await new Simctl().launch(udid, APP, {
        APPDYNO_FIXTURE_FETCH_URL: `http://127.0.0.1:${port}/`,
      });
      await d.openUrl('appdyno-fixture://open/network', APP);
      await pause(800);
      const s = buildScreen(await d.tree(), { port: d.platformScreen, appId: APP });
      const n = (
        await d.measure.network(APP, 3_000, () => d.tap(byId(s, 'fetch'), { settle: false }))
      ).value;
      console.log('network', JSON.stringify(n));
      expect(n.rxBytes).toBeGreaterThan(bytes * 0.85);
      expect(n.rxBytes).toBeLessThan(bytes * 1.15);
      expect(n.txBytes).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  }, 60_000);

  it('queries a kept trace: its tables, then one table cut to a limit', async () => {
    const s = await open('cpu');
    const trace = await recordTrace({
      template: 'Time Profiler',
      device: udid,
      attach: () => d.measure.pid(APP),
      seconds: 2,
      dir: mkdtempSync(join(tmpdir(), 'appdyno-trace-')),
      during: () => d.tap(byId(s, 'cpu_load'), { settle: false }),
    });
    const provider = simulatorProvider();
    assert(provider.queryTrace !== undefined);
    const tables = await provider.queryTrace(trace, { limit: 500 });
    expect(tables?.rows.flat()).toContain('time-profile');
    const digest = await provider.queryTrace(trace, { table: 'time-profile', limit: 3 });
    expect(digest?.columns).toContain('weight');
    expect(digest?.rows.length).toBeLessThanOrEqual(3);
    expect(await provider.queryTrace('/tmp/x.jsonl', { limit: 3 })).toBeUndefined();
  }, 120_000);

  describe('frame probe', () => {
    const openProbed = async (screen: string) => {
      await d.terminate(APP);
      await d.measure.attachProbe(APP);
      await d.openUrl(`appdyno-fixture://open/${screen}`, APP);
      await pause(800);
      return buildScreen(await d.tree(), { port: d.platformScreen, appId: APP });
    };

    it('without the probe, frames say how to have it', async () => {
      await open('stall');
      const e = await d.measure.frames(APP).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(DeviceError);
      expect((e as DeviceError).code).toBe('UNSUPPORTED');
      expect((e as DeviceError).hint).toMatch(/the probe takes a relaunch of the app/);
    });

    it('attaches once: a running probe is not relaunched', async () => {
      await openProbed('stall');
      const pid = await d.measure.pid(APP);
      await d.measure.attachProbe(APP);
      expect(await d.measure.pid(APP)).toBe(pid);
    });

    it('a 500 ms stall reads within 10 %, a light tap as none', async () => {
      const s = await openProbed('stall');
      const heavy = (
        await d.measure.frameTrace(APP, 3, async () => {
          await pause(500);
          await d.tap(byId(s, 'stall_500'), { settle: false });
        })
      ).value;
      console.log('stall_500', JSON.stringify(heavy));
      if (heavy.kind !== 'probe') throw new Error(heavy.kind);
      expect(heavy.stalls.worstMs).toBeGreaterThan(500 * 0.9);
      expect(heavy.stalls.worstMs).toBeLessThan(500 * 1.1);
      expect(heavy.limits).toMatch(/not the render server or GPU/);
      expect(statSync(heavy.tracePath).size).toBeGreaterThan(0);
      const light = (
        await d.measure.frameTrace(APP, 3, async () => {
          await pause(500);
          await d.tap(byId(s, 'stall_light'), { settle: false });
        })
      ).value;
      console.log('stall_light', JSON.stringify(light));
      if (light.kind !== 'probe') throw new Error(light.kind);
      expect(light.stalls.worstMs).toBeLessThan(heavy.stalls.worstMs / 2);
    }, 60_000);

    it('frames: light ones smooth, heavy ones mostly missed', async () => {
      const s = await openProbed('frames');
      await d.measure.resetFrames(APP);
      await d.tap(byId(s, 'frames_light'), { settle: false });
      await pause(2_000);
      const light = (await d.measure.frames(APP, { reset: true })).value;
      console.log('frames_light', JSON.stringify(light));
      await pause(500);
      await d.measure.resetFrames(APP);
      await d.tap(byId(s, 'frames_heavy'), { settle: false });
      await pause(2_000);
      const heavy = (await d.measure.frames(APP)).value;
      console.log('frames_heavy', JSON.stringify(heavy));
      expect(light.jankyPercent).toBeLessThan(15);
      expect(heavy.jankyPercent).toBeGreaterThan(60);
      expect(heavy.p50Ms).toBeGreaterThan(40);
      expect(light.p50Ms).toBeLessThan(25);
    }, 60_000);

    it('lastInputAt follows a tap', async () => {
      const s = await openProbed('stall');
      await pause(500);
      const none = (await d.measure.frameTrace(APP, 1)).value;
      if (none.kind !== 'probe') throw new Error(none.kind);
      expect(none.lastInputMsAgo).toBeUndefined();
      let tappedAfter = 0;
      const start = Date.now();
      const v = (
        await d.measure.frameTrace(APP, 2, async () => {
          await d.tap(byId(s, 'stall_light'), { settle: false });
          tappedAfter = Date.now() - start;
        })
      ).value;
      console.log('lastInput', v.kind === 'probe' && v.lastInputMsAgo, tappedAfter);
      if (v.kind !== 'probe') throw new Error(v.kind);
      // somewhere between the tap's start and its return: a tap takes the runner its time to return
      assert(v.lastInputMsAgo !== undefined);
      const touchedAfter = v.durationMs - v.lastInputMsAgo;
      expect(touchedAfter).toBeGreaterThanOrEqual(0);
      expect(touchedAfter).toBeLessThan(tappedAfter + 200);
    }, 60_000);

    it('a 500 ms slow start raises the launch by that (within 25 %)', async () => {
      await openProbed('stall');
      const base = (await d.measure.launch(APP, { mode: 'cold', repeats: 5, probe: true })).value;
      const slow = (
        await d.measure.launch(APP, {
          mode: 'cold',
          repeats: 5,
          probe: true,
          env: { APPDYNO_FIXTURE_STARTUP_MS: '500' },
        })
      ).value;
      console.log('launch', JSON.stringify(base.samplesMs), JSON.stringify(slow.samplesMs));
      expect(base.until).toBe('first frame (probe)');
      expect(slow.medianMs - base.medianMs).toBeGreaterThan(500 * 0.75);
      expect(slow.medianMs - base.medianMs).toBeLessThan(500 * 1.25);
    }, 120_000);
  });

  // the runner gives way to the test and the next command starts it again: these come last
  describe("XCTest's metrics", () => {
    it('launch', async () => {
      const m = (await d.measure.xctMetrics(APP, 'launch')).value;
      console.log('xct launch', JSON.stringify(m.metrics));
      const [durations] = Object.values(m.metrics);
      assert(durations);
      expect(durations.length).toBeGreaterThanOrEqual(5);
      expect(durations[0]).toBeGreaterThan(0);
      await d.tree();
    }, 400_000);

    it('hitches: says plainly when a simulator records none', async () => {
      await open('list');
      // a refusal is a value to check; anything else fails the test as it is
      const r = await d.measure.xctMetrics(APP, 'hitches').catch((e: unknown) => {
        if (e instanceof DeviceError) return e;
        throw e;
      });
      console.log('xct hitches', r instanceof Error ? r.message : JSON.stringify(r.value.metrics));
      if (r instanceof DeviceError) {
        expect(r.code).toBe('UNSUPPORTED');
        expect(r.message).toMatch(/recorded no value/);
      } else expect(Object.keys(r.value.metrics).length).toBeGreaterThan(0);
      await d.tree();
    }, 400_000);
  });
});
