import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type MeasureSource } from '@appdyno/core';
import { latestRuns, runKeys } from '@appdyno/perf';
import { assert, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, keepRun, ServerContext } from '../src/index.js';
import { hostIsVirtual } from '../src/perf/shared.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { callerOf, checkedOps } from '@appdyno/testing/calls.js';

// far over the limit on any Mac
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  loadavg: () => [10_000, 10_000, 10_000],
}));

/** A phone, its own launch or one timed on the Mac. */
function phone(until?: string) {
  const device = new FakeDevice();
  const launch: MeasureSource['launch'] = () =>
    Promise.resolve({
      value: {
        mode: 'cold',
        samples: [{ totalMs: 3_000 }],
        medianMs: 3_000,
        ...(until && { until }),
      },
      raw: '3000',
      at: new Date().toISOString(),
    });
  device.virtual = false;
  Object.defineProperty(device, 'measure', {
    value: {
      ...device.measure,
      buildType: () => Promise.resolve('release'),
      vitals: () =>
        Promise.resolve({
          value: { thermalStatus: 0 },
          raw: '',
          at: new Date().toISOString(),
        }),
      launch,
    } satisfies MeasureSource,
  });
  const measurements = mkdtempSync(join(tmpdir(), 'appdyno-load-'));
  const perf = mkdtempSync(join(tmpdir(), 'appdyno-load-'));
  const ctx = new ServerContext(
    DEFAULT_POLICY,
    [
      {
        list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
        handles: () => true,
        open: () => device,
      },
    ],
    { device: device.serial, app: 'dev.app', storage: { measurements, perf } },
  );
  return { ctx, measurements, perf, call: callerOf(ctx) };
}

describe('a loaded Mac', () => {
  it('marks a phone’s launch timed on it, says so and keeps the number', async () => {
    const { call, measurements } = phone('the first screen is read');
    const { text, data } = await call('perf_launch');
    expect(data.noise).toEqual(['high-host-load']);
    expect(text).toContain('noise: this Mac was loaded');
    expect(data.medianMs).toBe(3_000);
    const [key] = await runKeys(measurements, { app: 'dev.app' });
    assert(key);
    const [run] = await latestRuns(measurements, key, 1);
    expect(run?.[0]).toMatchObject({
      kind: 'launch.until_ms',
      value: 3_000,
      noise: ['high-host-load'],
    });
  });

  it('marks nothing of what a phone reports itself', async () => {
    const { call } = phone();
    const { text, data } = await call('perf_launch');
    expect(data.noise).toEqual([]);
    expect(text).not.toContain('noise');
  });

  it('leaves out of a baseline the number under it, says which, and keeps what the device timed itself', async () => {
    const { ctx, perf } = phone();
    const s = await ctx.session();
    const noise = await keepRun(ctx, s, {
      app: 'dev.app',
      scenario: 'mixed',
      source: 'test',
      raw: '',
      metrics: [
        { kind: 'memory.kb', unit: 'kb', samples: [1] },
        { kind: 'launch.until_ms', unit: 'ms', samples: [3_000], throughHost: true },
      ],
    });
    expect(noise).toEqual(['high-host-load']);
    const r = await must(checkedOps(ctx).perf_compare, 'perf_compare').handler({
      action: 'baseline',
      format: 'text',
      last: 1,
    });
    expect(r.blocks[0]).toMatchObject({
      text: expect.stringContaining('left out, high-host-load: launch.until_ms') as unknown,
    });
    // kept, and one run of the three a comparison needs
    expect(r.data.exitCode).toBe(1);
    const baseline = JSON.parse(
      readFileSync(must((r.data.baselines as string[])[0], 'a baseline'), 'utf8'),
    ) as {
      metrics: Record<string, unknown>;
    };
    expect(Object.keys(baseline.metrics)).toEqual(['memory.kb']);
    expect(perf).toBeTruthy();
  });

  it('takes no baseline from a run with every number under it', async () => {
    const { ctx } = phone();
    const s = await ctx.session();
    await keepRun(ctx, s, {
      app: 'dev.app',
      scenario: 'loud',
      source: 'test',
      raw: '',
      metrics: [{ kind: 'launch.until_ms', unit: 'ms', samples: [3_000], throughHost: true }],
    });
    const r = await must(checkedOps(ctx).perf_compare, 'perf_compare').handler({
      action: 'baseline',
      format: 'text',
      last: 1,
    });
    expect(r.blocks[0]).toMatchObject({
      text: expect.stringContaining('not added, high-host-load: measure loud again') as unknown,
    });
    expect(r.data.exitCode).toBe(1);
  });
});

describe('a Mac that is itself a virtual machine', () => {
  it('reads no noise from its load average, says so, and lets the number into a baseline', async () => {
    vi.stubEnv('APPDYNO_HOST_VIRTUAL', '1');
    try {
      expect(hostIsVirtual()).toBe(true);
      const { call } = phone('the first screen is read');
      const { text, data } = await call('perf_launch');
      expect(data.noise).toEqual(['host-load-unread']);
      expect(text).toContain('this Mac is a virtual machine');
      const { ctx } = phone();
      const s = await ctx.session();
      const keep = () =>
        keepRun(ctx, s, {
          app: 'dev.app',
          scenario: 'runner',
          source: 'test',
          raw: '',
          metrics: [
            { kind: 'launch.until_ms', unit: 'ms', samples: [3_000, 3_010], throughHost: true },
          ],
        });
      for (let i = 0; i < 3; i++) await keep();
      const r = await must(checkedOps(ctx).perf_compare, 'perf_compare').handler({
        action: 'baseline',
        scenario: 'runner',
        format: 'text',
        last: 3,
      });
      expect((r.blocks[0] as { text: string }).text).not.toContain('left out');
      expect(r.data.exitCode).toBe(0);
      const baseline = JSON.parse(
        readFileSync(must((r.data.baselines as string[])[0], 'a baseline'), 'utf8'),
      ) as { metrics: Record<string, unknown> };
      expect(Object.keys(baseline.metrics)).toEqual(['launch.until_ms']);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(hostIsVirtual()).toBe(false);
  });
});
