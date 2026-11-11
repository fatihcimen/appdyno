import { must, type DeviceProvider } from '@appdyno/core';
import { DeviceError, type Tree } from '@appdyno/protocol';
import { describe, expect, it, vi } from 'vitest';
import { ServerContext } from '../../src/context.js';
import { DEFAULT_POLICY, type Policy } from '../../src/policy.js';
import { iosScreen, iphoneProvider, simulatorProvider } from '@appdyno/driver-apple';
import { fine, slowDevicectl } from '@appdyno/testing/slow-devicectl.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { LACKS } from '@appdyno/testing/fake-measures.js';
import { linkedClient } from '@appdyno/testing/calls.js';
import { type Result, connect, refOf } from './shared.js';

// a virtual device's numbers are noisy under host load: these answers must not depend on this Mac's
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  loadavg: () => [0, 0, 0],
}));

/** The fake app on an iOS simulator; its permission prompt is the home screen app's Alert (German labels). */
class FakeIos extends FakeDevice {
  /** What the alert says and its two buttons, as iOS lays them out. */
  alertWords = ['Mitteilungen erlauben?', 'Nicht erlauben', 'Erlauben'];
  constructor() {
    super('75505767-61E2-40F2-8FC6-8AFE20EE25C9');
    Object.defineProperty(this, 'platform', { value: 'ios' });
    Object.defineProperty(this, 'platformScreen', { value: iosScreen });
    this.hello = {
      ...this.hello,
      platform: 'ios',
      osVersion: '18.2',
      model: 'iPhone 16',
      screen: { w: 402, h: 874, density: 3, rotation: 0 },
    };
    delete this.hello.sdk;
  }
  override current(): Tree {
    const t = super.current();
    if (!this.permissionUp) return t;
    const app = t.nodes.filter((n) => n.w === 0);
    return {
      ...t,
      windows: [
        must(t.windows[0], 'its window'),
        {
          type: 3,
          pkg: 'com.apple.springboard',
          layer: 2,
          b: [60, 800, 342, 1150] as [number, number, number, number],
          active: false,
          focused: false,
        },
      ],
      nodes: [
        ...app,
        {
          p: -1,
          w: 1,
          c: 'Alert',
          d: this.alertWords[0],
          b: [60, 800, 342, 1150] as [number, number, number, number],
          f: 17,
        },
        {
          p: app.length,
          w: 1,
          c: 'Button',
          d: this.alertWords[1],
          b: [60, 1000, 200, 1100] as [number, number, number, number],
          f: 19,
        },
        {
          p: app.length,
          w: 1,
          c: 'Button',
          d: this.alertWords[2],
          b: [202, 1000, 342, 1100] as [number, number, number, number],
          f: 19,
        },
        {
          p: app.length,
          w: 1,
          c: 'StaticText',
          d: this.alertWords[0],
          b: [60, 820, 342, 880] as [number, number, number, number],
          f: 1,
        },
      ],
    };
  }
}

describe('iOS simulators', () => {
  it('says iOS for an iOS device in use_device and device_info', async () => {
    const t = await connect({}, new FakeIos());
    const used = await t.textOf('use_device', { device: '75505767-61E2-40F2-8FC6-8AFE20EE25C9' });
    expect(used.text).toContain('iPhone 16, iOS 18.2');
    expect(used.text).not.toContain('Android');
    const info = await t.textOf('device_info');
    expect(info.text).toContain('iPhone 16, iOS 18.2');
    expect(info.text).not.toMatch(/Android|SDK/);
  });

  it('answers an iOS system permission prompt (not only Android ones)', async () => {
    const t = await connect({}, new FakeIos());
    const home = (await t.textOf('screen')).text;
    const asked = await t.textOf('tap', { ref: refOf(home, 'İzin') });
    expect(asked.text).toContain('answer it with alert');
    const r = await t.textOf('alert', { answer: 'allow' });
    expect(r.text).toContain('"Erlauben"');
    expect(t.device.permissionUp).toBe(false);
  });

  it("names a link's Open in …? by its own words, and calls it no permission prompt", async () => {
    const d = new FakeIos();
    // a simulator asks so before an app's scheme first opens it, and its allow is the second of two buttons
    d.alertWords = ['Open in “appdyno fixture”?', 'Cancel', 'Open'];
    const t = await connect({}, d);
    const home = (await t.textOf('screen')).text;
    const asked = await t.textOf('tap', { ref: refOf(home, 'İzin') });
    expect(asked.text).toContain(
      'the system asks: Open in “appdyno fixture”? (Cancel, Open): answer it with alert',
    );
    expect(asked.text).not.toContain('permission');
  });

  it('lists what the providers list, in their order', async () => {
    const udid = '75505767-61E2-40F2-8FC6-8AFE20EE25C9';
    const t = await connect({}, new FakeDevice(), [
      { serial: udid, state: 'booted', ready: true, model: 'iOS simulator appdyno-iphone' },
      { serial: '00001234-0123456789ABCDEF', state: 'usb', ready: true, model: 'iPhone' },
    ]);
    expect((await t.textOf('list_devices')).text).toBe(
      [
        'emulator-5580 device Fake (emulator)',
        `${udid} booted iOS simulator appdyno-iphone (simulator)`,
        '00001234-0123456789ABCDEF usb iPhone (phone)',
      ].join('\n'),
    );
  });

  it('says what blocks a device, with the fix, a read that fails stops nothing, and one it may not drive is asked nothing', async () => {
    const device = new FakeDevice();
    const listing = async (need: DeviceProvider['need'], policy: Policy = DEFAULT_POLICY) => {
      const provider: DeviceProvider = {
        list: () =>
          Promise.resolve([{ serial: device.serial, state: 'device', ready: true, model: 'Fake' }]),
        handles: () => true,
        open: () => device,
        ...(need && { need }),
      };
      const ctx = new ServerContext(policy, [provider]);
      const client = await linkedClient(ctx, () => undefined);
      return (await client.callTool({ name: 'list_devices', arguments: {} })) as Result & {
        structuredContent: { devices: { blocked?: unknown }[] };
      };
    };
    const locked = await listing(() => Promise.resolve('locked'));
    expect(locked.content[0]?.text).toBe(
      `${device.serial} device Fake (emulator): The device is locked. Unlock it. The picture goes on; input stops where it asks for a passcode.`,
    );
    expect(locked.structuredContent.devices[0]?.blocked).toMatchObject({
      need: 'locked',
      title: 'The device is locked',
    });
    const failing = await listing(() => Promise.reject(new Error('no answer')));
    expect(failing.content[0]?.text).toBe(`${device.serial} device Fake (emulator)`);
    const asked = vi.fn(() => Promise.resolve('locked' as const));
    const other = await listing(asked, { ...DEFAULT_POLICY, devices: /^no-such-device$/ });
    expect(other.content[0]?.text).toBe(
      `${device.serial} device Fake (emulator) (not allowed on this server)`,
    );
    expect(asked).not.toHaveBeenCalled();
  });

  it("reads an iPhone's block while simctl still lists the simulators, and keeps the drivers' order", async () => {
    const udid = '75505767-61E2-40F2-8FC6-8AFE20EE25C9';
    let listSimulators: () => void = () => undefined;
    const simulators = simulatorProvider(
      () =>
        new Promise((done) => {
          listSimulators = () =>
            done([{ udid, name: 'appdyno-iphone', state: 'Booted', runtime: 'iOS-27-2' }]);
        }),
    );
    const devicectl = slowDevicectl(
      () => fine,
      () => ({ passcodeRequired: true }),
    );
    const phones = iphoneProvider({
      phones: () => Promise.resolve([{ udid: '00001234-0123456789ABCDEF', deviceId: 3 }]),
      devicectl: () => devicectl,
    });
    const ctx = new ServerContext(DEFAULT_POLICY, [simulators, phones]);
    const client = await linkedClient(ctx, () => undefined);
    const listing = client.callTool({ name: 'list_devices', arguments: {} }) as Promise<Result>;
    await vi.waitFor(() => expect(devicectl.log).toContain('lock done'));
    listSimulators();
    expect((await listing).content[0]?.text).toBe(
      [
        `${udid} booted iOS simulator appdyno-iphone (simulator)`,
        '00001234-0123456789ABCDEF usb iPhone (phone): The device is locked. Unlock it. The picture goes on; input stops where it asks for a passcode.',
      ].join('\n'),
    );
  });

  it('says which measure a device lacks', async () => {
    const none = new FakeDevice();
    Object.defineProperty(none, 'measure', { value: LACKS });
    const r = await (await connect({}, none)).textOf('perf_snapshot');
    expect(r).toEqual({ error: true, text: 'UNSUPPORTED: emulator-5580 cannot measure CPU' });
    const part = new FakeDevice();
    Object.defineProperty(part, 'measure', { value: { ...LACKS, cpu: part.measure.cpu } });
    const t = await connect({}, part);
    expect((await t.textOf('perf_snapshot')).text).toBe(
      'UNSUPPORTED: emulator-5580 cannot measure memory',
    );
    expect((await t.textOf('perf_trace')).text).toBe(
      'UNSUPPORTED: emulator-5580 cannot measure a frame trace',
    );
    expect((await t.textOf('perf_heap')).text).toBe(
      'UNSUPPORTED: emulator-5580 cannot measure a heap dump',
    );
  });

  it('words each measure a real device has no way of giving', async () => {
    const t = await connect();
    for (const [name, args, word] of [
      ['perf_trace', { what: 'hangs' }, 'hangs'],
      ['perf_trace', { what: 'xct_launch' }, "XCTest's metrics"],
      ['perf_scroll', { probe: true }, 'through a frame probe'],
      ['perf_heap', { profile: 'java_hprof' }, 'a heap profile'],
      ['perf_launch', { baselineProfile: true }, 'a Baseline Profile'],
    ] as const)
      expect((await t.textOf(name, args)).text).toBe(
        `UNSUPPORTED: emulator-5580 cannot measure ${word}`,
      );
  });

  describe('each measure in its own terms', () => {
    const m = <T>(value: T) => ({ value, raw: 'raw', at: '2026-11-02T00:00:00.000Z' });
    const onDevice = (measure: object, platform?: 'ios') => {
      const device = new FakeDevice();
      Object.defineProperty(device, 'measure', { value: { ...LACKS, ...measure } });
      if (platform) Object.defineProperty(device, 'platform', { value: platform });
      return connect({}, device);
    };

    it('a simulator: physical footprint, launch until the first read, a memory graph', async () => {
      const t = await onDevice(
        {
          framesByProbe: true,
          attachProbe: () => Promise.resolve(false),
          cpu: () => Promise.resolve(m({ percent: 5, windowMs: 2_000 })),
          memory: () => Promise.resolve(m({ kb: 52_429, kind: 'footprint', peakKb: 62_464 })),
          launch: (_: string, o: { mode: 'cold' | 'warm' }) =>
            Promise.resolve(
              m({
                mode: o.mode,
                samples: [{ totalMs: 100 }, { totalMs: 9_000 }, { totalMs: 8_000 }],
                medianMs: 8_000,
                until: 'the first screen is read',
              }),
            ),
          heap: (_: string, dir: string) =>
            Promise.resolve(
              m({
                file: `${dir}/x.memgraph`,
                bytes: 1_048_576,
                leaks: 3,
                leakedBytes: 192,
                kind: 'memgraph',
              }),
            ),
        },
        'ios',
      );
      const snap = (await t.textOf('perf_snapshot')).text.split('\n');
      expect(snap.slice(1, -1)).toEqual([
        'CPU: 5% (of one core, 2000 ms)',
        'memory: physical footprint 51.2 MB (peak 61.0 MB)',
        'no frame measure on a simulator without the probe',
      ]);
      const launch = (await t.textOf('perf_launch')).text.split('\n');
      expect(launch.slice(1, -2)).toEqual([
        'cold launch (until the first screen is read): 100 ms, 9000 ms, 8000 ms',
        'median: 8000 ms',
        'no limit of a slow start is rated on this platform: judge it against a baseline (perf_launch baseline: true, then perf_compare)',
      ]);
      expect(launch.at(-1)).toMatch(/^kept as one run of launch-cold, not as a baseline/);
      expect((await t.textOf('perf_heap')).text).toMatch(
        /^measurement pm-\w+\nmemory graph \(Xcode\): .*x\.memgraph \(1\.0 MB\); 3 leaks, 192 bytes$/,
      );
      expect((await t.textOf('perf_scroll')).text).toBe(
        'UNSUPPORTED: emulator-5580 cannot measure frames',
      );
      expect((await t.textOf('perf_trace')).text).toBe(
        'UNSUPPORTED: emulator-5580 cannot measure a frame trace',
      );
    });

    it('a phone: animation hitches and nothing else yet', async () => {
      const t = await onDevice({
        frameTrace: () =>
          Promise.resolve(
            m({
              kind: 'hitches',
              durationMs: 5_000,
              frames: 300,
              hitches: 2,
              hitchMs: 30,
              worstMs: 20,
              frozen: 0,
              stalls: { count: 0, worstMs: 0, totalMs: 0 },
              hitchRatio: 6,
              causes: { 'expensive commit': 2 },
              tracePath: '/t/h.trace',
            }),
          ),
      });
      expect((await t.textOf('perf_trace')).text.split('\n').slice(1)).toEqual([
        '300 frames; 2 hitches of the app, 30 ms in all, worst 20 ms; hitch ratio 6 ms/s',
        'frozen frames: 0; main thread stalled 0 times, worst 0 ms',
        'likely causes: 2× expensive commit',
        'trace (Instruments): /t/h.trace',
      ]);
      expect((await t.textOf('perf_snapshot')).text).toBe(
        'UNSUPPORTED: emulator-5580 cannot measure CPU',
      );
    });
  });

  it('brings a failure at open to the client with its cause and hint', async () => {
    const device = new FakeDevice();
    device.openError = new DeviceError(
      'AGENT_CONFLICT',
      'another client holds UI automation',
      'stop it first',
    );
    const t = await connect({}, device);
    for (const r of [
      await t.textOf('screen'),
      await t.textOf('use_device', { device: device.serial }),
    ])
      expect(r).toEqual({
        error: true,
        text: 'AGENT_CONFLICT: another client holds UI automation\nhint: stop it first',
      });
  });
});
