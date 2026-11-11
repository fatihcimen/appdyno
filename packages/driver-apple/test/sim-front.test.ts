import { describe, expect, it, vi } from 'vitest';
import { inCall } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { IosSimulatorDevice } from '../src/index.js';
import { Simctl } from '../src/simctl.js';
import { SimulatorApps } from '../src/simulator-manage.js';

const UDID = 'C8F701E7-9A02-4465-AC91-F4C85FBA788D';

/** The runtime's own apps, which every simulator of that runtime runs from. */
const RUNTIME =
  '/private/var/run/mnt/iOS 27.2.simruntime/Contents/Resources/RuntimeRoot/Applications';

/** An app's folder on this Mac, as `simctl get_app_container` says it: the system's in the runtime's. */
const folder = (bundle: string) =>
  bundle.startsWith('com.apple.')
    ? `${RUNTIME}/${bundle}.app`
    : `/Users/me/Library/Developer/CoreSimulator/Devices/${UDID}/data/Containers/Bundle/Application/${bundle}/App.app`;

/** A simulator with this launchctl list, and this Mac with these processes. */
class Listed extends Simctl {
  constructor(
    private readonly listing: string,
    private readonly ps = '',
  ) {
    super({});
  }
  override exec = (args: string[]) =>
    Promise.resolve(args[0] === 'get_app_container' ? `${folder(args[2] ?? '')}\n` : this.listing);
  override processes = () => Promise.resolve(this.ps);
}

const LISTING = [
  'PID\tStatus\tLabel',
  '5352\t0\tcom.apple.SpringBoard',
  '-\t0\tUIKitApplication:dev.app[a971][rb-legacy]',
  '29658\t0\tUIKitApplication:dev.app[b202][rb-legacy]',
  '-\t0\tUIKitApplication:com.apple.Preferences[c303][rb-legacy]',
  '7712\t0\tUIKitApplication:com.apple.Preferences[d404][rb-legacy]',
].join('\n');

// another simulator of the same runtime has Settings up, from the same folder
const RUNNING = [
  '  412 Ss   /sbin/launchd',
  `29658 Ss   ${folder('dev.app')}/App`,
  `  999 Ss   ${folder('com.apple.Preferences')}/Preferences`,
  ` 7712 Ss   ${folder('com.apple.Preferences')}/Preferences`,
].join('\n');

describe('a running app on a simulator', () => {
  it("is found among this Mac's processes by the folder it is installed in", async () => {
    expect(await new Listed(LISTING, RUNNING).pid(UDID, 'dev.app')).toBe(29658);
  });

  it("is asked of the simulator when it is the system's, which every simulator of the runtime runs from one folder", async () => {
    expect(await new Listed(LISTING, RUNNING).pid(UDID, 'com.apple.Preferences')).toBe(7712);
  });

  it('includes the home screen, which is a service with a label of its own', async () => {
    expect(await new Listed(LISTING).pid(UDID, 'com.apple.springboard')).toBe(5352);
  });

  it('says what is not running, by name', async () => {
    await expect(new Listed(LISTING, RUNNING).pid(UDID, 'dev.other')).rejects.toThrow(
      'dev.other is not running',
    );
  });
});

/** What a simulator's launchctl said with Settings up, and at once after `simctl terminate` of it: its line goes. */
const SETTINGS_UP = [
  'PID\tStatus\tLabel',
  '-\t0\tcom.apple.progressd',
  '60574\t0\tcom.apple.SpringBoard',
  '-\t0\tcom.apple.merchantd',
  '21254\t0\tUIKitApplication:com.apple.Preferences[5f2f][rb-legacy]',
  '-\t0\tcom.apple.webkit.adattributiond',
].join('\n');
const SETTINGS_STOPPED = [
  'PID\tStatus\tLabel',
  '-\t0\tcom.apple.progressd',
  '60574\t0\tcom.apple.SpringBoard',
  '-\t0\tcom.apple.merchantd',
  '-\t0\tcom.apple.webkit.adattributiond',
].join('\n');
/** The fixture's line in ps while it runs, in this test's folder; at once after a terminate it has none. */
const FIXTURE_UP = `23561 Ss   ${folder('dev.appdyno.fixture')}/Fixture`;

describe('an app just stopped on a simulator', () => {
  const apps = (listing: string, running = '') =>
    new SimulatorApps(new Listed(listing, running), UDID);

  it('is stopped once launchctl no longer lists it, which is at once', async () => {
    expect(await apps(SETTINGS_UP).appState('com.apple.Preferences')).toBe('running');
    expect(await apps(SETTINGS_STOPPED).appState('com.apple.Preferences')).toBe('stopped');
  });

  it('is stopped while launchctl lists it with no pid, as it does a job that is not running', async () => {
    const left = SETTINGS_UP.replace('21254\t', '-\t');
    expect(await apps(left).appState('com.apple.Preferences')).toBe('stopped');
  });

  it("is stopped once its process is gone from this Mac's", async () => {
    expect(await apps('', FIXTURE_UP).appState('dev.appdyno.fixture')).toBe('running');
    expect(await apps('').appState('dev.appdyno.fixture')).toBe('stopped');
  });

  /** The runner up with the fixture named to it, still naming it, and the helper seeing the home screen. */
  const behind = (running: string) => {
    const direct = { front: () => Promise.resolve('com.apple.springboard'), close: vi.fn() };
    const device = new IosSimulatorDevice(UDID, new Listed('', running), direct as never);
    Object.defineProperty(device, 'runnerUp', { value: true });
    const call = () => Promise.resolve({ result: { pkg: 'dev.appdyno.fixture' } });
    Object.assign(device, { targetApp: 'dev.appdyno.fixture', rpc: { closed: false, call } });
    return device;
  };

  it('is not in front, though the runner names it a moment longer', async () => {
    expect(await behind('').foreground()).toBe('com.apple.springboard');
  });

  it('is in front under an alert while its process runs', async () => {
    expect(await behind(FIXTURE_UP).foreground()).toBe('dev.appdyno.fixture');
  });
});

describe('what is in front of a simulator with no runner', () => {
  const withFront = (front: string | undefined) => {
    const read = vi.fn(() => Promise.resolve(front));
    const direct = { front: read, close: vi.fn() };
    const device = new IosSimulatorDevice(UDID, new Listed(''), direct as never);
    return device;
  };

  it('is what its read helper says, and needs no runner', async () => {
    expect(await withFront('dev.app').foreground()).toBe('dev.app');
  });

  it('is read with no app named, so that a first look at a simulator starts no runner', async () => {
    const tree = { windows: [], nodes: [], hash: 'h', truncated: false };
    const read = vi.fn(() => Promise.resolve({ busy: false, copies: false, tree }));
    const direct = { front: () => Promise.resolve('com.apple.springboard'), read, close: vi.fn() };
    const device = Object.assign(new IosSimulatorDevice(UDID, new Listed(''), direct as never), {
      keepDump: () => Promise.resolve(undefined),
    });
    await expect(device.tree()).resolves.toMatchObject({ hash: 'h' });
    expect(read).toHaveBeenCalledWith('com.apple.springboard');
  });

  it('is the home screen while the helper cannot say yet, as on a first boot', async () => {
    const tree = { windows: [], nodes: [], hash: 'h', truncated: false };
    const read = vi.fn(() => Promise.resolve({ busy: false, copies: false, tree }));
    const direct = { front: () => Promise.resolve(undefined), read, close: vi.fn() };
    const device = Object.assign(new IosSimulatorDevice(UDID, new Listed(''), direct as never), {
      keepDump: () => Promise.resolve(undefined),
    });
    await expect(device.tree()).resolves.toMatchObject({ hash: 'h' });
    expect(read).toHaveBeenCalledWith('com.apple.springboard');
  });

  it('waits out the seconds of a first boot with nothing in front, as a runner takes longer', async () => {
    const tree = { windows: [], nodes: [], hash: 'h', truncated: false };
    const read = vi
      .fn()
      .mockResolvedValueOnce({ refused: 'no-foreground' })
      .mockResolvedValue({ busy: false, copies: false, tree });
    const direct = { front: () => Promise.resolve(undefined), read, close: vi.fn() };
    const device = Object.assign(new IosSimulatorDevice(UDID, new Listed(''), direct as never), {
      keepDump: () => Promise.resolve(undefined),
    });
    await expect(device.tree()).resolves.toMatchObject({ hash: 'h' });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('goes to the runner where it is up, and a home screen read past a widget would say less', async () => {
    const mine = { windows: [], nodes: [], hash: 'helper', truncated: false };
    const runners = { windows: [], nodes: [], hash: 'runner', truncated: false };
    const read = vi.fn(() =>
      Promise.resolve({ busy: false, copies: false, partial: true, tree: mine }),
    );
    const checkRead = vi.fn(() => false);
    const direct = {
      front: () => Promise.resolve('com.apple.springboard'),
      read,
      checkRead,
      close: vi.fn(),
    };
    const device = new IosSimulatorDevice(UDID, new Listed(''), direct as never);
    Object.defineProperty(device, 'runnerUp', { value: true });
    Object.assign(device, {
      keepDump: () => Promise.resolve(undefined),
      callNow: () => Promise.resolve({ result: runners }),
    });
    await expect(device.tree()).resolves.toMatchObject({ hash: 'runner' });
    // it is no misread, of which three would turn the helper's reads off
    expect(checkRead).not.toHaveBeenCalled();
  });

  it('is nothing yet when the helper has no answer, and no refusal', async () => {
    await expect(withFront(undefined).foreground()).resolves.toBeUndefined();
  });
});

describe('a runner up on a simulator with no app named', () => {
  /** An app opened by a link: the helper sees it in front, and the runner reads the home screen unless told. */
  const up = (front: string | undefined) => {
    const runners = { windows: [], nodes: [], hash: 'runner', truncated: false };
    const call = vi.fn((method: string, _params: unknown) =>
      Promise.resolve({
        result: method === 'app.foreground' ? { pkg: 'com.apple.springboard' } : runners,
      }),
    );
    const direct = {
      front: () => Promise.resolve(front),
      read: () => Promise.resolve({ refused: 'window-not-full-screen' }),
      close: vi.fn(),
    };
    const device = new IosSimulatorDevice(UDID, new Listed(''), direct as never);
    Object.defineProperty(device, 'runnerUp', { value: true });
    Object.assign(device, {
      rpc: { closed: false, call },
      keepDump: () => Promise.resolve(undefined),
    });
    return { device, call };
  };

  it('says the app the helper sees in front, and never the runner, which can only say the home screen', async () => {
    const { device, call } = up('dev.app');
    expect(await device.foreground()).toBe('dev.app');
    expect(await up(undefined).device.foreground()).toBeUndefined();
    expect(call).not.toHaveBeenCalled();
  });

  it("reads that app by the runner, told it once, and not the home screen's card of it", async () => {
    const { device, call } = up('dev.app');
    await device.tree();
    await device.tree();
    expect(call.mock.calls.map(([method, params]) => [method, params])).toEqual([
      ['app.target', { pkg: 'dev.app' }],
      ['tree.get', {}],
      ['tree.get', {}],
    ]);
  });
});

describe('a look for what stands over the app on a simulator', () => {
  const word = (d: string) => ({ c: 'StaticText', d });
  const tree = {
    windows: [{ pkg: 'com.apple.springboard' }],
    nodes: [word('Face ID'), { c: 'Button', d: 'Cancel' }],
    hash: 'h',
  };

  const device = async (answer: unknown) => {
    const read = vi.fn(() => Promise.resolve(answer));
    const direct = { front: () => Promise.resolve(undefined), read, close: vi.fn() };
    const d = new IosSimulatorDevice(UDID, new Listed(''), direct as never);
    const callNow = vi.fn(() => {
      return Promise.reject(new Error('a runner was asked for'));
    });
    Object.assign(d, { callNow, keepDump: () => Promise.resolve(undefined) });
    await d.target('dev.app');
    return { d, read, callNow };
  };

  it('needs no runner with the app in front, which the helper says at once', async () => {
    const { d, read, callNow } = await device({ refused: 'not-foreground', front: 'dev.app' });
    expect(await d.systemWords()).toEqual([]);
    expect(read).toHaveBeenCalledWith('com.apple.springboard');
    expect(callNow).not.toHaveBeenCalled();
  });

  it("reads a sheet from the home screen, which it puts in front, with a control's copies left to no runner", async () => {
    const { d, callNow } = await device({ busy: false, copies: true, tree });
    expect(await d.systemWords()).toEqual(['Face ID']);
    expect(callNow).not.toHaveBeenCalled();
  });

  it('asks a runner that is up where the helper has no say, as in landscape', async () => {
    const { d, callNow } = await device({ refused: 'landscape' });
    Object.defineProperty(d, 'runnerUp', { value: true });
    Object.assign(d, { rpc: { closed: false, call: () => Promise.resolve({ result: {} }) } });
    callNow.mockResolvedValue({ result: tree } as never);
    expect(await d.systemWords()).toEqual(['Face ID']);
  });

  it('starts none for it where the helper has no say, and says it could not look: no "nothing over it"', async () => {
    for (const refused of ['landscape', 'failed']) {
      const { d, callNow } = await device({ refused });
      await expect(d.systemTree()).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' });
      expect(callNow).not.toHaveBeenCalled();
    }
  });
});

describe('a touch the input helper gave no answer for on a simulator', () => {
  it('is answered TIMEOUT, sent, and not made a second time by the runner', async () => {
    const lost = Object.assign(new DeviceError('TIMEOUT', 'no answer from the input helper'), {
      sent: true,
    });
    const direct = {
      reads: true,
      screenKnown: true,
      touchesEnded: 0,
      status: () => ({ input: 'ok', read: 'ok' }),
      arm: () => Promise.resolve(false),
      animationsOver: () => Promise.resolve(0),
      send: vi.fn(() => Promise.reject(lost)),
      close: vi.fn(),
    };
    const d = new IosSimulatorDevice(UDID, new Listed(''), direct as never);
    const runner = vi.fn(() => Promise.resolve({}));
    Object.assign(d, { actByRunner: runner });
    await expect(d.act({ kind: 'tap', x: 10, y: 10 })).rejects.toMatchObject({
      code: 'TIMEOUT',
      sent: true,
    });
    expect(direct.send).toHaveBeenCalledOnce();
    expect(runner).not.toHaveBeenCalled();
  });

  it('goes to no helper once its call is stopped, as a scroll stopped for its app having died', async () => {
    const send = vi.fn(() => Promise.resolve(true));
    const direct = {
      reads: true,
      screenKnown: true,
      status: () => ({ input: 'ok' }),
      arm: () => Promise.resolve(false),
      animationsOver: () => Promise.resolve(0),
      send,
    };
    const d = new IosSimulatorDevice(UDID, new Listed(''), direct as never);
    const stop = new AbortController();
    stop.abort();
    const from = { x: 10, y: 500 };
    const stroke = () => d.act({ kind: 'swipe', from, to: { x: 10, y: 100 }, durationMs: 300 });
    const stopped: unknown = await inCall({ signal: stop.signal }, stroke).catch((e: unknown) => e);
    expect(send).not.toHaveBeenCalled();
    expect(stopped).toMatchObject({ code: 'CANCELLED' });
  });

  it('sends no stroke whose call was stopped while it waited for the app to stop moving', async () => {
    const send = vi.fn(() => Promise.resolve(true));
    const stop = new AbortController();
    const direct = {
      reads: true,
      screenKnown: true,
      status: () => ({ input: 'ok' }),
      arm: () => Promise.resolve(false),
      animationsOver: () => (stop.abort(), Promise.resolve(0)),
      send,
    };
    const d = new IosSimulatorDevice(UDID, new Listed(''), direct as never);
    const tap = () => d.act({ kind: 'tap', x: 10, y: 500 });
    const stopped: unknown = await inCall({ signal: stop.signal }, tap).catch((e: unknown) => e);
    expect(send).not.toHaveBeenCalled();
    expect(stopped).toMatchObject({ code: 'CANCELLED' });
  });
});
