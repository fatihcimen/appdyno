import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateDir } from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, keepRun, ServerContext } from '../src/index.js';
import { FakeDevice } from './fake-device.js';
import { callerOf } from './helpers.js';

const DAY = 86_400_000;

/** A trace of this state folder, 9 days old: past its grace, and named by nothing. */
function oldTrace() {
  const dir = join(stateDir(), 'traces');
  mkdirSync(dir, { recursive: true });
  const trace = join(dir, 'old.pftrace');
  writeFileSync(trace, Buffer.alloc(1024));
  const at = new Date(Date.now() - 9 * DAY);
  utimesSync(trace, at, at);
  return trace;
}

const context = (o: { measurements?: string; traceLimitGb: number; autoPrune?: boolean }) => {
  const device = new FakeDevice();
  return new ServerContext(
    DEFAULT_POLICY,
    [
      {
        list: async () => [{ serial: device.serial, state: 'device', ready: true }],
        handles: () => true,
        open: () => device,
      },
    ],
    { device: device.serial, app: 'dev.app', perf: mkdtempSync(join(tmpdir(), 'p-')), ...o },
  );
};

const kept = async (ctx: ServerContext) =>
  keepRun(ctx, await ctx.session(), {
    app: 'dev.app',
    scenario: 's',
    source: 't',
    raw: '',
    metrics: [{ kind: 'memory.kb', unit: 'kb', samples: [1] }],
  });

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-prune-ops-')));
});
afterEach(() => vi.unstubAllEnvs());

describe('a kept run and the traces of a state folder', () => {
  it('prunes by itself only where the entry point asked', async () => {
    const trace = oldTrace();
    const ctx = context({ traceLimitGb: 0 });
    await kept(ctx);
    expect(existsSync(trace)).toBe(true);
    expect(existsSync(join(stateDir(), 'traces-pruned'))).toBe(false);
  });

  it('asked, prunes at most once an hour', async () => {
    const trace = oldTrace();
    const ctx = context({ traceLimitGb: 0, autoPrune: true });
    await kept(ctx);
    expect(existsSync(trace)).toBe(false);
    const again = oldTrace();
    await kept(ctx);
    expect(existsSync(again)).toBe(true);
  });

  it('does not fail a number that was kept, whatever the prune finds', async () => {
    mkdirSync(join(stateDir(), 'traces'), { recursive: true });
    writeFileSync(join(stateDir(), 'traces-pinned.json'), 'not json');
    const trace = oldTrace();
    const ctx = context({ traceLimitGb: 0, autoPrune: true });
    await expect(kept(ctx)).resolves.toBeInstanceOf(Array);
    expect(existsSync(trace)).toBe(true);
  });
});

describe('perf_compare prune', () => {
  it('refuses a context whose runs are in another folder, by name', async () => {
    const trace = oldTrace();
    const ctx = context({ measurements: mkdtempSync(join(tmpdir(), 'm-')), traceLimitGb: 0 });
    await expect(callerOf(ctx)('perf_compare', { action: 'prune' })).rejects.toThrow(
      /goes by one folder's runs/,
    );
    expect(existsSync(trace)).toBe(true);
  });

  it('removes nothing with no kept run to go by, and says why', async () => {
    const trace = oldTrace();
    const r = await callerOf(context({ traceLimitGb: 0 }))('perf_compare', { action: 'prune' });
    expect(r.text).toContain('nothing was removed: no kept runs');
    expect(r.data.prune).toMatchObject({ removed: 0, over: true });
    expect(existsSync(trace)).toBe(true);
  });

  it('says the limit; a dry run lists what the real one removes, which goes in its log', async () => {
    const trace = oldTrace();
    const ctx = context({ traceLimitGb: 7 });
    await kept(ctx);
    const call = callerOf(ctx);
    const stated = await call('perf_compare', { action: 'prune', dryRun: true });
    expect(stated.text).toContain('of a limit of 7.00 GB');
    const dry = await call('perf_compare', { action: 'prune', dryRun: true, limitGb: 0 });
    expect(dry.text).toContain('would remove: old.pftrace (1024 bytes)');
    expect(existsSync(trace)).toBe(true);
    const real = await call('perf_compare', { action: 'prune', limitGb: 0 });
    expect(real.text).toContain('removed: old.pftrace (1024 bytes)');
    expect(real.text).toContain('traces-pruned.log');
    expect(existsSync(trace)).toBe(false);
  });

  it('a baseline pins what it took, for any project that asks later', async () => {
    const dir = join(stateDir(), 'measurements');
    mkdirSync(dir, { recursive: true });
    const raw = join(dir, 'pm-11112222.txt');
    const trace = oldTrace();
    writeFileSync(raw, trace);
    writeFileSync(raw.replace('.txt', '.json'), '{}');
    const ctx = context({ traceLimitGb: 0 });
    await keepRun(ctx, await ctx.session(), {
      app: 'dev.app',
      scenario: 's',
      source: 't',
      raw,
      metrics: [{ kind: 'memory.kb', unit: 'kb', samples: [1] }],
    });
    await callerOf(ctx)('perf_compare', { action: 'baseline' });
    // another project, which has no such baseline
    const other = context({ traceLimitGb: 0 });
    const r = await callerOf(other)('perf_compare', { action: 'prune' });
    expect(r.data.prune).toMatchObject({ removed: 0 });
    expect(existsSync(trace)).toBe(true);
  });
});
