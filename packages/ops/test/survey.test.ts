import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRefusals, MEASURES } from '@appdyno/perf';
import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, opsFor, ServerContext, survey } from '../src/index.js';
import { FakeDevice } from './fake-device.js';

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
        list: async () => [{ serial: device.serial, state: 'device' }],
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

describe('perf survey', () => {
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
    const o = opsFor(ctx)[name]!;
    return o.handler(o.input.parse(args) as Record<string, unknown>);
  };

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
