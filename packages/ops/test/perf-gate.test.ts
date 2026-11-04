import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stateDir, type MeasureSource } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { leakSignal } from '../src/perf/scroll.js';
import { DEFAULT_POLICY, ServerContext } from '../src/index.js';
import { FakeDevice } from './fake-device.js';
import { checkedOps } from './helpers.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'appdyno-gate-'));

/** Launches of a set length, as a device's measure would answer them. */
function context(
  startup: { ms: number },
  measurements: string,
  perf: string,
  vitals: Record<string, unknown> = {},
) {
  const device = new FakeDevice();
  const m = device.measure;
  Object.defineProperty(device, 'measure', {
    value: {
      ...m,
      // a physical device: the host's load, whatever it is right now, does not make its numbers noisy
      virtual: false,
      buildType: async () => 'release',
      vitals: async () => ({ value: vitals, raw: '', at: new Date().toISOString() }),
      launch: async () => ({
        value: {
          mode: 'cold',
          samples: [0, 1, 2, 3, 4, 5].map((i) => ({ totalMs: startup.ms + i, state: 'COLD' })),
          medianMs: startup.ms,
        },
        raw: 'TotalTime',
        at: new Date().toISOString(),
      }),
    } satisfies MeasureSource,
  });
  const ctx = new ServerContext(
    DEFAULT_POLICY,
    [
      {
        list: async () => [{ serial: device.serial, state: 'device', ready: true }],
        handles: () => true,
        open: () => device,
      },
    ],
    { device: device.serial, app: 'dev.appdyno.fixture', measurements, perf },
  );
  return checkedOps(ctx);
}

const text = (r: { blocks: { type: string; text?: string }[] }) => r.blocks[0]!.text!;

describe('the gate', () => {
  it('measures, keeps a baseline, stays quiet on no change and fails on a regression', async () => {
    const dir = fresh();
    const project = fresh();
    const startup = { ms: 500 };
    const ops = context(startup, dir, project);
    await ops.perf_launch!.handler({ mode: 'cold', repeats: 5 });
    const b = await ops.perf_compare!.handler({ action: 'baseline', format: 'text', last: 1 });
    expect(text(b)).toMatch(/baselines\/dev\.appdyno\.fixture\/launch-cold\//);
    for (let i = 0; i < 2; i++)
      await ops.perf_compare!.handler({ action: 'baseline', format: 'text', last: 1 });

    await ops.perf_launch!.handler({ mode: 'cold', repeats: 5 });
    const same = await ops.perf_compare!.handler({ action: 'compare', format: 'text', last: 1 });
    expect(text(same)).toMatch(/^\s+ok\s+launch\.ttid_ms/m);
    expect(same.data.exitCode).toBe(0);

    startup.ms = 900;
    await ops.perf_launch!.handler({ mode: 'cold', repeats: 5 });
    const worse = await ops.perf_compare!.handler({ action: 'compare', format: 'text', last: 1 });
    expect(text(worse)).toMatch(/regression\s+launch\.ttid_ms: 902.5 ms against 502.5/);
    expect(worse.data.exitCode).toBe(1);
    const junit = await ops.perf_compare!.handler({ action: 'compare', format: 'junit', last: 1 });
    expect(text(junit)).toContain('<failure message="regression');
    const json = await ops.perf_compare!.handler({ action: 'compare', format: 'json', last: 1 });
    expect(JSON.parse(text(json)).failed).toBe(true);

    writeFileSync(
      join(project, 'budgets.json'),
      JSON.stringify([{ kind: 'launch.ttid_ms', max: 800 }]),
    );
    const budget = await ops.perf_compare!.handler({ action: 'budget', format: 'text', last: 1 });
    expect(text(budget)).toMatch(/over budget launch\.ttid_ms: 902.5 \(max 800\)/);
    expect(budget.data.exitCode).toBe(1);
  });

  it('adds no run measured with noise to a baseline', async () => {
    const project = fresh();
    const ops = context({ ms: 500 }, fresh(), project, { thermalStatus: 3 });
    await ops.perf_launch!.handler({ mode: 'cold', repeats: 5 });
    const r = await ops.perf_compare!.handler({ action: 'baseline', format: 'text', last: 1 });
    expect(text(r)).toMatch(/not added, hot-device: measure launch-cold again/);
    expect(r.data.exitCode).toBe(1);
    expect(existsSync(join(project, 'baselines'))).toBe(false);
  });

  it('says when there is nothing measured', async () => {
    const ops = context({ ms: 1 }, fresh(), fresh());
    await expect(
      ops.perf_compare!.handler({ action: 'compare', format: 'text', last: 1 }),
    ).rejects.toThrow(/no measured runs/);
  });

  it('keeps context with a run: the kind of device, the build, the source', async () => {
    const dir = fresh();
    const ops = context({ ms: 500 }, dir, fresh());
    await ops.perf_launch!.handler({ mode: 'cold', repeats: 5, scenario: 'first-open' });
    const json = await ops.perf_compare!.handler({
      action: 'compare',
      scenario: 'first-open',
      format: 'json',
      last: 1,
    });
    const [r] = JSON.parse(text(json)).reports;
    expect(r.scenario).toBe('first-open');
    expect(r.deviceClass).toMatch(/physical/);
    expect(r.comparisons[0].verdict).toBe('new');
  });
});

describe('perf_query', () => {
  it('reads only kept traces, and asks the driver that knows the file', async () => {
    const dir = fresh();
    const device = new FakeDevice();
    const asked: unknown[] = [];
    const ctx = new ServerContext(
      DEFAULT_POLICY,
      [
        {
          list: async () => [],
          handles: () => false,
          open: () => device,
          queryTrace: async () => undefined,
        },
        {
          list: async () => [],
          handles: () => false,
          open: () => device,
          queryTrace: async (tracePath, q) => {
            asked.push([tracePath, q]);
            return {
              tracePath,
              source: 'trace processor',
              columns: ['a'],
              rows: [['1']],
              dropped: 2,
            };
          },
        },
      ],
      { measurements: dir },
    );
    const ops = checkedOps(ctx);
    const refused = ops.perf_query!.handler({ trace: '/etc/passwd', sql: 'SELECT 1', limit: 5 });
    await expect(refused).rejects.toThrow(/not a kept trace/);
    const inside = join(stateDir(), 'traces', 'x.pftrace');
    const r = await ops.perf_query!.handler({ trace: inside, sql: 'SELECT 1', limit: 5 });
    expect(text(r)).toBe('a\n1\n(2 more rows left out)\nfrom: trace processor');
    expect(asked).toEqual([[inside, { sql: 'SELECT 1', limit: 5 }]]);
  });
});

describe('leak signal', () => {
  it('names objects that rise every round, not a flat or a single rise', () => {
    expect(leakSignal([{ activities: 1 }, { activities: 2 }, { activities: 3 }])).toEqual([
      'Activities rose every round (1 → 2 → 3): likely a leak',
    ]);
    expect(leakSignal([{ activities: 2 }, { activities: 2 }, { activities: 2 }])).toEqual([]);
    expect(leakSignal([{ activities: 1 }, { activities: 2 }, { activities: 2 }])).toEqual([]);
    expect(leakSignal([{}, {}])).toEqual([]);
  });
});
