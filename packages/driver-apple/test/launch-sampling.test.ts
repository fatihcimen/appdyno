import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Cannot, cannot, deviceStateFile, stateDir, thisOwner } from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IosSimulatorPerf } from '../src/perf.js';
import { IosPhoneDevice } from '../src/phone.js';
import { IosPhonePerf } from '../src/phone-perf.js';
import { Simctl } from '../src/simctl.js';

const APP = 'dev.appdyno.fixture';

/** What either kind of device says of a launch that showed nothing. */
const NO_SCREEN = {
  code: 'TIMEOUT',
  message: `${APP} showed no screen within 20 s`,
  hint: expect.stringMatching(/read the screen/) as unknown,
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
      terminate: () => {
        did.push('stop');
        return Promise.resolve();
      },
      launch: () => {
        did.push('launch');
        return Promise.resolve(`${APP}: 4242`);
      },
      exec: (words: string[]) => {
        did.push(words.join(' '));
        return Promise.resolve('');
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
    const { did, perf } = simulator(() => Promise.resolve(true));
    const { value, raw } = await perf.launch(APP, { mode: 'cold', repeats: 2 });
    expect(did).toEqual(['stop', 'launch', 'stop', 'launch', 'stop', 'launch']);
    expect(value.samples).toHaveLength(2);
    expect(value.medianMs).toBe(value.samples[0]?.totalMs);
    expect(value.until).toBe('the first screen is read');
    expect(raw.split('\n')).toHaveLength(3);
  }, 10_000);

  it('puts another app in front for a warm launch', async () => {
    clockOf(10);
    const { did, perf } = simulator(() => Promise.resolve(true));
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
    const { perf } = simulator(() => Promise.resolve(false));
    await expect(perf.launch(APP, { mode: 'cold', repeats: 1 })).rejects.toMatchObject(NO_SCREEN);
  }, 10_000);

  it('looks once even when the launch itself took longer than the wait', async () => {
    clockOf(25_000);
    const seen = vi.fn(() => Promise.resolve(true));
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
      terminate: () => {
        did.push('stop');
        return Promise.resolve();
      },
      launch: () => {
        did.push('launch');
        return Promise.resolve();
      },
      target: () => {
        did.push('target');
        return Promise.resolve();
      },
      tree: read,
      ctl: {
        launch: (app: string, _url?: string, env?: object) => {
          did.push(env ? `env ${app}` : `front ${app}`);
          return Promise.resolve();
        },
      },
    });
    return { did, perf: device.measure };
  };

  it('warms up once, and stops looking once the screen shows', async () => {
    clockOf(10);
    const { did, perf } = phone(() => Promise.resolve(screen(APP)));
    const { value, raw } = await perf.launch(APP, { mode: 'cold', repeats: 2 });
    expect(did.filter((d) => d === 'launch')).toHaveLength(3);
    expect(value.samples).toHaveLength(2);
    expect(value.medianMs).toBe(value.samples[0]?.totalMs);
    expect(value.until).toBe('the first screen is read');
    expect(raw.split(' ')).toHaveLength(2);
  }, 10_000);

  it('puts Settings in front for a warm launch', async () => {
    clockOf(10);
    const { did, perf } = phone(() => Promise.resolve(screen(APP)));
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
    const { did, perf } = phone(() => Promise.resolve(screen(APP)));
    await perf.launch(APP, { mode: 'cold', repeats: 1, env: { A: '1' } });
    expect(did.slice(0, 3)).toEqual(['stop', `env ${APP}`, 'target']);
  }, 10_000);

  it('refuses a screen that never comes: a launch that showed none is no measurement', async () => {
    clockOf(5_000);
    const { perf } = phone(() => Promise.resolve(screen('another.app')));
    await expect(perf.launch(APP, { mode: 'cold', repeats: 1 })).rejects.toMatchObject(NO_SCREEN);
  }, 10_000);
});

describe('a runner reached', () => {
  const reached = (started: boolean, targetApp?: string) => {
    const asked: string[] = [];
    const rpc = {
      closed: false,
      call: (method: string) => {
        asked.push(method);
        return Promise.resolve({ result: {} });
      },
      close: () => undefined,
    };
    const hello = { model: 'iPhone' };
    const device = new IosPhoneDevice('00001234-0123456789ABCDEF', { profile: '/p' });
    Object.assign(device, {
      targetApp,
      launcher: { connect: () => Promise.resolve({ rpc, hello, started }) },
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

describe('a compile state', () => {
  it.each([
    [
      'simulator',
      new IosSimulatorPerf(
        'U',
        new Simctl(),
        () => Promise.resolve(true),
        cannot("XCTest's metrics"),
      ),
    ],
    ['phone', new IosPhonePerf({} as never)],
  ])('is refused on a %s, as a launch there would read as measured in it', async (_, perf) => {
    const launch = perf.launch(APP, { mode: 'cold', repeats: 1, compile: 'speed' });
    await expect(launch).rejects.toBeInstanceOf(Cannot);
    await expect(launch).rejects.toThrow('cannot measure a launch in a compile state');
  });
});

/** A simulator whose app runs as `pid` among this Mac's processes, by the folder `simctl` says it is installed in. */
const running = (udid: string, pid: number) => {
  const folder = `/Devices/${udid}/data/Containers/Bundle/Application/A1/Fixture.app`;
  return Object.assign(new Simctl(), {
    exec: () => Promise.resolve(`${folder}\n`),
    processes: () => Promise.resolve(`    1 Ss   /sbin/launchd\n ${pid} Ss   ${folder}/Fixture\n`),
  });
};

describe('frames on a simulator', () => {
  const UDID = 'F7A3E1C2-0000-4000-8000-000000000001';
  const file = () => join(stateDir(), 'probes', `${UDID}-${APP}.jsonl`);
  const perf = () => {
    const simctl = running(UDID, 4242);
    return new IosSimulatorPerf(
      UDID,
      simctl,
      () => Promise.resolve(true),
      cannot("XCTest's metrics"),
    );
  };
  const resets = () => (readFileSync(file(), 'utf8').match(/"reset"/g) ?? []).length;

  it('start a window of their own at each read, as they do on Android', async () => {
    mkdirSync(join(stateDir(), 'probes'), { recursive: true });
    writeFileSync(file(), `${JSON.stringify({ pid: 4242, loaded: APP, t: Date.now() })}\n`);
    await perf().frames(APP);
    expect(resets()).toBe(1);
    await perf().frames(APP, { reset: false });
    expect(resets()).toBe(1);
    await perf().frames(APP, { reset: true });
    expect(resets()).toBe(2);
  });
});

describe('a CPU profile on a simulator', () => {
  it('refuses while another recording holds the device, where sample would answer with no samples', async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-profile-')));
    const udid = 'F7A3E1C2-0000-4000-8000-000000000003';
    const held = deviceStateFile('traces-recording', udid);
    mkdirSync(dirname(held), { recursive: true });
    writeFileSync(held, JSON.stringify(thisOwner('Time Profiler')));
    // a pid no process has: a sample of it would fail by itself
    const perf = new IosSimulatorPerf(
      udid,
      running(udid, 999999),
      () => Promise.resolve(true),
      cannot("XCTest's metrics"),
    );
    await expect(perf.cpuProfile(APP, 1_000)).rejects.toMatchObject({
      code: 'DEVICE_CLAIMED',
      message: expect.stringContaining('a second would come back empty') as unknown,
    });
    vi.unstubAllEnvs();
  });
});

describe('an app on a simulator', () => {
  it("is the process that runs, from this Mac's own list", async () => {
    const udid = 'F7A3E1C2-0000-4000-8000-000000000002';
    const perf = new IosSimulatorPerf(
      udid,
      running(udid, 4242),
      () => Promise.resolve(true),
      cannot("XCTest's metrics"),
    );
    await expect(perf.pid(APP)).resolves.toBe(4242);
  });
});
