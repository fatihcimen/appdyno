import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startOf } from '@appdyno/core';
import { latestRuns, runKeys } from '@appdyno/perf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holder } from '../src/claims.js';
import { windowMeasures } from '../src/mirror/measures.js';
import { DEFAULT_POLICY, ServerContext } from '../src/index.js';
import { FakeDevice } from './fake-device.js';

const opened = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (real) => ({
  ...(await real<typeof import('node:child_process')>()),
  execFile: opened,
}));

describe('what a window measures', () => {
  let state: string;
  let measurements: string;

  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'appdyno-state-'));
    measurements = join(state, 'runs');
    process.env.APPDYNO_STATE_DIR = state;
  });
  afterEach(() => rmSync(state, { recursive: true, force: true }));

  const measuresOn = (device: FakeDevice) =>
    windowMeasures(
      new ServerContext(DEFAULT_POLICY, [], { measurements, perf: join(state, 'perf') }),
      device,
    );

  it('finds what it just measured among what was measured before', async () => {
    const device = new FakeDevice();
    const measures = measuresOn(device);
    await measures.launch('dev.app', () => undefined);
    expect((await measures.history('dev.app')).map((line) => line.title)).toEqual(['Cold launch']);
  });

  it("runs the tool an agent calls, on the window's own device, and keeps its run", async () => {
    const device = new FakeDevice();
    const open = vi.spyOn(device, 'open');
    const said: string[] = [];
    const words = await measuresOn(device).launch('dev.app', (line) => said.push(line));
    expect(open).toHaveBeenCalled();
    expect(words.title).toBe('Cold launch');
    expect(words.value).toMatch(/\d+ ms|not measured/);
    expect(words.why).toContain('dev.app');
    expect(words.why).toContain('compare only with its kind');
    const [key] = await runKeys(measurements, { app: 'dev.app' });
    expect(await latestRuns(measurements, key!, 1)).toHaveLength(1);
  });

  it('passes on what the tool found: that a measure ran is no verdict', async () => {
    const device = new FakeDevice();
    const framesDuring = device.measure.framesDuring.bind(device.measure);
    vi.spyOn(device, 'measure', 'get').mockReturnValue(
      Object.assign(Object.create(device.measure), {
        framesDuring: async (...a: Parameters<typeof framesDuring>) => {
          const m = await framesDuring(...a);
          return { ...m, value: { ...m.value, jankyPercent: 72.31, totalFrames: 500 } };
        },
      }),
    );
    const words = await measuresOn(device).scroll('dev.app', () => undefined);
    expect(words.value).toContain('72% jank');
    expect(words.flagged).toBe(true);
  });

  it('holds the device only while it runs, and leaves the window its device', async () => {
    const device = new FakeDevice();
    const close = vi.spyOn(device, 'close');
    let during: unknown;
    const open = device.open.bind(device);
    device.open = async () => {
      during = holder(device.serial);
      return open();
    };
    await measuresOn(device).launch('dev.app', () => undefined);
    expect(during).toMatchObject({ tool: 'appdyno window' });
    expect(holder(device.serial)).toBeUndefined();
    expect(close).not.toHaveBeenCalled();
  });

  it('is refused by name while something else holds the device', async () => {
    const device = new FakeDevice();
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    try {
      const claims = join(state, 'claims');
      mkdirSync(claims, { recursive: true });
      writeFileSync(
        join(claims, `${device.serial}.json`),
        JSON.stringify({
          pid: other.pid,
          started: startOf(other.pid!),
          tool: 'appdyno mcp',
          since: '2026-11-03T00:00:00Z',
        }),
      );
      await expect(measuresOn(device).scroll('dev.app', () => undefined)).rejects.toThrow(
        `held by pid ${other.pid} (appdyno mcp)`,
      );
    } finally {
      other.kill();
    }
  });

  it('opens the page of every kept run', async () => {
    await measuresOn(new FakeDevice()).dashboard();
    expect(opened.mock.calls[0]![0]).toBe('open');
    expect(String(opened.mock.calls[0]![1])).toContain('index.html');
  });
});
