import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cannot, must, type ActOptions } from '@appdyno/core';
import type { ActParams, Tree } from '@appdyno/protocol';
import { latestRuns, runKeys } from '@appdyno/perf';
import { assert, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { MEASUREMENTS, connect } from './shared.js';

// a virtual device's numbers are noisy under host load: these answers must not depend on this Mac's
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  loadavg: () => [0, 0, 0],
}));

describe('perf tools', () => {
  it('snapshot: CPU, memory, frames and the device, with the raw output stored under its id', async () => {
    const t = await connect();
    const r = await t.textOf('perf_snapshot');
    expect(r.error).toBe(false);
    expect(r.text).toContain('virtual device: relative');
    expect(r.text).toContain('CPU: 12.5%');
    expect(r.text).toContain('janky 4%');
    const id = must(/measurement (pm-[0-9a-f]{8})/.exec(r.text)?.[1], 'its id');
    const stored = JSON.parse(readFileSync(join(MEASUREMENTS, `${id}.json`), 'utf8')) as unknown;
    expect(stored).toMatchObject({ id, kind: 'snapshot', value: { cpu: { percent: 12.5 } } });
    expect(readFileSync(join(MEASUREMENTS, `${id}.txt`), 'utf8')).toContain('TOTAL PSS');
    expect(r.text).toContain('graphics 9.8 MB');
    expect(r.text).toContain('CPU pressure 2, thermal 0');
  });

  it('snapshot: says when most of the memory is swapped out, which the heaps leave out', async () => {
    const dev = new FakeDevice();
    const memory = dev.measure.memory.bind(dev.measure);
    const swapped = { kb: 195_610, javaHeapKb: 28, nativeHeapKb: 628, swapPssKb: 139_524 };
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        memory: async (...a: Parameters<typeof memory>) => {
          const m = await memory(...a);
          return { ...m, value: { ...m.value, ...swapped } };
        },
      },
    });
    expect((await (await connect({}, dev)).textOf('perf_snapshot')).text).toContain(
      'memory: PSS 191.0 MB, Java 0.0 MB, native 0.6 MB, graphics 9.8 MB; 136.3 MB of it swapped out to compressed memory (zram), which the heaps leave out',
    );
    expect((await (await connect()).textOf('perf_snapshot')).text).not.toContain('swapped');
  });

  it('snapshot: leaves out what the device did not say, where it read as a question mark or nothing', async () => {
    const dev = new FakeDevice();
    const at = new Date().toISOString();
    const memory = dev.measure.memory.bind(dev.measure);
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        vitals: () => Promise.resolve({ value: { load: [1, 1, 1] }, raw: '', at }),
        memory: async (...a: Parameters<typeof memory>) => {
          const m = await memory(...a);
          return { ...m, value: { ...m.value, graphicsKb: 0 } };
        },
      },
    });
    const r = await (await connect({}, dev)).textOf('perf_snapshot');
    expect(r.text).toContain('device: load 1 1 1\n');
    expect(r.text).not.toContain('graphics');
    expect(r.text).not.toContain('?');
  });

  it('snapshot and scroll: say the frames left out as timed to end after they were read', async () => {
    const dev = new FakeDevice();
    const frames = dev.measure.frames.bind(dev.measure);
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        frames: async (...a: Parameters<typeof frames>) => {
          const f = await frames(...a);
          const worstWindow = { frames: 19, slow: 19, avgMs: 120.3 };
          return {
            ...f,
            value: {
              ...f.value,
              frames: {
                count: 46,
                slow: 40,
                slowPercent: 87,
                p50Ms: 125,
                p95Ms: 350,
                worstMs: 1450,
                worstWindow,
              },
              badRows: 2,
            },
          };
        },
      },
    });
    const t = await connect({}, dev);
    const snapshot = (await t.textOf('perf_snapshot')).text;
    expect(snapshot).toContain(
      'worst second: 19 missed of 19 frames, mean 120.3 ms\n2 frames left out: timed to end after they were read, they cannot be real',
    );
    expect((await t.textOf('perf_scroll', { swipes: 1 })).text).toContain(
      'round 1: 120 frames (2 left out: timed to end after they were read, they cannot be real), janky 4%',
    );
  });

  it('trace: a measure a device has no way of giving says why, and what measures the like', async () => {
    const dev = new FakeDevice();
    const reason = "they are read from an iPhone's trace";
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        hangs: cannot('hangs', { reason }),
        attachProbe: cannot('through a frame probe', { reason, hint: 'leave out probe' }),
      },
    });
    const t = await connect({}, dev);
    expect((await t.textOf('perf_trace', { what: 'hangs' })).text).toBe(
      "UNSUPPORTED: emulator-5580 cannot measure hangs: they are read from an iPhone's trace\nhint: perf_trace with what: frames reads the main thread's stalls here",
    );
    expect((await t.textOf('perf_trace', { probe: true })).text).toMatch(
      /\nhint: leave out probe$/,
    );
    expect((await t.textOf('perf_profile', { dsym: '/b/App.app.dSYM' })).text).toMatch(
      /^UNSUPPORTED: dsym is for iOS.*\nhint: leave out dsym$/s,
    );
  });

  it('launch: says no start was measured where the system timed each as another state', async () => {
    const dev = new FakeDevice();
    const at = new Date().toISOString();
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        launch: () =>
          Promise.resolve({
            value: {
              mode: 'cold',
              samples: [
                { totalMs: 0, state: 'UNKNOWN' },
                { totalMs: 0, state: 'UNKNOWN' },
              ],
            },
            raw: 'LaunchState: UNKNOWN (0)',
            at,
          }),
      },
    });
    const r = await (await connect({}, dev)).textOf('perf_launch', { repeats: 2 });
    expect(r.text).toContain(
      'median: not measured: the system timed no start as COLD; a start reads UNKNOWN where another window came to the front, or the system stopped waiting for it',
    );
    expect(r.text).not.toContain('slow cold start');
  });

  it('launch: says how many starts its median is of, where the system timed the others as another state', async () => {
    const dev = new FakeDevice();
    const at = new Date().toISOString();
    // Now in Android on a loaded API 36 emulator: a start that timed out, a cold one, and one the system found warm
    const samples = [
      { state: 'UNKNOWN' },
      { totalMs: 9654, state: 'COLD', fullyDrawnMs: 9900 },
      { totalMs: 5428, state: 'WARM', fullyDrawnMs: 5600 },
    ];
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        launch: () =>
          Promise.resolve({ value: { mode: 'cold', samples, medianMs: 9654 }, raw: '', at }),
      },
    });
    const r = await (
      await connect({}, dev)
    ).textOf('perf_launch', {
      repeats: 3,
      scenario: 'launch-mixed',
    });
    expect(r.text).toContain(
      'cold launch: ? ms (UNKNOWN), 9654 ms (COLD), 5428 ms (WARM)\nmedian: 9654 ms, longest 9654 ms, of 1 of the 3 starts: the system timed the others as UNKNOWN, WARM, not as COLD',
    );
    const [key] = await runKeys(MEASUREMENTS, { app: 'dev.app', scenario: 'launch-mixed' });
    assert(key);
    const [run] = await latestRuns(MEASUREMENTS, key, 1);
    expect(run?.filter((x) => x.kind === 'launch.ttfd_ms').map((x) => x.value)).toEqual([9900]);
  });

  it('scroll: reads one round where it is asked for a reading, and three for a scenario a baseline is kept under', async () => {
    const t = await connect({}, new FakeDevice());
    const rounds = async (args: Record<string, unknown>) =>
      (((await t.call('perf_scroll', args)).structuredContent ?? {}) as { rounds?: unknown[] })
        .rounds;
    expect(await rounds({ swipes: 1 })).toHaveLength(1);
    expect(await rounds({ swipes: 1, scenario: 'feed' })).toHaveLength(3);
    expect(await rounds({ swipes: 1, repeats: 2 })).toHaveLength(2);
  });

  it("scroll: names the app's top function where it janked, from one scroll more under the profiler", async () => {
    const dev = new FakeDevice();
    const t = await connect({}, dev);
    expect((await t.textOf('perf_scroll', { swipes: 1 })).text).not.toContain('top function');
    dev.jank = 40;
    const r = (await t.call('perf_scroll', { swipes: 1 })).structuredContent as {
      findings: string[];
      rounds: unknown[];
    };
    expect(r.findings).toContain(
      "the app's top function as it scrolled: dev.app.Busy.loop, 62.1% of its samples",
    );
    expect(r.rounds).toHaveLength(1);
  });

  it('scroll: says the median of an even count of rounds to a tenth, as each round says its own', async () => {
    const dev = new FakeDevice();
    const shares = [98.13, 98.2];
    // each round's frames read the next share
    Object.defineProperty(dev, 'jank', {
      get: () => shares[dev.calls.filter((c) => c.name === 'perf.frames').length % 2],
    });
    const t = await connect({}, dev);
    const r = await t.textOf('perf_scroll', { swipes: 1, repeats: 2 });
    expect(r.text).toContain('median jank: 98.2%');
    expect(r.text).toContain('high jank: median 98.2% (threshold 10%)');
  });

  it('scroll: says the profile of its jank failed, where it names no top function', async () => {
    const dev = new FakeDevice();
    dev.jank = 25;
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        cpuProfile: () => Promise.reject(new Error('the trace tool cannot read its own trace')),
      },
    });
    const r = await (await connect({}, dev)).textOf('perf_scroll', { swipes: 2 });
    expect(r.text).toContain('high jank');
    expect(r.text).toContain(
      'no top function: the profile of one scroll more failed: the trace tool cannot read its own trace',
    );
  });

  it('scroll: each round resets frames, swipes, reads; jank over the threshold and memory growth are said', async () => {
    const dev = new FakeDevice();
    dev.jank = 25;
    const t = await connect({}, dev);
    const r = await t.textOf('perf_scroll', { swipes: 2, repeats: 3 });
    expect(r.text).toContain('median jank: 25%');
    expect(r.text).toContain('high jank');
    const order = dev.calls.map((c) => c.name).filter((n) => n.startsWith('perf') || n === 'act');
    expect(order.slice(0, 6)).toEqual([
      'perf.memory',
      'perf.reset',
      'act',
      'act',
      'perf.frames',
      'perf.memory',
    ]);
    const swipe = must(
      dev.calls.find((c) => c.name === 'act'),
      'a swipe',
    ).args[0] as {
      kind: string;
      from: { y: number };
      to: { y: number };
    };
    expect(swipe.kind).toBe('swipe');
    expect(swipe.to.y).toBeLessThan(swipe.from.y);
  });

  it('scroll: refuses a screen its swipes do not move, as a popup over the list, where it read as smooth', async () => {
    const dev = new FakeDevice();
    dev.listEnd = 0;
    const t = await connect({}, dev);
    const r = await t.textOf('perf_scroll', { swipes: 2 });
    expect(r.text).toMatch(
      /^NOT_FOUND: the swipes moved nothing on this screen, so no scroll was measured/,
    );
    expect(r.text).not.toContain('no threshold exceeded');
  });

  it('scroll: swipes the list under x and y or a selector, through its middle, and names the list its swipes missed', async () => {
    // an iPad's split view, as NetNewsWire's: the list on the left, a pane that moves nothing beside it
    class SplitView extends FakeDevice {
      override current(): Tree {
        const t = super.current();
        const [list, at] = ['androidx.recyclerview.widget.RecyclerView', t.nodes.length];
        t.nodes.push(
          { p: 0, w: 0, c: list, b: [0, 200, 400, 2200], f: 1 | 16 | 256 },
          { p: at, w: 0, c: 'android.widget.TextView', t: 'Feeds', b: [0, 1800, 400, 1900], f: 17 },
        );
        return t;
      }
      override act(action: ActParams, opts?: ActOptions) {
        const pane = action.kind === 'swipe' && action.from.x >= 400;
        return super.act(pane ? { ...action, to: action.from } : action, opts);
      }
    }
    const dev = new SplitView();
    const t = await connect({}, dev);
    expect((await t.textOf('perf_scroll', { swipes: 1 })).text).toBe(
      'NOT_FOUND: the swipes moved nothing on this screen, so no scroll was measured: they went at 540,1200, on no scrollable, and this screen has a scrollable elsewhere: RecyclerView at 200,1200\nhint: give x and y or a selector on the list to measure, or close what covers it, and call again',
    );
    const swiped = async (args: Record<string, unknown>) => {
      dev.calls.length = 0;
      expect((await t.textOf('perf_scroll', { swipes: 1, ...args })).text).toContain(
        'round 1: 120 frames',
      );
      return dev.calls.find((c) => c.name === 'act')?.args[0];
    };
    expect(await swiped({ x: 120, y: 2000 })).toMatchObject({
      from: { x: 120, y: 1200 },
      to: { x: 120, y: 400 },
    });
    expect(await swiped({ selector: { text: 'Feeds' } })).toMatchObject({
      from: { x: 200, y: 1200 },
      to: { x: 200, y: 400 },
    });
    expect((await t.textOf('perf_scroll', { x: 120 })).text).toMatch(
      /^INVALID_ARGUMENT: x and y go together.*\nhint: \w/s,
    );
  });

  it('scroll: a list at its end before the first round is brought back and measured', async () => {
    const dev = new FakeDevice();
    dev.listEnd = 2;
    const up = {
      kind: 'swipe',
      from: { x: 540, y: 1600 },
      to: { x: 540, y: 600 },
      durationMs: 300,
    } as const;
    await dev.act(up);
    await dev.act(up);
    const t = await connect({}, dev);
    const r = await t.textOf('perf_scroll', { swipes: 2 });
    expect(r.text).toContain('round 1: 120 frames');
    expect(r.text).toContain('round 1 ran after the list was brought back');
  });

  it('scroll: reads the rounds of an app that draws on its own surface from that surface', async () => {
    const dev = new FakeDevice();
    const counted = dev.measure.framesDuring.bind(dev.measure);
    const surface = {
      layer: 'SurfaceView[dev.app](BLAST)#9',
      refreshMs: 16.7,
      frames: 180,
      fps: 58.4,
      p50Ms: 16.7,
      p95Ms: 16.7,
      worstMs: 50,
      slow34Percent: 1.1,
      slow50Percent: 0.6,
      drawing: true,
    };
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        framesDuring: async (...a: Parameters<typeof counted>) => {
          const f = await counted(...a);
          return {
            ...f,
            value: { ...f.value, totalFrames: 1, jankyFrames: 0, jankyPercent: 0, surface },
          };
        },
      },
    });
    const r = await (await connect({}, dev)).textOf('perf_scroll', { swipes: 2 });
    expect(r.text).toContain(
      'round 1: on its own surface, 180 frames, 58.4 a second, p95 16.7 ms, 1.1% 34 ms or more after the last',
    );
    expect(r.text).toContain(
      'median on its own surface: p95 16.7 ms, 1.1% 34 ms or more after the last, 0.6% 50 ms or more',
    );
    expect(r.text).toContain('Play: ');
    expect(r.text).not.toContain('nothing judged');
    expect(r.text).not.toContain('median jank');
  });

  it('scroll: rounds that drew too few frames are judged by nothing, and no threshold is said to hold', async () => {
    const dev = new FakeDevice();
    const none = dev.measure.framesDuring.bind(dev.measure);
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        framesDuring: async (...a: Parameters<typeof none>) => {
          const f = await none(...a);
          // a Flutter app on a loaded emulator: its surface drew 4 a second over the round
          const surface = { layer: 'SurfaceView[dev.app]', frames: 14, fps: 4 };
          return {
            ...f,
            value: { ...f.value, totalFrames: 0, jankyFrames: 0, jankyPercent: 0, surface },
          };
        },
        // what SurfaceFlinger keeps of a surface, whatever its age: no round's
        surfaceFrames: () =>
          Promise.resolve({
            value: { layer: 'SurfaceView[dev.app]', frames: 127, fps: 49 },
            raw: '',
            at: new Date().toISOString(),
          }),
      },
    });
    const t = await connect({}, dev);
    const r = await t.textOf('perf_scroll', { swipes: 2 });
    expect(r.text).toContain(
      "nothing judged: no round drew the 60 frames a share takes, nor did the app's own surface: 14 at most in a round",
    );
    expect(r.text).not.toContain('127');
    expect(r.text).not.toContain('no threshold exceeded');
  });

  it('scroll: goes on into new rows for as long as the list moves', async () => {
    const dev = new FakeDevice();
    const t = await connect({}, dev);
    await t.textOf('perf_scroll', { swipes: 2, repeats: 3 });
    const way = (c: (typeof dev.calls)[number]) => {
      if (c.name === 'perf.frames') return 'read';
      const s = c.args[0] as { from: { y: number }; to: { y: number } };
      return s.to.y < s.from.y ? 'up' : 'down';
    };
    const seen = dev.calls.filter((c) => c.name === 'act' || c.name === 'perf.frames').map(way);
    expect(seen).toEqual(['up', 'up', 'read', 'up', 'up', 'read', 'up', 'up', 'read']);
  });

  it("scroll and trace: a probe's relaunch measures nothing, as it leaves the app on its first screen", async () => {
    const dev = new FakeDevice();
    let probed = false;
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        framesByProbe: true,
        attachProbe: () => Promise.resolve(!probed && (probed = true)),
      },
    });
    const t = await connect({}, dev);
    for (const name of ['perf_scroll', 'perf_trace']) {
      probed = false;
      const relaunched = await t.call(name);
      expect(relaunched.structuredContent).toMatchObject({
        code: 'CHECK_FAILED',
        hint: 'open the screen to measure again and call once more: the probe stays in until the app stops',
      });
      expect(relaunched.content[0]?.text).toBe(
        'CHECK_FAILED: dev.app was relaunched with the frame probe in it, and shows its first screen: nothing was measured\nhint: open the screen to measure again and call once more: the probe stays in until the app stops',
      );
      expect(dev.calls.some((c) => c.name.startsWith('perf.'))).toBe(false);
      expect((await t.call(name)).isError).toBeUndefined();
      dev.calls.length = 0;
    }
  });

  it('launch: the median against the vitals threshold; only allowed apps', async () => {
    const t = await connect({ apps: ['dev.app'] });
    const r = await t.textOf('perf_launch', { mode: 'cold' });
    expect(r.text).toContain('median: 600 ms');
    expect(r.text).not.toContain('excessive');
    expect((await t.textOf('perf_launch', { app: 'com.other' })).error).toBe(true);
  });

  it('profile: the functions taking the CPU; heap: the dump file stays here', async () => {
    const t = await connect();
    expect((await t.textOf('perf_profile', { seconds: 2 })).text).toContain(
      '\n62.1% dev.app.Busy.loop',
    );
    expect((await t.textOf('perf_heap')).text).toMatch(
      /heap dump: .*heap-dev\.app-\d+\.hprof \(60\.0 MB\)/,
    );
  });

  it("profile and scroll: a kernel address is the kernel's time, which this device names by address, and no function of the app", async () => {
    // Now in Android scrolled on an API 35 emulator
    const profile = {
      durationMs: 3000,
      samples: 948,
      top: [
        { percent: 53.06, samples: 503, symbol: '[kernel.kallsyms][+ffffffc07a5f3500]' },
        { percent: 2.85, samples: 27, symbol: '[kernel.kallsyms][+ffffffc080312164]' },
        { percent: 1.79, samples: 17, symbol: 'android::uirenderer::RenderNode::prepareTreeImpl' },
      ],
    };
    const dev = new FakeDevice();
    dev.jank = 40;
    const at = new Date().toISOString();
    Object.defineProperty(dev, 'measure', {
      value: { ...dev.measure, cpuProfile: () => Promise.resolve({ value: profile, raw: '', at }) },
    });
    const t = await connect({}, dev);
    const listed = (await t.textOf('perf_profile', { seconds: 3 })).text;
    expect(listed).toContain('\n53.06% [kernel.kallsyms][+ffffffc07a5f3500]\n');
    expect(listed).toContain(
      "[kernel.kallsyms][+…] is time in the kernel, by its address: this device hides the kernel's names",
    );
    expect((await t.textOf('perf_scroll', { swipes: 1 })).text).toContain(
      "the app's top function as it scrolled: android::uirenderer::RenderNode::prepareTreeImpl, 1.79% of its samples, after the time of the kernel, whose names this device hides",
    );
    profile.top = profile.top.slice(0, 2);
    expect((await t.textOf('perf_scroll', { swipes: 1 })).text).toContain(
      'the profile of one scroll more named no function: its samples were in the kernel, whose names this device hides',
    );
  });

  it('profile: says why an iPhone app’s own functions are addresses, and what names them', async () => {
    const dev = new FakeDevice();
    const profile = {
      durationMs: 1000,
      samples: 9,
      top: [{ percent: 90, samples: 8, symbol: '0x24785fec1' }],
      appTop: [{ percent: 99, samples: 9, symbol: '0x1045377c7' }],
    };
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        symbolFiles: true,
        cpuProfile: () =>
          Promise.resolve({ value: profile, raw: '', at: new Date().toISOString() }),
      },
    });
    const t = await connect({}, dev);
    const bare = (await t.textOf('perf_profile', { seconds: 1 })).text;
    expect(bare).toContain("the app's own functions are addresses: no symbols of this build");
    expect(bare).toContain('DEBUG_INFORMATION_FORMAT is dwarf-with-dsym');
    const given = await t.textOf('perf_profile', { seconds: 1, dsym: '/b/App.app.dSYM' });
    expect(given.text).not.toContain('are addresses');
  });

  it('trace: the frame timeline summary', async () => {
    const t = await connect();
    const r = await t.textOf('perf_trace', { seconds: 2 });
    expect(r.text).toContain('50 frames; late by the app 4 (8%)');
    expect(r.text).toContain('frozen frames: 1');
    expect(r.text).toContain("on a virtual device the compositor's jank");
    expect(r.text).not.toContain('own surface');
  });

  it('trace: says an app of few frames draws on its own surface, which the timeline leaves out', async () => {
    const dev = new FakeDevice();
    const at = new Date().toISOString();
    const traced = await dev.measure.frameTrace();
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        // Wonderous, a Flutter app, on an API 35 emulator
        frameTrace: () =>
          Promise.resolve({ ...traced, value: { ...traced.value, frames: 0, janky: 0 } }),
        surfaceFrames: () =>
          Promise.resolve({ value: { layer: 'SurfaceView[dev.app]', frames: 127 }, raw: '', at }),
      },
    });
    const r = await (await connect({}, dev)).textOf('perf_trace', { seconds: 2 });
    expect(r.text).toContain(
      "0 frames, of the 60 a share or a percentile needs: none is kept\nthe app draws on its own surface, as a Flutter app or a game does, and these frames leave it out: perf_scroll reads that surface's frames",
    );
  });
});
