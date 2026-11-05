import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MeasureSource } from '@appdyno/core';
import { latestRuns, runKeys } from '@appdyno/perf';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, keepRun, ServerContext } from '../src/index.js';
import { FakeDevice } from './fake-device.js';
import { callerOf, checkedOps } from './helpers.js';

// far over the limit on any Mac
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  loadavg: () => [10_000, 10_000, 10_000],
}));

/** A phone, its own launch or one timed on the Mac. */
function phone(until?: string) {
  const device = new FakeDevice();
  const launch: MeasureSource['launch'] = async () => ({
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
      buildType: async () => 'release',
      vitals: async () => ({ value: {}, raw: '', at: new Date().toISOString() }),
      launch,
    } satisfies MeasureSource,
  });
  const measurements = mkdtempSync(join(tmpdir(), 'appdyno-load-'));
  const perf = mkdtempSync(join(tmpdir(), 'appdyno-load-'));
  const ctx = new ServerContext(
    DEFAULT_POLICY,
    [
      {
        list: async () => [{ serial: device.serial, state: 'device', ready: true }],
        handles: () => true,
        open: () => device,
      },
    ],
    { device: device.serial, app: 'dev.app', measurements, perf },
  );
  return { ctx, measurements, perf, call: callerOf(ctx) };
}

describe('a loaded Mac', () => {
  it('marks a phone’s launch timed on it, says so and keeps the number', async () => {
    const { call, measurements } = phone('the first screen is read');
    const { text, data } = await call('perf_launch');
    expect(data.noise).toEqual(['high-host-load']);
    expect(text).toContain('noise: high-host-load');
    expect(data.medianMs).toBe(3_000);
    const [key] = await runKeys(measurements, { app: 'dev.app' });
    const [run] = await latestRuns(measurements, key!, 1);
    expect(run![0]).toMatchObject({
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
    const noise = await keepRun(ctx, s, 'dev.app', 'mixed', 'test', '', [
      { kind: 'memory.kb', unit: 'kb', samples: [1] },
      { kind: 'launch.until_ms', unit: 'ms', samples: [3_000], throughHost: true },
    ]);
    expect(noise).toEqual(['high-host-load']);
    const r = await checkedOps(ctx).perf_compare!.handler({
      action: 'baseline',
      format: 'text',
      last: 1,
    });
    expect(r.blocks[0]).toMatchObject({
      text: expect.stringContaining('left out, high-host-load: launch.until_ms'),
    });
    // kept, and one run of the three a comparison needs
    expect(r.data.exitCode).toBe(1);
    const baseline = JSON.parse(readFileSync((r.data.baselines as string[])[0]!, 'utf8')) as {
      metrics: Record<string, unknown>;
    };
    expect(Object.keys(baseline.metrics)).toEqual(['memory.kb']);
    expect(perf).toBeTruthy();
  });

  it('takes no baseline from a run with every number under it', async () => {
    const { ctx } = phone();
    const s = await ctx.session();
    await keepRun(ctx, s, 'dev.app', 'loud', 'test', '', [
      { kind: 'launch.until_ms', unit: 'ms', samples: [3_000], throughHost: true },
    ]);
    const r = await checkedOps(ctx).perf_compare!.handler({
      action: 'baseline',
      format: 'text',
      last: 1,
    });
    expect(r.blocks[0]).toMatchObject({
      text: expect.stringContaining('not added, high-host-load: measure loud again'),
    });
    expect(r.data.exitCode).toBe(1);
  });
});
