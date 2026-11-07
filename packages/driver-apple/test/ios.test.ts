import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpcDevice } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { IosSimulatorDevice } from '../src/simulator.js';
import { IosPhoneDevice } from '../src/phone.js';
import { startPhase } from '../src/runner.js';
import type { Tree } from '@appdyno/protocol';
import { assertBundle, assertUdid, type Simctl } from '../src/simctl.js';

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
      pbcopy: async () => undefined,
      exec: async () => pasted,
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
      message: expect.stringMatching(/did not take the text.*stalled/),
      hint: expect.stringMatching(/type the text/),
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
  type Box = [number, number, number, number];
  const prompt = (labels: string[]): Tree => ({
    windows: [
      {
        type: 1,
        pkg: 'com.example.app',
        layer: 0,
        b: [0, 0, 402, 874],
        active: true,
        focused: true,
      },
      {
        type: 3,
        pkg: 'com.apple.springboard',
        layer: 1,
        b: [60, 350, 342, 520],
        active: false,
        focused: false,
      },
    ],
    nodes: [
      { p: -1, w: 0, c: 'Application', b: [0, 0, 402, 874], f: 1 },
      { p: -1, w: 1, c: 'Alert', d: '“App” içinde açılsın mı?', b: [60, 350, 342, 520], f: 1 },
      ...labels.map((d, i) => ({
        p: 1,
        w: 1,
        c: 'Button',
        d,
        b: [60 + i * 141, 470, 201 + i * 141, 520] as Box,
        f: 3,
      })),
    ],
    truncated: false,
    elapsedMs: 1,
    hash: 'h',
  });

  it('confirms by place in any language: the second of two buttons', async () => {
    const { promptButton } = await import('../src/platform-screen.js');
    expect(promptButton(prompt(['Vazgeç', 'Aç']))).toEqual({ x: 271.5, y: 495 });
    expect(promptButton(prompt(['Abbrechen', 'Öffnen']))).toEqual({ x: 271.5, y: 495 });
  });

  it('falls back to the word with another count of buttons, and finds nothing without a prompt', async () => {
    const { promptButton } = await import('../src/platform-screen.js');
    expect(promptButton(prompt(['Cancel', 'Open', 'Always']))).toEqual({ x: 271.5, y: 495 });
    expect(promptButton(prompt(['OK']))).toBeUndefined();
    expect(
      promptButton({ ...prompt([]), windows: prompt([]).windows.slice(0, 1) }),
    ).toBeUndefined();
  });
});

describe('a starting runner', () => {
  it("says where it has got to, by xcodebuild's log", () => {
    expect(startPhase('Command line invocation:\n')).toMatch(/preparing/);
    expect(startPhase('Testing started\n')).toMatch(/launching/);
    expect(startPhase("Test Suite 'Runner' started at 2026\n")).toMatch(/port/);
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

  it('a simulator counts from a reset, through what it is given, to its read', async () => {
    const perf = simulator();
    const seen: string[] = [];
    const frames = { value: {}, raw: '', at: '' } as Awaited<ReturnType<typeof perf.frames>>;
    Object.assign(perf, {
      resetFrames: async () => void seen.push('reset'),
      frames: async () => (seen.push('read'), frames),
    });
    await expect(perf.framesDuring('a.b', 1, async () => seen.push('during'))).resolves.toBe(
      frames,
    );
    expect(seen).toEqual(['reset', 'during', 'read']);
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
    vi.spyOn(device, 'act').mockImplementation(async (a) => {
      seen.push(a.kind === 'key' ? a.key : a.kind);
      return {};
    });
    vi.spyOn(device, 'target').mockImplementation(async (b) => void seen.push(`read ${b}`));
    const waits = device as unknown as { untilFront: (b: string) => Promise<void> };
    vi.spyOn(waits, 'untilFront').mockImplementation(async (b) => void seen.push(`until ${b}`));
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
  const pressed = (fronts: string[]) => {
    const device = new IosSimulatorDevice('7994F239-7CD7-4247-9FC0-4F92C7CFC951');
    vi.spyOn(device, 'act').mockResolvedValue({ tree: shows('dev.app') });
    vi.spyOn(device, 'foreground').mockImplementation(async () => fronts.shift() ?? 'dev.app');
    vi.spyOn(device, 'tree').mockResolvedValue(shows('com.apple.springboard'));
    return device.key('home', { read: 'tree' });
  };

  it('answers once the app has left, which comes after the settle saw the app still there', async () => {
    const r = await pressed(['dev.app', 'dev.app', 'com.apple.springboard']);
    expect(r.tree?.windows[0]?.pkg).toBe('com.apple.springboard');
  });

  it("answers with the app where it never leaves, once home's time is up", async () => {
    vi.useFakeTimers();
    const r = pressed([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await r).tree?.windows[0]?.pkg).toBe('dev.app');
    vi.useRealTimers();
  });
});

describe('the kind of device', () => {
  it('calls a simulator virtual, and a phone not', () => {
    expect(new IosSimulatorDevice('7994F239-7CD7-4247-9FC0-4F92C7CFC951').virtual).toBe(true);
    const phone = new IosPhoneDevice('00001234-0123456789ABCDEF', { profile: '/p' });
    expect(phone.virtual).toBe(false);
  });
});
