import { cannot } from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IosSimulatorPerf } from '../src/perf.js';
import { IosPhoneDevice } from '../src/phone.js';
import { Simctl } from '../src/simctl.js';

const APP = 'dev.appdyno.fixture';

/** What either kind of device says of a launch that showed nothing. */
const NO_SCREEN = {
  code: 'TIMEOUT',
  message: `${APP} showed no screen within 20 s`,
  hint: expect.stringMatching(/read the screen/),
};

/** A clock that jumps: a screen's 20 s go by in no time. */
const clockOf = (stepMs: number) => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (now += stepMs));
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a launch on a simulator', () => {
  const simulator = (shown: () => Promise<boolean>) => {
    const did: string[] = [];
    const simctl = {
      terminate: async () => void did.push('stop'),
      launch: async () => {
        did.push('launch');
        return `${APP}: 4242`;
      },
      exec: async (words: string[]) => {
        did.push(words.join(' '));
        return '';
      },
    };
    const perf = new IosSimulatorPerf(
      'U',
      simctl as unknown as Simctl,
      shown,
      cannot("XCTest's metrics"),
    );
    return { did, perf };
  };

  it('warms up once, then keeps the lower middle of what it times', async () => {
    clockOf(10);
    const { did, perf } = simulator(async () => true);
    const { value, raw } = await perf.launch(APP, { mode: 'cold', repeats: 2 });
    expect(did).toEqual(['stop', 'launch', 'stop', 'launch', 'stop', 'launch']);
    expect(value.samples).toHaveLength(2);
    expect(value.medianMs).toBe(value.samples[0]!.totalMs);
    expect(value.until).toBe('the first screen is read');
    expect(raw.split('\n')).toHaveLength(3);
  }, 10_000);

  it('puts another app in front for a warm launch', async () => {
    clockOf(10);
    const { did, perf } = simulator(async () => true);
    await perf.launch(APP, { mode: 'warm', repeats: 1 });
    expect(did).toEqual([
      'launch U com.apple.Preferences',
      'launch',
      'launch U com.apple.Preferences',
      'launch',
    ]);
  }, 10_000);

  it('refuses a screen that never comes', async () => {
    clockOf(25_000);
    const { perf } = simulator(async () => false);
    await expect(perf.launch(APP, { mode: 'cold', repeats: 1 })).rejects.toMatchObject(NO_SCREEN);
  }, 10_000);

  it('looks once even when the launch itself took longer than the wait', async () => {
    clockOf(25_000);
    const seen = vi.fn(async () => true);
    const { perf } = simulator(seen);
    await expect(perf.launch(APP, { mode: 'cold', repeats: 1 })).resolves.toBeDefined();
    expect(seen).toHaveBeenCalled();
  }, 10_000);
});

describe('a launch on a phone', () => {
  /** Enough nodes of the app in its window to count as a screen. */
  const screen = (pkg: string) =>
    ({
      windows: [{ pkg }],
      nodes: [{ w: 0 }, { w: 0 }, { w: 0 }, { w: 0 }],
    }) as unknown as Tree;

  const phone = (read: () => Promise<Tree>) => {
    const did: string[] = [];
    const device = new IosPhoneDevice('00001234-0123456789ABCDEF', { profile: '/p' });
    Object.assign(device, {
      terminate: async () => void did.push('stop'),
      launch: async () => void did.push('launch'),
      target: async () => void did.push('target'),
      tree: read,
      ctl: {
        launch: async (app: string, _url?: string, env?: object) =>
          void did.push(env ? `env ${app}` : `front ${app}`),
      },
    });
    return { did, perf: device.measure };
  };

  it('warms up once, and stops looking once the screen shows', async () => {
    clockOf(10);
    const { did, perf } = phone(async () => screen(APP));
    const { value, raw } = await perf.launch(APP, { mode: 'cold', repeats: 2 });
    expect(did.filter((d) => d === 'launch')).toHaveLength(3);
    expect(value.samples).toHaveLength(2);
    expect(value.medianMs).toBe(value.samples[0]!.totalMs);
    expect(value.until).toBe('the first screen is read');
    expect(raw.split(' ')).toHaveLength(2);
  }, 10_000);

  it('puts Settings in front for a warm launch', async () => {
    clockOf(10);
    const { did, perf } = phone(async () => screen(APP));
    await perf.launch(APP, { mode: 'warm', repeats: 1 });
    expect(did.filter((d) => d !== 'target')).toEqual([
      'front com.apple.Preferences',
      'launch',
      'front com.apple.Preferences',
      'launch',
    ]);
  }, 10_000);

  it('launches by itself with an environment, naming the app', async () => {
    clockOf(10);
    const { did, perf } = phone(async () => screen(APP));
    await perf.launch(APP, { mode: 'cold', repeats: 1, env: { A: '1' } });
    expect(did.slice(0, 3)).toEqual(['stop', `env ${APP}`, 'target']);
  }, 10_000);

  it('refuses a screen that never comes: a launch that showed none is no measurement', async () => {
    clockOf(5_000);
    const { perf } = phone(async () => screen('another.app'));
    await expect(perf.launch(APP, { mode: 'cold', repeats: 1 })).rejects.toMatchObject(NO_SCREEN);
  }, 10_000);
});

describe('a runner reached', () => {
  const reached = (started: boolean, targetApp?: string) => {
    const asked: string[] = [];
    const rpc = {
      closed: false,
      call: async (method: string) => {
        asked.push(method);
        return { result: {} };
      },
      close: () => undefined,
    };
    const hello = { model: 'iPhone' };
    const device = new IosPhoneDevice('00001234-0123456789ABCDEF', { profile: '/p' });
    Object.assign(device, {
      targetApp,
      launcher: { connect: async () => ({ rpc, hello, started }) },
    });
    return { asked, device, hello };
  };

  it('is told the app it reads, before anything is asked of it', async () => {
    const { asked, device, hello } = reached(true, APP);
    expect(await device.open()).toBe(hello);
    expect(asked).toEqual(['app.target']);
    expect(device.lastStartWasCold).toBe(true);
  });

  it('is told nothing with no app named', async () => {
    const { asked, device } = reached(false);
    await device.open();
    expect(asked).toEqual([]);
    expect(device.lastStartWasCold).toBe(false);
  });
});

describe('an app on a simulator', () => {
  it('is the process that runs, past one just ended that stays listed', async () => {
    const list = [
      `-\t0\tUIKitApplication:${APP}[ab12][rb-legacy]`,
      `4242\t0\tUIKitApplication:${APP}[cd34][rb-legacy]`,
    ].join('\n');
    const simctl = Object.assign(new Simctl(), { exec: async () => list });
    const perf = new IosSimulatorPerf('U', simctl, async () => true, cannot("XCTest's metrics"));
    await expect(perf.pid(APP)).resolves.toBe(4242);
  });
});
