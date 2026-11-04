import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { latestRuns, loadRefusals, MEASURES, runKeys } from '@appdyno/perf';
import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, ServerContext, survey } from '../src/index.js';
import { FakeDevice } from './fake-device.js';
import { checkedOps } from './helpers.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'appdyno-survey-'));

function context(measures: Record<string, unknown> = {}) {
  const device = new FakeDevice();
  const m = device.measure;
  Object.defineProperty(device, 'measure', { value: { ...m, ...measures } });
  const measurements = fresh();
  const perf = fresh();
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
  return { ctx, measurements, perf };
}

const noEnergy = async () => {
  throw new DeviceError('UNSUPPORTED', 'batterystats is all zero here');
};

// a scroll waits for real, on whatever else the Mac is doing
describe('perf survey', { timeout: 60_000 }, () => {
  it('prints a line per measure, goes on after a refusal, and writes the page', async () => {
    const { ctx, measurements } = context({ energy: noEnergy });
    const lines: string[] = [];
    const { read, file } = await survey(ctx, 'dev.app', (l) => lines.push(l));
    expect(read).toBeGreaterThan(0);
    for (const row of MEASURES)
      expect(lines.filter((l) => l.split(' ')[0] === row).length, row).toBe(1);
    expect(lines.find((l) => l.startsWith('energy'))).toContain(
      'cannot be read: batterystats is all zero here',
    );
    expect(lines.find((l) => l.startsWith('memory'))).toMatch(/MB|KB/);
    expect(lines.at(-1)).toBe(`dashboard: ${file}`);
    expect(file).toBe(join(measurements, 'dashboard', 'index.html'));
    expect(readFileSync(file, 'utf8')).toContain('batterystats is all zero here');
    expect((await loadRefusals(measurements)).map((r) => r.measure)).toContain('energy');
  });

  it('keeps a refusal the whole operation gave', async () => {
    const { ctx, measurements } = context({ heap: undefined });
    const lines: string[] = [];
    await survey(ctx, 'dev.app', (l) => lines.push(l));
    expect(lines.find((l) => l.startsWith('leaks'))).toContain('cannot be read');
    expect((await loadRefusals(measurements)).map((r) => r.measure)).toContain('leaks');
  });

  it('does not take a call that ran and kept no number for a device that cannot', async () => {
    const { ctx, measurements } = context({
      frames: async () => ({
        value: { totalFrames: 120, jankyFrames: 1, jankyPercent: 1, frozenFrames: 0 },
        raw: '',
        at: new Date().toISOString(),
      }),
      frameTrace: undefined,
    });
    const lines: string[] = [];
    await survey(ctx, 'dev.app', (l) => lines.push(l));
    expect(lines.find((l) => l.startsWith('stalls'))).toContain('answered with no number to keep');
    expect((await loadRefusals(measurements)).map((r) => r.measure)).not.toContain('stalls');
  });

  it('says a device has no reading of what its driver lacks', async () => {
    const { ctx, measurements } = context({ network: undefined });
    const lines: string[] = [];
    await survey(ctx, 'dev.app', (l) => lines.push(l));
    expect(lines.find((l) => l.startsWith('network'))).toContain('gives no reading of this');
    expect((await loadRefusals(measurements)).map((r) => r.measure)).toContain('network');
  });

  it('does not take a failure for a device that cannot', async () => {
    const { ctx, measurements } = context({
      heap: async () => {
        throw new DeviceError('TIMEOUT', 'no answer');
      },
    });
    const lines: string[] = [];
    await survey(ctx, 'dev.app', (l) => lines.push(l));
    expect(lines.find((l) => l.startsWith('leaks'))).toContain('failed: no answer');
    expect((await loadRefusals(measurements)).map((r) => r.measure)).not.toContain('leaks');
  });
});

describe('the page and the measures', () => {
  const op = (ctx: ServerContext, name: string, args: Record<string, unknown> = {}) => {
    const o = checkedOps(ctx)[name]!;
    return o.handler(o.input.parse(args) as Record<string, unknown>);
  };
  const says = (why: string) => async () => {
    throw new DeviceError('UNSUPPORTED', why);
  };
  const kept = async (measurements: string) =>
    Object.fromEntries((await loadRefusals(measurements)).map((r) => [r.measure, r.reason]));

  it('keeps the refusal of every measure, under its row', async () => {
    for (const [name, args, row, measure] of [
      ['perf_launch', {}, 'launch', { launch: says('no launch') }],
      ['perf_launch', { trace: true }, 'launch-why', { launch: says('needs get-task-allow') }],
      ['perf_scroll', {}, 'frames', { frames: says('no frames') }],
      ['perf_trace', {}, 'frames', { frameTrace: says('no trace') }],
      ['perf_trace', { what: 'hangs' }, 'stalls', { hangs: says('no hangs') }],
      ['perf_heap', {}, 'leaks', { heap: says('needs get-task-allow') }],
      ['perf_snapshot', {}, 'cpu', { cpu: says('no cpu') }],
      ['perf_snapshot', {}, 'memory', { memory: says('no memory') }],
      ['perf_snapshot', { also: ['network'] }, 'network', { network: says('no bytes') }],
      ['perf_snapshot', { also: ['energy'] }, 'energy', { energy: says('no energy') }],
      ['perf_snapshot', { also: ['battery'] }, 'battery', { battery: says('no signals') }],
      ['perf_snapshot', { also: ['exits'] }, 'crashes', { exits: says('no exits') }],
      ['perf_snapshot', { also: ['size'] }, 'size', { size: says('no size') }],
    ] as const) {
      const { ctx, measurements } = context(measure);
      await op(ctx, name, args).catch(() => undefined);
      expect(Object.keys(await kept(measurements)), `${name} ${row}`).toEqual([row]);
    }
  });

  it('a heap dump with no count of leaks says so in the row', async () => {
    const { ctx, measurements } = context({
      heap: async () => ({
        value: { file: '/h.hprof', bytes: 1, kind: 'hprof' },
        raw: '',
        at: new Date().toISOString(),
      }),
    });
    await op(ctx, 'perf_heap');
    expect((await kept(measurements)).leaks).toMatch(/no count of leaks/);
    const lines: string[] = [];
    await survey(ctx, 'dev.app', (l) => lines.push(l));
    expect(lines.find((l) => l.startsWith('leaks'))).toContain('cannot be read: a heap dump');
  }, 60_000);

  it('takes no refusal for what the caller turned off, or a way the device has another of', async () => {
    const off = context({ frames: says('runs without the probe') });
    await op(off.ctx, 'perf_scroll', { probe: false }).catch(() => undefined);
    expect(await kept(off.measurements)).toEqual({});
    // a device with no such way, with another: it reads stalls by a frame trace
    const other = context({ hangs: undefined });
    await op(other.ctx, 'perf_trace', { what: 'hangs' }).catch(() => undefined);
    expect(await kept(other.measurements)).toEqual({});
    // a part of a row is not the row
    const part = context({ threads: says('no threads') });
    const { data } = await op(part.ctx, 'perf_snapshot', { also: ['threads'] });
    expect(data.lacking).toEqual(['threads']);
    expect(await kept(part.measurements)).toEqual({});
  });

  it('keeps a start why by its phases, and a measure in the unit it has', async () => {
    const { ctx, measurements } = context({
      launch: async () => ({
        value: {
          mode: 'cold',
          samples: [{ totalMs: 300 }],
          medianMs: 300,
          until: 'the first screen is read',
          startup: {
            tracePath: '/t',
            reasons: [],
            findings: [],
            breakdown: [
              { reason: 'main', ms: 500 },
              { reason: 'first frame', ms: 20 },
            ],
          },
        },
        raw: '',
        at: new Date().toISOString(),
      }),
      energy: async () => ({
        value: { mj: 12, modelled: true, note: 'A model, not a reading' },
        raw: '',
        at: new Date().toISOString(),
      }),
    });
    await op(ctx, 'perf_launch', { trace: true });
    const { data, blocks } = await op(ctx, 'perf_snapshot', { also: ['energy'] });
    expect(data).toMatchObject({ energyMj: 12, energyModelled: true });
    expect(blocks[0]).toMatchObject({ text: expect.stringContaining('energy (a model): 12 mJ') });
    const keys = await runKeys(measurements, { app: 'dev.app' });
    const kinds = (await Promise.all(keys.map((k) => latestRuns(measurements, k, 1))))
      .flat(2)
      .map((r) => [r.kind, r.modelled === true]);
    expect(kinds).toContainEqual(['launch.phase.main_ms', false]);
    expect(kinds).toContainEqual(['launch.phase.first_frame_ms', false]);
    expect(kinds).toContainEqual(['energy.mj', true]);
  });

  it('answers what `also` asks in one order, whatever order it was asked in', async () => {
    const at = '2026-11-03T00:00:00.000Z';
    const reading = (value: unknown, raw: string) => async () => ({ value, raw, at });
    const { ctx, measurements } = context({
      threads: reading(
        {
          windowMs: 2000,
          reads: 2,
          threads: [{ tid: 1, name: 'main', percent: 50, over90Ms: 10 }],
          worstOver90Ms: 10,
        },
        'raw threads',
      ),
      network: reading({ windowMs: 2000, rxBytes: 3, txBytes: 4, note: 'loopback' }, 'raw network'),
      energy: reading({ mah: 5, note: 'a formula' }, 'raw energy'),
      exits: reading({ crashes: 1, anrs: 2, total: 3, recent: [] }, 'raw exits'),
      size: reading({ bytes: 1_048_576, parts: {} }, 'raw size'),
    });
    const { data, blocks } = await op(ctx, 'perf_snapshot', {
      also: ['size', 'exits', 'energy', 'network', 'threads'],
    });
    // whether this Mac is loaded right now is no part of it
    const text = (blocks[0] as { text: string }).text
      .split('\n')
      .filter((l) => !l.startsWith('noise:'));
    expect(
      text.slice(
        text.findIndex((l) => l.startsWith('threads')),
        -1,
      ),
    ).toEqual([
      'threads: main 50% (10 ms above 90 %)',
      'network: 3 bytes in, 4 out (loopback)',
      'energy: 5 mAh; a formula',
      'exits: 1 crashes, 2 ANRs of 3',
      'size: 1.0 MB',
    ]);
    expect(data).toMatchObject({
      threads: [{ tid: 1, name: 'main', percent: 50, over90Ms: 10 }],
      rxBytes: 3,
      txBytes: 4,
      energyMah: 5,
      energyModelled: false,
      crashes: 1,
      anrs: 2,
      sizeBytes: 1_048_576,
    });
    expect(data).not.toHaveProperty('lacking');
    const [key] = await runKeys(measurements, { app: 'dev.app' });
    const [run] = await latestRuns(measurements, key!, 1);
    expect(run!.map((r) => r.kind)).toEqual([
      'cpu.percent',
      'memory.kb',
      'threads.over90_ms',
      'network.rx_bytes',
      'network.tx_bytes',
      'energy.mah',
      'exits.crashes',
      'exits.anrs',
      'size.bytes',
    ]);
    // what it read is kept, and its value under its name
    const raw = readFileSync(String(data.raw), 'utf8');
    for (const part of ['threads', 'network', 'energy', 'exits', 'size'])
      expect(raw).toContain(`raw ${part}`);
    const stored = JSON.parse(readFileSync(String(data.raw).replace(/\.txt$/, '.json'), 'utf8'));
    expect(JSON.stringify(stored)).toMatch(/"threads":.*"network":.*"energy":.*"exits":.*"size":/);
  });

  it('is rewritten after each kept run', async () => {
    const { ctx, measurements } = context();
    await op(ctx, 'perf_snapshot');
    const file = join(measurements, 'dashboard', 'index.html');
    expect(readFileSync(file, 'utf8')).toContain('memory.kb');
  });

  it('never fails a measurement', async () => {
    const { ctx, measurements } = context();
    writeFileSync(join(measurements, 'dashboard'), 'a file where the folder goes');
    const { data } = await op(ctx, 'perf_snapshot');
    expect(data.id).toBeTruthy();
  });

  it('comes from perf_compare on an empty store, with the command that fills it', async () => {
    const { ctx, measurements } = context();
    const { data, blocks } = await op(ctx, 'perf_compare', { action: 'dashboard' });
    const file = join(measurements, 'dashboard', 'index.html');
    expect(data).toMatchObject({ failed: false, exitCode: 0, file });
    expect(blocks[0]).toMatchObject({ text: `dashboard: ${file}` });
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('appdyno perf survey');
  });
});
