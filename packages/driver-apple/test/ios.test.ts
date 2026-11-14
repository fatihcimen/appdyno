import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { must, RpcDevice } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { IosSimulatorDevice } from '../src/simulator.js';
import { IosPhoneDevice } from '../src/phone.js';
import { startPhase } from '../src/runner.js';
import type { Tree } from '@appdyno/protocol';
import { assertBundle, assertUdid, type Simctl } from '../src/simctl.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';

describe('simulator inputs', () => {
  it('takes only a simulator id, never "booted" or a name', () => {
    expect(assertUdid('7994F239-7CD7-4247-9FC0-4F92C7CFC951')).toBeTruthy();
    for (const bad of ['booted', 'QA iPhone', '7994f239-7cd7-4247-9fc0-4f92c7cfc951; rm -rf ~'])
      expect(() => assertUdid(bad), bad).toThrow(/not a simulator id/);
  });

  it('takes only a bundle id', () => {
    expect(assertBundle('dev.appdyno.fixture')).toBe('dev.appdyno.fixture');
    for (const bad of ['fixture', 'a.b c', 'a.b;ls', '-x.y'])
      expect(() => assertBundle(bad), bad).toThrow(/not a bundle id/);
  });
});

describe("a simulator's clipboard", () => {
  const device = (pasted: string) =>
    new IosSimulatorDevice('7994F239-7CD7-4247-9FC0-4F92C7CFC951', {
      pbcopy: () => Promise.resolve(undefined),
      exec: () => Promise.resolve(pasted),
    } as unknown as Simctl);
  const runner = () => vi.spyOn(RpcDevice.prototype, 'setClipboard');
  afterEach(() => void vi.restoreAllMocks());

  it('leaves the runner alone where the Mac wrote the text', async () => {
    const set = runner();
    await device('pano').setClipboard('pano');
    expect(set).not.toHaveBeenCalled();
  });

  it('goes to the runner where the Mac wrote nothing', async () => {
    const set = runner().mockResolvedValue(undefined);
    await device('').setClipboard('pano');
    expect(set).toHaveBeenCalledOnce();
  });

  it('refuses once, saying what stalled, where the runner stalls too', async () => {
    const set = runner().mockRejectedValue(new DeviceError('TIMEOUT', 'no answer in 15000 ms'));
    await expect(device('').setClipboard('pano')).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: expect.stringMatching(/did not take the text.*stalled/) as unknown,
      hint: expect.stringMatching(/type the text/) as unknown,
      retryable: true,
    });
    expect(set).toHaveBeenCalledOnce();
  });

  it('leaves any other failure of the runner as it was', async () => {
    runner().mockRejectedValue(new DeviceError('AGENT_UNAVAILABLE', 'gone'));
    await expect(device('').setClipboard('pano')).rejects.toMatchObject({
      code: 'AGENT_UNAVAILABLE',
    });
  });
});

describe('iPhone inputs', () => {
  it('takes an iPhone UDID in either form, nothing else', async () => {
    const { assertPhoneUdid } = await import('../src/devicectl.js');
    expect(assertPhoneUdid('00001234-0123456789ABCDEF')).toBeTruthy();
    expect(assertPhoneUdid('0123456789abcdef0123456789abcdef01234567')).toBeTruthy();
    for (const bad of [
      '7994F239-7CD7-4247-9FC0-4F92C7CFC951',
      'iPhone',
      '00001234-0123456789ABCDEF; ls',
    ])
      expect(() => assertPhoneUdid(bad), bad).toThrow(/not an iPhone UDID/);
  });
});

describe('the link prompt', () => {
  /** A read of an iOS 27.2 simulator by the runner, with the alert up and dismissed after. */
  const read = (name: string) =>
    JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8')) as Tree;
  /** The read, its alert's words and buttons in another language. */
  const said = (t: Tree, words: Record<string, string>) => ({
    ...t,
    nodes: t.nodes.map((n) => ({ ...n, ...(n.d && words[n.d] && { d: words[n.d] }) })),
  });

  it('confirms "Open in …?" by place in any language: the second of two buttons', async () => {
    const { promptButton } = await import('../src/platform-screen.js');
    const asks = read('ios-open-in-prompt');
    expect(promptButton(asks, 'appdyno fixture')).toEqual({ x: 275, y: 474 });
    const tr = { 'Open in “appdyno fixture”?': '“appdyno fixture” içinde açılsın mı?' };
    expect(
      promptButton(said(asks, { ...tr, Cancel: 'Vazgeç', Open: 'Aç' }), 'appdyno fixture'),
    ).toEqual({ x: 275, y: 474 });
  });

  it("never answers the app's own permission prompt, which names it too, nor a prompt of another app", async () => {
    const { promptButton } = await import('../src/platform-screen.js');
    expect(promptButton(read('ios-notification-prompt'), 'appdyno fixture')).toBeUndefined();
    const asks = read('ios-open-in-prompt');
    expect(promptButton(asks, 'Maps')).toBeUndefined();
    const none = { ...asks, nodes: asks.nodes.filter((n) => n.c !== 'Alert') };
    expect(promptButton(none, 'appdyno fixture')).toBeUndefined();
  });

  it("never answers the app's own alert of that shape, in its window: only the home screen app's", async () => {
    const { promptButton } = await import('../src/platform-screen.js');
    const asks = read('ios-open-in-prompt');
    const app = { ...must(asks.windows[0], 'a window'), pkg: 'dev.appdyno.fixture' };
    const first = asks.nodes.findIndex((n) => n.w === 1);
    // the app's own "Delete … account?", Cancel and Delete, drawn lower in its own window
    const own = said(asks, {
      'Open in “appdyno fixture”?': 'Delete appdyno fixture account?',
      Open: 'Delete',
    })
      .nodes.slice(first)
      .map((n) => ({
        ...n,
        w: 0,
        p: n.p < 0 ? -1 : n.p - first,
        b: [n.b[0], n.b[1] + 200, n.b[2], n.b[3] + 200] as typeof n.b,
      }));
    expect(
      promptButton({ ...asks, windows: [app], nodes: own }, 'appdyno fixture'),
    ).toBeUndefined();
    const under = asks.nodes.map((n) => ({ ...n, p: n.p < 0 ? -1 : n.p + own.length }));
    const both = { ...asks, windows: [app, ...asks.windows.slice(1)], nodes: [...own, ...under] };
    expect(promptButton(both, 'appdyno fixture')).toEqual({ x: 275, y: 474 });
  });
});

describe('a starting runner', () => {
  it("says where it has got to, by xcodebuild's log", () => {
    // a real start's log, Xcode 27.1, as far as each milestone
    const begun =
      'Command line invocation:\n    /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild test-without-building\n\nWriting result bundle at path:\n\t/tmp/ios.kept/session.xcresult\n\n2026-11-13 12:43:43.280 xcodebuild[91087:20746104] [MT] IDESchemeActionSDKRecord: operatingSystemBuild = <DVTBuildVersion 24A94232>\n';
    const launched = `${begun}2026-11-13 12:43:47.641146+0300 Runner-Runner[91150:20746824] [Default] Running tests...\n`;
    const running = `${launched}Test Suite 'Selected tests' started at 2026-11-13 12:43:52.904.\n`;
    expect(startPhase(begun)).toMatch(/preparing/);
    expect(startPhase(launched)).toMatch(/launching/);
    expect(startPhase(running)).toMatch(/port/);
  });
});

describe('what a device measures', () => {
  const simulator = () => new IosSimulatorDevice('7994F239-7CD7-4247-9FC0-4F92C7CFC951').measure;
  const phone = () => new IosPhoneDevice('00001234-0123456789ABCDEF', { profile: '/p' }).measure;
  const says = async (read: () => Promise<unknown>, what: string) =>
    expect(read()).rejects.toThrow(`cannot measure ${what}`);

  it('a simulator comes through its probe, and has no recording of its frames to wait for', () => {
    expect(simulator().framesByProbe).toBe(true);
    expect(phone().framesByProbe).toBe(false);
  });

  it('a phone has no quick read of frames or memory between two steps', () => {
    expect(simulator().slowReads).toEqual([]);
    expect(phone().slowReads).toEqual(['memory', 'frames', 'resetFrames']);
  });

  it(
    "a simulator counts what it is given by the clock, whatever another reader's reset said meanwhile",
    fakeTimed(async () => {
      const state = mkdtempSync(join(tmpdir(), 'appdyno-probe-'));
      vi.stubEnv('APPDYNO_STATE_DIR', state);
      try {
        const perf = simulator();
        Object.assign(perf, { pid: () => Promise.resolve(42) });
        const file = join(state, 'probes', '7994F239-7CD7-4247-9FC0-4F92C7CFC951-a.b.jsonl');
        mkdirSync(dirname(file), { recursive: true });
        const line = (l: object) => `${JSON.stringify(l)}\n`;
        writeFileSync(file, line({ loaded: 'a.b', pid: 42, t: Date.now() - 5_000 }));
        const m = await perf.framesDuring('a.b', 1, () => {
          const t = Date.now();
          const frame = (at: number) => line({ t: at, dt: 16.7, v: 16.7 });
          // a timeline's reader, as it was, reset the probe's count between two frames of the scroll
          appendFileSync(file, frame(t + 1) + frame(t + 2) + line({ reset: t + 3 }) + frame(t + 4));
          return Promise.resolve();
        });
        expect(m.value.totalFrames).toBe(3);
      } finally {
        vi.unstubAllEnvs();
      }
    }),
  );

  it('says why a simulator has no hangs, and an iPhone no probe, and to leave out the probe', async () => {
    await expect(simulator().hangs()).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: expect.stringMatching(/^cannot measure hangs: .+/) as unknown,
    });
    await expect(phone().attachProbe()).rejects.toMatchObject({
      message: expect.stringMatching(/^cannot measure through a frame probe: .+/) as unknown,
      hint: expect.stringContaining('leave out probe') as unknown,
    });
  });

  it('each says what it has no way of measuring', async () => {
    const sim = simulator();
    await says(sim.hangs, 'hangs');
    await says(sim.heapProfile, 'a heap profile');
    await says(sim.baselineProfile, 'a Baseline Profile');
    await says(sim.vitals, 'the device state');
    const iphone = phone();
    await says(iphone.frames, 'frames');
    await says(iphone.attachProbe, 'through a frame probe');
    await says(iphone.heapProfile, 'a heap profile');
    await says(iphone.baselineProfile, 'a Baseline Profile');
  });
});

describe('the app switcher on a simulator', () => {
  afterEach(() => void vi.restoreAllMocks());

  it("opens by the input a window sends, as the runner's drag shows none", async () => {
    const device = new IosSimulatorDevice('7994F239-7CD7-4247-9FC0-4F92C7CFC951');
    const input = vi.spyOn(device.mirror, 'input').mockResolvedValue(undefined);
    const act = vi.spyOn(device, 'act');
    await device.key('appSwitch');
    expect(input).toHaveBeenCalledExactlyOnceWith({ kind: 'button', name: 'appSwitch' });
    expect(act).not.toHaveBeenCalled();
  });
});

describe('Spotlight on a simulator', () => {
  afterEach(() => void vi.restoreAllMocks());

  it('is read as the app it is, once it is in front: as the home screen app it showed only its keyboard', async () => {
    const device = new IosSimulatorDevice('7994F239-7CD7-4247-9FC0-4F92C7CFC951');
    const seen: string[] = [];
    vi.spyOn(device, 'act').mockImplementation((a) => {
      seen.push(a.kind === 'key' ? a.key : a.kind);
      return Promise.resolve({});
    });
    vi.spyOn(device, 'target').mockImplementation((b) => {
      seen.push(`read ${b}`);
      return Promise.resolve();
    });
    const waits = device as unknown as { untilFront: (b: string) => Promise<void> };
    vi.spyOn(waits, 'untilFront').mockImplementation((b) => {
      seen.push(`until ${b}`);
      return Promise.resolve();
    });
    await device.openView('spotlight');
    expect(seen).toEqual([
      'read com.apple.springboard',
      'home',
      'space',
      'read com.apple.Spotlight',
      'until com.apple.Spotlight',
    ]);
  });
});

describe('home on a simulator', () => {
  afterEach(() => void vi.restoreAllMocks());
  const shows = (pkg: string): Tree => ({
    windows: [{ type: 1, pkg, layer: 0, b: [0, 0, 402, 874], active: true, focused: true }],
    nodes: [],
    truncated: false,
    elapsedMs: 1,
    hash: pkg,
  });
  /** Home pressed with `atPress` in front, and the app in front at each look after the settle. */
  const pressed = (atPress: string, fronts: string[]) => {
    const device = new IosSimulatorDevice('7994F239-7CD7-4247-9FC0-4F92C7CFC951');
    vi.spyOn(device, 'act').mockResolvedValue({ tree: shows('dev.app') });
    const looks = device as unknown as { frontNow: () => Promise<string | undefined> };
    vi.spyOn(looks, 'frontNow').mockResolvedValue(atPress);
    vi.spyOn(device, 'foreground').mockImplementation(() =>
      Promise.resolve(fronts.shift() ?? 'dev.app'),
    );
    vi.spyOn(device, 'tree').mockResolvedValue(shows('com.apple.springboard'));
    return device.key('home', { read: 'tree' });
  };

  it('answers once the app has left, which comes after the settle saw the app still there', async () => {
    const r = await pressed('dev.app', ['dev.app', 'dev.app', 'com.apple.springboard']);
    expect(r.tree?.windows[0]?.pkg).toBe('com.apple.springboard');
  });

  it('answers at once from the switcher, where home brings back the app it was opened over', async () => {
    const started = Date.now();
    const r = await pressed('com.apple.springboard', []);
    expect([r.tree?.windows[0]?.pkg, Date.now() - started < 1_000]).toEqual(['dev.app', true]);
  });

  it("answers with the app where it never leaves, once home's time is up", async () => {
    vi.useFakeTimers();
    const r = pressed('dev.app', []);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await r).tree?.windows[0]?.pkg).toBe('dev.app');
    vi.useRealTimers();
  });
});

describe("whether an iPhone's app runs", () => {
  const phone = (pid: () => Promise<number>) => {
    const d = new IosPhoneDevice('00001234-0123456789ABCDEF', { profile: '/p' });
    Object.assign((d as unknown as { ops: object }).ops, { pid });
    return d;
  };

  it('is no only where the phone lists no process of it, and unknown where it could not be asked', async () => {
    expect(await phone(() => Promise.resolve(812)).appRunning('dev.app')).toBe(true);
    const none = new DeviceError('APP_NOT_RUNNING', 'dev.app is not running');
    expect(await phone(() => Promise.reject(none)).appRunning('dev.app')).toBe(false);
    const busy = new DeviceError('TIMEOUT', 'devicectl device info processes took over 60000 ms');
    await expect(phone(() => Promise.reject(busy)).appRunning('dev.app')).rejects.toBe(busy);
  });
});

describe("a look at what the home screen app shows over an iPhone's app", () => {
  /** A phone whose runner reads `read` of the app a `tree.get` names, and the target's own read of the rest. */
  const phone = async (read: string, app: string | undefined = 'dev.app') => {
    const d = new IosPhoneDevice('00001234-0123456789ABCDEF', { profile: '/p' });
    const calls: string[] = [];
    const callNow = async (method: string, params: { pkg?: string }) => {
      calls.push(params.pkg ? `${method} ${params.pkg}` : method);
      await new Promise((r) => setTimeout(r, 5));
      const pkg = params.pkg ? read : 'dev.app';
      const window = { type: 1, pkg, layer: 0, b: [0, 0, 402, 874], active: true, focused: true };
      return {
        result: { windows: [window], nodes: [], truncated: false, elapsedMs: 1, hash: pkg },
      };
    };
    Object.assign(d, { callNow, keepDump: () => Promise.resolve(undefined) });
    if (app) await d.target(app);
    calls.length = 0;
    return { d, calls };
  };

  it("is one read of it, which leaves the runner's target as it was: no cancel can leave the runner on it", async () => {
    const { d, calls } = await phone('com.apple.springboard');
    await Promise.all([d.systemTree(), d.tree()]);
    expect(calls).toEqual(['tree.get com.apple.springboard', 'tree.get']);
  });

  it('is taken with no app selected too, where the runner reads whichever app iOS has in front', async () => {
    const { d, calls } = await phone('com.apple.springboard', undefined);
    expect((await d.systemTree())?.windows[0]?.pkg).toBe('com.apple.springboard');
    expect(calls).toEqual(['tree.get com.apple.springboard']);
  });

  it('is refused where the runner read another app, as one built before it took the app to read', async () => {
    const { d } = await phone('dev.app');
    await expect(d.systemTree()).rejects.toMatchObject({ code: 'AGENT_VERSION_MISMATCH' });
  });
});

describe('the kind of device', () => {
  it('calls a simulator virtual, and a phone not', () => {
    expect(new IosSimulatorDevice('7994F239-7CD7-4247-9FC0-4F92C7CFC951').virtual).toBe(true);
    const phone = new IosPhoneDevice('00001234-0123456789ABCDEF', { profile: '/p' });
    expect(phone.virtual).toBe(false);
  });
});
