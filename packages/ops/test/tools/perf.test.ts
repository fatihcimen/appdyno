import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { describe, expect, it, vi } from 'vitest';
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

  it('snapshot: leaves out what the device did not say, where it read as a question mark or nothing', async () => {
    const dev = new FakeDevice();
    const at = new Date().toISOString();
    const memory = dev.measure.memory.bind(dev.measure);
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        vitals: () => Promise.resolve({ value: { load: [1, 1, 1] }, raw: '', at }),
        memory: async (app: string) => {
          const m = await memory(app);
          return { ...m, value: { ...m.value, graphicsKb: 0 } };
        },
      },
    });
    const r = await (await connect({}, dev)).textOf('perf_snapshot');
    expect(r.text).toContain('device: load 1 1 1\n');
    expect(r.text).not.toContain('graphics');
    expect(r.text).not.toContain('?');
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

  it('scroll: rounds that drew too few frames are judged by nothing, and no threshold is said to hold', async () => {
    const dev = new FakeDevice();
    const none = dev.measure.framesDuring.bind(dev.measure);
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        framesDuring: async (...a: Parameters<typeof none>) => {
          const f = await none(...a);
          return { ...f, value: { ...f.value, totalFrames: 0, jankyFrames: 0, jankyPercent: 0 } };
        },
      },
    });
    const t = await connect({}, dev);
    const r = await t.textOf('perf_scroll', { swipes: 2 });
    expect(r.text).toContain('nothing judged: no round drew the');
    expect(r.text).toContain("perf_snapshot with also: ['surface']");
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
      '%62.1 dev.app.Busy.loop',
    );
    expect((await t.textOf('perf_heap')).text).toMatch(
      /heap dump: .*heap-dev\.app-\d+\.hprof \(60\.0 MB\)/,
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
  });
});
