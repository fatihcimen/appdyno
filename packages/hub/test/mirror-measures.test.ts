import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, startOf } from '@appdyno/core';
import { latestRuns, runKeys } from '@appdyno/perf';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { windowMeasures } from '../src/measures.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { DEFAULT_POLICY, holder, ServerContext } from '@appdyno/ops';
import { fakeTimed } from '@appdyno/testing/fake-time.js';

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
      new ServerContext(DEFAULT_POLICY, [], {
        storage: { measurements, perf: join(state, 'perf') },
      }),
      device,
    );

  it('finds what it just measured among what was measured before', async () => {
    const device = new FakeDevice();
    const measures = measuresOn(device);
    await measures.launch('dev.app', () => undefined);
    expect((await measures.history('dev.app')).map((line) => line.title)).toEqual(['Cold launch']);
  });

  it('measures a device the allow list let in by another of its names, as its window was', async () => {
    const device = new FakeDevice();
    const ctx = new ServerContext({ ...DEFAULT_POLICY, devices: /^Pixel_8$/ }, [], {
      storage: { measurements, perf: join(state, 'perf') },
    });
    ctx.allowAs(device.serial);
    const words = await windowMeasures(ctx, device).launch('dev.app', () => undefined);
    expect(words.title).toBe('Cold launch');
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
    assert(key);
    expect(await latestRuns(measurements, key, 1)).toHaveLength(1);
  });

  it('passes on what the tool found: that a measure ran is no verdict', async () => {
    const device = new FakeDevice();
    const framesDuring = device.measure.framesDuring.bind(device.measure);
    vi.spyOn(device, 'measure', 'get').mockReturnValue(
      Object.assign(Object.create(device.measure) as typeof device.measure, {
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

  it(
    'says of a list that stopped moving how many of the rounds asked for it ran',
    fakeTimed(async () => {
      const device = new FakeDevice();
      // a screen that does not scroll: the first round is counted as it is, and no other moves it
      device.listEnd = 0;
      const said: string[] = [];
      const words = await measuresOn(device).scroll('dev.app', (line) => said.push(line));
      expect(said).toContain('scroll round 2 of 3');
      expect(words.detail).toMatch(/^1 of 3 rounds/);
      const full = await measuresOn(new FakeDevice()).scroll('dev.app', () => undefined);
      expect(full.detail).toMatch(/^3 rounds/);
    }),
  );

  it(
    'says a journey with no whole as not measured, for a person to look at',
    fakeTimed(async () => {
      const device = new FakeDevice();
      device.settles = false;
      const file = join(state, 'moving.flow');
      writeFileSync(file, 'launch\ntap text="Form"\n');
      const { ran, said } = await measuresOn(device).journey(file, 'dev.app', () => undefined);
      expect(ran.totalMs).toBeUndefined();
      expect(said).toMatchObject({ value: 'not measured', flagged: true });
    }),
  );

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
    const pid = must(other.pid, "the other's pid");
    try {
      const claims = join(state, 'claims');
      mkdirSync(claims, { recursive: true });
      writeFileSync(
        join(claims, `${device.serial}.json`),
        JSON.stringify({
          pid,
          started: startOf(pid),
          tool: 'appdyno mcp',
          since: '2026-11-03T00:00:00Z',
        }),
      );
      await expect(measuresOn(device).scroll('dev.app', () => undefined)).rejects.toThrow(
        `held by pid ${pid} (appdyno mcp)`,
      );
    } finally {
      other.kill();
    }
  });

  it('opens the page of every kept run', async () => {
    await measuresOn(new FakeDevice()).dashboard();
    expect(opened.mock.calls[0]?.[0]).toBe('open');
    expect(String(opened.mock.calls[0]?.[1])).toContain('index.html');
  });
});
