import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cannot, must } from '@appdyno/core';
import { latestRuns, loadRefusals, MEASURES, runKeys } from '@appdyno/perf';
import { DeviceError } from '@appdyno/protocol';
import { assert, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, ServerContext, survey } from '../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { checkedOps } from '@appdyno/testing/calls.js';

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
        list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
        handles: () => true,
        open: () => device,
      },
    ],
    { device: device.serial, app: 'dev.app', storage: { measurements, perf } },
  );
  return { ctx, measurements, perf };
}

const noEnergy = () =>
  Promise.reject(new DeviceError('UNSUPPORTED', 'batterystats is all zero here'));

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
    const { ctx, measurements } = context({ heap: cannot('a heap dump') });
    const lines: string[] = [];
    await survey(ctx, 'dev.app', (l) => lines.push(l));
    expect(lines.find((l) => l.startsWith('leaks'))).toContain('cannot be read');
    expect((await loadRefusals(measurements)).map((r) => r.measure)).toContain('leaks');
  });

  it('does not take a call that ran and kept no number for a device that cannot', async () => {
    const { ctx, measurements } = context({
      frames: () =>
        Promise.resolve({
          value: { totalFrames: 120, jankyFrames: 1, jankyPercent: 1, frozenFrames: 0 },
          raw: '',
          at: new Date().toISOString(),
        }),
      frameTrace: cannot('a frame trace'),
    });
    const lines: string[] = [];
    await survey(ctx, 'dev.app', (l) => lines.push(l));
    expect(lines.find((l) => l.startsWith('stalls'))).toContain('answered with no number to keep');
    expect((await loadRefusals(measurements)).map((r) => r.measure)).not.toContain('stalls');
  });

  it('says a device has no reading of what its driver lacks', async () => {
    const { ctx, measurements } = context({ network: cannot('network bytes') });
    const lines: string[] = [];
    await survey(ctx, 'dev.app', (l) => lines.push(l));
    expect(lines.find((l) => l.startsWith('network'))).toContain('gives no reading of this');
    expect((await loadRefusals(measurements)).map((r) => r.measure)).toContain('network');
  });

  it('does not take a failure for a device that cannot', async () => {
    const { ctx, measurements } = context({
      heap: () => Promise.reject(new DeviceError('TIMEOUT', 'no answer')),
    });
    const lines: string[] = [];
    await survey(ctx, 'dev.app', (l) => lines.push(l));
    expect(lines.find((l) => l.startsWith('leaks'))).toContain('failed: no answer');
    expect((await loadRefusals(measurements)).map((r) => r.measure)).not.toContain('leaks');
  });
});

describe('the page and the measures', () => {
  const op = (ctx: ServerContext, name: string, args: Record<string, unknown> = {}) => {
    const o = must(checkedOps(ctx)[name], name);
    return o.handler(o.input.parse(args));
  };
  const says = (why: string) => () => Promise.reject(new DeviceError('UNSUPPORTED', why));
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
      ['perf_snapshot', { also: ['anonMemory'] }, 'memory', { anonMemory: says('no anon') }],
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
      heap: () =>
        Promise.resolve({
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
    const other = context({ hangs: cannot('hangs') });
    await op(other.ctx, 'perf_trace', { what: 'hangs' }).catch(() => undefined);
    expect(await kept(other.measurements)).toEqual({});
    // a part of a row is not the row
    const part = context({ threads: says('no threads') });
    const { data } = await op(part.ctx, 'perf_snapshot', { also: ['threads'] });
    expect(data.lacking).toEqual(['threads']);
    expect(await kept(part.measurements)).toEqual({});
    // what a device has no way of reading is left out, and no row takes it
    const absent = context();
    const left = await op(absent.ctx, 'perf_snapshot', {
      also: ['anonMemory', 'startInfo', 'battery'],
    });
    expect(left.data.lacking).toEqual(['anonMemory', 'startInfo', 'battery']);
    await op(absent.ctx, 'perf_scroll', { probe: true }).catch(() => undefined);
    expect(await kept(absent.measurements)).toEqual({});
  });

  it('keeps a start why by its phases, and a measure in the unit it has', async () => {
    const { ctx, measurements } = context({
      launch: () =>
        Promise.resolve({
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
      energy: () =>
        Promise.resolve({
          value: { mj: 12, modelled: true, note: 'A model, not a reading' },
          raw: '',
          at: new Date().toISOString(),
        }),
    });
    await op(ctx, 'perf_launch', { trace: true });
    const { data, blocks } = await op(ctx, 'perf_snapshot', { also: ['energy'] });
    expect(data).toMatchObject({ energyMj: 12, energyModelled: true });
    expect(blocks[0]).toMatchObject({
      text: expect.stringContaining('energy (a model): 12 mJ') as unknown,
    });
    const keys = await runKeys(measurements, { app: 'dev.app' });
    const kinds = (await Promise.all(keys.map((k) => latestRuns(measurements, k, 1))))
      .flat(2)
      .map((r) => [r.kind, r.modelled === true]);
    expect(kinds).toContainEqual(['launch.phase.main_ms', false]);
    expect(kinds).toContainEqual(['launch.phase.first_frame_ms', false]);
    expect(kinds).toContainEqual(['energy.mj', true]);
  });

  it('says of a CPU read with another app in front that it is none, and keeps the memory', async () => {
    const at = '2026-11-03T00:00:00.000Z';
    const behind = 'com.apple.springboard';
    const { ctx, measurements } = context({
      cpu: () =>
        Promise.resolve({ value: { percent: 0, windowMs: 1_200, behind }, raw: 'raw cpu', at }),
    });
    const { data, blocks } = await op(ctx, 'perf_snapshot', {});
    expect(data).toMatchObject({ cpuBehind: behind });
    expect((blocks[0] as { text: string }).text).toMatch(
      /CPU: .*com\.apple\.springboard.*not kept/,
    );
    const [key] = await runKeys(measurements, { app: 'dev.app' });
    assert(key);
    const [run] = await latestRuns(measurements, key, 1);
    const kinds = must(run, 'the newest run').map((r) => r.kind);
    expect(kinds).toContain('memory.kb');
    expect(kinds).not.toContain('cpu.percent');
  });

  it('answers what `also` asks in one order, whatever order it was asked in', async () => {
    const at = '2026-11-03T00:00:00.000Z';
    const reading = (value: unknown, raw: string) => () => Promise.resolve({ value, raw, at });
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
      exits: reading(
        {
          run: { crashes: 1, anrs: 2, total: 3 },
          held: { crashes: 4, anrs: 2, total: 9 },
          recent: [],
        },
        'raw exits',
      ),
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
      'exits since the last run: 1 crashes of 3; 2 ANRs filed',
      'the system holds 4 crashes of 9; 2 ANRs filed, of any age: no reading of this run',
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
    assert(key);
    const [run] = await latestRuns(measurements, key, 1);
    expect(run?.map((r) => r.kind)).toEqual([
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
    const stored = JSON.parse(
      readFileSync(String(data.raw).replace(/\.txt$/, '.json'), 'utf8'),
    ) as unknown;
    expect(JSON.stringify(stored)).toMatch(/"threads":.*"network":.*"energy":.*"exits":.*"size":/);
  });

  describe('what a run keeps of how the app ended', () => {
    /** A device that keeps what it was asked from, and holds the same stock whatever it is asked. */
    const held = { crashes: 3, anrs: 1, userAnrs: 1, total: 6 };
    const device = (run: { crashes: number; anrs: number; userAnrs: number; total: number }) => {
      const asked: (number | undefined)[] = [];
      const exits = (_app: string, since?: number) => {
        asked.push(since);
        return Promise.resolve({
          value: { held, recent: [], ...(since !== undefined && { run }) },
          raw: 'raw exits',
          at: new Date().toISOString(),
        });
      };
      return { asked, ...context({ exits }) };
    };
    const quiet = { crashes: 0, anrs: 0, userAnrs: 0, total: 0 };

    it('keeps nothing of a stock with no run to count from, and says it as one', async () => {
      const { ctx, measurements } = device(quiet);
      const { data, blocks } = await op(ctx, 'perf_snapshot', { also: ['exits'] });
      const text = (blocks[0] as { text: string }).text;
      expect(text).toContain('exits: no earlier run to count from, so this one keeps none');
      expect(text).toContain('the system holds 3 crashes of 6; 1 ANRs filed, of any age');
      // a stock makes no claim of this session
      expect(text).not.toContain('user-perceived ANR');
      expect(data).toMatchObject({ exitsHeld: held });
      expect(data).not.toHaveProperty('crashes');
      expect(data).not.toHaveProperty('userAnrs');
      const [key] = await runKeys(measurements, { app: 'dev.app' });
      assert(key);
      const [run] = await latestRuns(measurements, key, 1);
      expect(run?.filter((r) => r.kind.startsWith('exits.'))).toEqual([]);
    });

    it('counts from the key’s last run, and only what is newer says this session counts', async () => {
      const { ctx, measurements, asked } = device({ ...quiet, crashes: 1, anrs: 1, userAnrs: 1 });
      await op(ctx, 'perf_snapshot', { also: ['exits'] });
      const [key] = await runKeys(measurements, { app: 'dev.app' });
      assert(key);
      const [first] = await latestRuns(measurements, key, 1);
      const { data, blocks } = await op(ctx, 'perf_snapshot', { also: ['exits'] });
      expect(asked).toEqual([undefined, Date.parse(must(first?.[0], 'a record').at)]);
      expect((blocks[0] as { text: string }).text).toContain(
        'this session would count as a user-perceived ANR',
      );
      expect(data).toMatchObject({ crashes: 1, anrs: 1, userAnrs: 1 });
      const [second] = await latestRuns(measurements, key, 1);
      expect(second?.find((r) => r.kind === 'exits.user_anrs')?.value).toBe(1);
    });

    it('says a quiet run is one, whatever the system still holds', async () => {
      const { ctx } = device(quiet);
      await op(ctx, 'perf_snapshot', { also: ['exits'] });
      const { blocks } = await op(ctx, 'perf_snapshot', { also: ['exits'] });
      expect((blocks[0] as { text: string }).text).toContain(
        'this session would not count as a user-perceived ANR',
      );
    });

    it('goes by the runs of its own scenario', async () => {
      const { ctx, asked } = device(quiet);
      await op(ctx, 'perf_snapshot', { also: ['exits'], scenario: 'a' });
      await op(ctx, 'perf_snapshot', { also: ['exits'], scenario: 'b' });
      expect(asked).toEqual([undefined, undefined]);
    });
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
