import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceProvider } from '@appdyno/core';
import { DeviceError, type Tree } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerContext } from '../src/context.js';
import { DEFAULT_POLICY, type Policy } from '../src/policy.js';
import { iosScreen } from '@appdyno/driver-apple';
import { pinchPaths, swipeLine } from '../src/gesture-paths.js';
import { FakeDevice } from './fake-device.js';
import { linkedClient } from './helpers.js';

// a virtual device's numbers are noisy under host load: these answers must not depend on this Mac's
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  loadavg: () => [0, 0, 0],
}));

type Result = { isError?: boolean; content: { type: string; text?: string; data?: string }[] };

const MEASUREMENTS = mkdtempSync(join(tmpdir(), 'appdyno-measure-'));

async function connect(
  policy: Partial<Policy> = {},
  device: FakeDevice = new FakeDevice(),
  others: Awaited<ReturnType<DeviceProvider['list']>> = [],
) {
  const logs: object[] = [];
  const provider: DeviceProvider = {
    list: async () => [
      { serial: device.serial, state: 'device', ready: true, model: 'Fake' },
      ...others,
    ],
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext({ ...DEFAULT_POLICY, ...policy }, [provider], {
    app: 'dev.app',
    measurements: MEASUREMENTS,
  });
  const client = await linkedClient(ctx, (l) => logs.push(l));
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as Result;
  const textOf = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(name, args);
    return { error: r.isError === true, text: r.content.map((c) => c.text ?? '').join('\n') };
  };
  return { client, call, textOf, device, logs };
}

const refOf = (screen: string, label: string) =>
  new RegExp(`(@[a-z0-9-]+) \\w+ "${label}"`).exec(screen)![1]!;

describe('tool list', () => {
  it('has the device tools with annotations, a title and no shell tool', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toMatchInlineSnapshot(`
      [
        "alert",
        "app",
        "assert",
        "audit",
        "clipboard",
        "crashes",
        "device_info",
        "device_setting",
        "find",
        "flow",
        "gesture",
        "hand_off",
        "keyboard",
        "launch_app",
        "list_devices",
        "logs",
        "mirror",
        "network",
        "open_link",
        "perf_compare",
        "perf_heap",
        "perf_launch",
        "perf_profile",
        "perf_query",
        "perf_scroll",
        "perf_snapshot",
        "perf_trace",
        "press_key",
        "react_native",
        "record",
        "report",
        "screen",
        "screenshot",
        "scroll_to",
        "set_location",
        "set_orientation",
        "simulator",
        "steps",
        "swipe",
        "tap",
        "terminate_app",
        "type_text",
        "use_device",
        "visual",
        "wait_for",
        "webview",
      ]
    `);
    for (const t of tools) {
      expect(t.annotations, t.name).toBeDefined();
      expect(t.outputSchema, t.name).toBeUndefined();
      expect(t.title, t.name).toBeTruthy();
      expect(t.description!.length, t.name).toBeLessThan(400);
    }
    expect(
      tools
        .filter((t) => t.annotations!.readOnlyHint)
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'assert',
      'audit',
      'crashes',
      'device_info',
      'find',
      'list_devices',
      'logs',
      'perf_compare',
      'perf_heap',
      'perf_profile',
      'perf_query',
      'perf_snapshot',
      'screen',
      'screenshot',
      'visual',
      'wait_for',
    ]);
    expect(tools.length).toBeLessThanOrEqual(46);
  });

  it('reports the server as appdyno with an icon', async () => {
    const { client } = await connect();
    const info = client.getServerVersion()!;
    expect(info.title).toBe('appdyno');
    expect((info as { icons?: unknown[] }).icons).toHaveLength(1);
  });
});

describe('structured answers', () => {
  it('every answer carries a summary that matches the tool output schema', async () => {
    const t = await connect();
    const sc = async (name: string, args: Record<string, unknown> = {}) =>
      (
        (await t.client.callTool({ name, arguments: args })) as {
          structuredContent?: Record<string, unknown>;
        }
      ).structuredContent;
    const home = (await t.textOf('screen')).text;
    expect(await sc('screen')).toMatchObject({ elements: 3, foreground: 'dev.app', warnings: [] });
    expect(await sc('tap', { ref: refOf(home, 'Form') })).toMatchObject({
      screen: 'full',
      settled: true,
      foreground: 'dev.app',
    });
    expect(await sc('tap', { x: 1, y: 1 })).toMatchObject({
      screen: 'unchanged',
      changes: { added: 0, removed: 0, changed: 0 },
    });
    expect(await sc('list_devices')).toMatchObject({
      devices: [{ serial: 'emulator-5580', allowed: true }],
    });
    expect(await sc('perf_launch')).toMatchObject({
      mode: 'cold',
      medianMs: 600,
      excessive: false,
      virtualDevice: true,
    });
    expect(await sc('find', { text: 'Gönder' })).toMatchObject({
      matches: [{ role: 'button', label: 'Gönder' }],
    });
  });
});

describe('act and read', () => {
  let t: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    t = await connect();
  });

  it('a tap by ref acts on the element centre with a settle, and answers with the diff', async () => {
    const screen = (await t.textOf('screen')).text;
    expect(screen).toContain('foreground: dev.app');
    const form = refOf(screen, 'Form');
    const r = await t.textOf('tap', { ref: form });
    expect(r.error).toBe(false);
    const act = t.device.calls.find((c) => c.name === 'act')!;
    expect(act.args[0]).toEqual({ kind: 'tap', x: 540, y: 350 });
    expect(act.args[1]).toMatchObject({ settle: { quietMs: 200, maxMs: 3000 }, read: 'tree' });
    expect((act.args[1] as { before?: string }).before).toBeDefined();
    expect(r.text).toMatch(/^tapped @\w+ "Form"/);
    // another screen: the full view comes back
    expect(r.text).toContain('"Gönder"');
  });

  it('refuses a ref that is not on the current screen', async () => {
    await t.textOf('screen');
    const r = await t.textOf('tap', { ref: '@zzzz' });
    expect(r).toMatchObject({ error: true });
    expect(r.text).toContain('stale ref');
  });

  it('answers a small change as a diff and an unchanged screen in one line', async () => {
    const home = (await t.textOf('screen')).text;
    const form = (await t.textOf('tap', { ref: refOf(home, 'Form') })).text;
    const sent = await t.textOf('tap', { ref: refOf(form, 'Gönder') });
    expect(sent.text).toContain('screen changed: +1 -0 ~0');
    expect(sent.text).toContain('+ @');
    expect(sent.text).toContain('"Gönderildi"');
    const again = await t.textOf('tap', { ref: refOf(form, 'Gönder') });
    expect(again.text).toContain('screen unchanged');
  });

  it('read none acts without a settle or a read', async () => {
    await t.textOf('screen');
    const r = await t.textOf('tap', { x: 10, y: 10, read: 'none' });
    expect(r.text).toBe('tapped 10,10');
    expect(t.device.calls.at(-1)!.args[1]).toEqual({ settle: false, read: 'none' });
  });

  it('types into a field by ref without echoing the text', async () => {
    const home = (await t.textOf('screen')).text;
    const form = (await t.textOf('tap', { ref: refOf(home, 'Form') })).text;
    const r = await t.textOf('type_text', {
      ref: refOf(form, 'Adınız'),
      text: 'İş Gören 5551234',
      replace: true,
    });
    expect(r.text).toMatch(/^typed \(16 characters\)/);
    expect(r.text).not.toContain('5551234');
    expect(t.device.typed).toEqual(['İş Gören 5551234']);
    expect(t.device.calls.find((c) => c.name === 'typeText')!.args[0]).toMatchObject({
      at: { x: 540, y: 350 },
      replace: true,
    });
  });

  it('runs steps with one read at the end, and stops at a stale ref before doing anything', async () => {
    const home = (await t.textOf('screen')).text;
    const bad = await t.textOf('steps', { steps: [{ action: 'tap', ref: '@zz99' }] });
    expect(bad.error).toBe(true);
    expect(t.device.calls.filter((c) => c.name === 'act')).toHaveLength(0);
    const r = await t.textOf('steps', {
      steps: [
        { action: 'tap', ref: refOf(home, 'Form') },
        { action: 'type_text', text: 'Ali' },
        { action: 'press_key', key: 'enter' },
      ],
    });
    expect(r.text.split('\n').slice(0, 3)).toEqual([
      '1. tapped ' + refOf(home, 'Form') + ' "Form"',
      '2. typed (3 characters)',
      '3. pressed enter',
    ]);
    const reads = t.device.calls
      .filter((c) => c.name === 'act')
      .map((c) => (c.args[1] as { read?: string }).read);
    // tap, the fake's typing, then the key with the one read
    expect(reads).toEqual(['none', 'none', 'tree']);
  });

  it('answers only a system permission prompt', async () => {
    const home = (await t.textOf('screen')).text;
    const none = await t.textOf('alert', { answer: 'allow' });
    expect(none.text).toContain('no system alert is open');
    const asked = await t.textOf('tap', { ref: refOf(home, 'İzin') });
    expect(asked.text).toContain('answer it with alert');
    const r = await t.textOf('alert', { answer: 'allow' });
    expect(r.text).toContain('"Uygulamayı kullanırken"');
    expect(t.device.permissionUp).toBe(false);
  });

  it('sends a screenshot once per screen', async () => {
    await t.textOf('screen');
    const r = await t.call('screenshot');
    expect(r.content.map((c) => c.type)).toEqual(['text', 'image']);
    expect(r.content[0]!.text).toContain('pixel × 2.348');
    const again = await t.textOf('screenshot');
    expect(again).toMatchObject({ error: true });
  });

  it('turns a device failure into an error that says what to do', async () => {
    await t.textOf('screen');
    t.device.fail = new DeviceError('TIMEOUT', 'act did not answer');
    const r = await t.textOf('tap', { x: 1, y: 1 });
    expect(r.error).toBe(true);
    expect(r.text).toContain('(TIMEOUT)');
    expect(r.text).toContain('try again');
  });
});

describe('policy', () => {
  it('refuses file, intent and script links, opens app and web links in the app', async () => {
    const t = await connect();
    for (const url of [
      'file:///sdcard/x',
      'intent://x#Intent;end',
      'javascript:alert(1)',
      'content://x',
      'nolink',
    ])
      expect((await t.textOf('open_link', { url, read: 'none' })).error, url).toBe(true);
    expect((await t.textOf('open_link', { url: 'demo://home', read: 'none' })).error).toBe(false);
    expect(t.device.calls.find((c) => c.name === 'openUrl')!.args).toEqual([
      'demo://home',
      'dev.app',
    ]);
  });

  it('keeps launches to the allowed apps and the home key off when asked', async () => {
    const t = await connect({ apps: ['dev.app'], allowHome: false });
    expect((await t.textOf('launch_app', { app: 'com.other', read: 'none' })).error).toBe(true);
    expect((await t.textOf('launch_app', { read: 'none' })).error).toBe(false);
    expect((await t.textOf('press_key', { key: 'home' })).text).toContain(
      'home is off on this server',
    );
  });

  it('drives only the allowed devices', async () => {
    const t = await connect({ devices: /^emulator-55\d\d$/ });
    expect((await t.textOf('use_device', { device: 'EXAMPLE0SERIAL00' })).error).toBe(true);
    expect((await t.textOf('use_device', { device: 'emulator-5580' })).text).toContain(
      'selected emulator-5580',
    );
    expect((await t.textOf('list_devices')).text).toContain('← selected');
  });

  it('hides secrets in what it shows and keeps them off the clipboard', async () => {
    const t = await connect({ secrets: ['Gönderildi'] });
    expect((await t.textOf('clipboard', { text: 'xGönderildix' })).error).toBe(true);
    const home = (await t.textOf('screen')).text;
    const form = (await t.textOf('tap', { ref: refOf(home, 'Form') })).text;
    const sent = (await t.textOf('tap', { ref: refOf(form, 'Gönder'), read: 'full' })).text;
    expect(sent).not.toContain('Gönderildi');
    expect(sent).toContain('•••');
  });

  it('logs tool outcomes without arguments', async () => {
    const t = await connect();
    await t.textOf('screen');
    const home = (await t.textOf('screen')).text;
    await t.textOf('type_text', { text: 'gizli-123', ref: refOf(home, 'Form') });
    expect(JSON.stringify(t.logs)).not.toContain('gizli-123');
    expect(t.logs.at(-1)).toMatchObject({ tool: 'type_text', outcome: 'ok' });
  });
});

describe('gesture geometry', () => {
  it('keeps a swipe inside the screen, `up` moving the finger up', () => {
    expect(swipeLine({ w: 1080, h: 2400 }, { direction: 'up' })).toEqual({
      from: { x: 540, y: 1200 },
      to: { x: 540, y: 240 },
    });
    expect(
      swipeLine({ w: 1080, h: 2400 }, { direction: 'right', x: 1000, distance: 500 }).to.x,
    ).toBe(1079);
  });

  it('spreads two fingers apart to zoom in and together to zoom out', () => {
    const [a, b] = pinchPaths({ x: 540, y: 1200 }, 3, 400, { w: 1080, h: 2400 });
    expect(a![0]!.x).toBeGreaterThan(a![1]!.x);
    expect(b![1]!.x).toBeGreaterThan(b![0]!.x);
    const [c] = pinchPaths({ x: 540, y: 1200 }, 0.3, 400, { w: 1080, h: 2400 });
    expect(c![1]!.x).toBeGreaterThan(c![0]!.x);
  });
});

describe('perf tools', () => {
  it('snapshot: CPU, memory, frames and the device, with the raw output stored under its id', async () => {
    const t = await connect();
    const r = await t.textOf('perf_snapshot');
    expect(r.error).toBe(false);
    expect(r.text).toContain('virtual device: relative');
    expect(r.text).toContain('CPU: 12.5%');
    expect(r.text).toContain('janky 4%');
    const id = /measurement (pm-[0-9a-f]{8})/.exec(r.text)![1];
    const stored = JSON.parse(readFileSync(join(MEASUREMENTS, `${id}.json`), 'utf8'));
    expect(stored).toMatchObject({ id, kind: 'snapshot', value: { cpu: { percent: 12.5 } } });
    expect(readFileSync(join(MEASUREMENTS, `${id}.txt`), 'utf8')).toContain('TOTAL PSS');
  });

  it('scroll: each round resets frames, swipes, reads; jank over the threshold and memory growth are said', async () => {
    const dev = new FakeDevice();
    dev.jank = 25;
    const t = await connect({}, dev);
    const r = await t.textOf('perf_scroll', { swipes: 2, repeats: 3 });
    expect(r.text).toContain('median jank: 25%');
    expect(r.text).toContain('high jank');
    const order = dev.calls.map((c) => c.name).filter((n) => n.startsWith('perf') || n === 'act');
    expect(order.slice(0, 6)).toEqual([
      'perf.memory',
      'perf.reset',
      'act',
      'act',
      'perf.frames',
      'perf.memory',
    ]);
    const swipe = dev.calls.find((c) => c.name === 'act')!.args[0] as {
      kind: string;
      from: { y: number };
      to: { y: number };
    };
    expect(swipe.kind).toBe('swipe');
    expect(swipe.to.y).toBeLessThan(swipe.from.y);
  });

  it('launch: the median against the vitals threshold; only allowed apps', async () => {
    const t = await connect({ apps: ['dev.app'] });
    const r = await t.textOf('perf_launch', { mode: 'cold' });
    expect(r.text).toContain('median: 600 ms');
    expect(r.text).not.toContain('excessive');
    expect((await t.textOf('perf_launch', { app: 'com.other' })).error).toBe(true);
  });

  it('profile: the functions taking the CPU; heap: the dump file stays here', async () => {
    const t = await connect();
    expect((await t.textOf('perf_profile', { seconds: 2 })).text).toContain(
      '%62.1 dev.app.Busy.loop',
    );
    expect((await t.textOf('perf_heap')).text).toMatch(
      /heap dump: .*heap-dev\.app-\d+\.hprof \(60\.0 MB\)/,
    );
  });

  it('trace: the frame timeline summary', async () => {
    const t = await connect();
    const r = await t.textOf('perf_trace', { seconds: 2 });
    expect(r.text).toContain('50 frames; late by the app 4 (8%)');
    expect(r.text).toContain('frozen frames: 1');
    expect(r.text).toContain("on a virtual device the compositor's jank");
  });
});

/** The fake app on an iOS simulator; its permission prompt is the home screen app's Alert (German labels). */
class FakeIos extends FakeDevice {
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
        t.windows[0]!,
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
          d: 'Mitteilungen erlauben?',
          b: [60, 800, 342, 1150] as [number, number, number, number],
          f: 17,
        },
        {
          p: app.length,
          w: 1,
          c: 'Button',
          d: 'Nicht erlauben',
          b: [60, 1000, 200, 1100] as [number, number, number, number],
          f: 19,
        },
        {
          p: app.length,
          w: 1,
          c: 'Button',
          d: 'Erlauben',
          b: [202, 1000, 342, 1100] as [number, number, number, number],
          f: 19,
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

  it('lists what the providers list, in their order', async () => {
    const udid = '75505767-61E2-40F2-8FC6-8AFE20EE25C9';
    const t = await connect({}, new FakeDevice(), [
      { serial: udid, state: 'booted', ready: true, model: 'iOS simulator appdyno-iphone' },
      { serial: '00001234-0123456789ABCDEF', state: 'usb', ready: true, model: 'iPhone' },
    ]);
    expect((await t.textOf('list_devices')).text).toBe(
      [
        'emulator-5580 device Fake',
        `${udid} booted iOS simulator appdyno-iphone`,
        '00001234-0123456789ABCDEF usb iPhone',
      ].join('\n'),
    );
  });

  it('says which measure a device lacks', async () => {
    const none = new FakeDevice();
    Object.defineProperty(none, 'measure', { value: undefined });
    const r = await (await connect({}, none)).textOf('perf_snapshot');
    expect(r).toEqual({ error: true, text: 'emulator-5580 cannot measure CPU' });
    const part = new FakeDevice();
    Object.defineProperty(part, 'measure', { value: { cpu: part.measure.cpu } });
    const t = await connect({}, part);
    expect((await t.textOf('perf_snapshot')).text).toBe('emulator-5580 cannot measure memory');
    expect((await t.textOf('perf_trace')).text).toBe('emulator-5580 cannot measure a frame trace');
    expect((await t.textOf('perf_heap')).text).toBe('emulator-5580 cannot measure a heap dump');
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
      expect((await t.textOf(name, args)).text).toBe(`emulator-5580 cannot measure ${word}`);
  });

  describe('each measure in its own terms', () => {
    const m = <T>(value: T) => ({ value, raw: 'raw', at: '2026-11-02T00:00:00.000Z' });
    const onDevice = (measure: object) => {
      const device = new FakeDevice();
      Object.defineProperty(device, 'measure', { value: measure });
      return connect({}, device);
    };

    it('a simulator: physical footprint, launch until the first read, a memory graph', async () => {
      const t = await onDevice({
        cpu: async () => m({ percent: 5, windowMs: 2_000 }),
        memory: async () => m({ kb: 52_429, kind: 'footprint', peakKb: 62_464 }),
        launch: async (_: string, o: { mode: 'cold' | 'warm' }) =>
          m({
            mode: o.mode,
            samples: [{ totalMs: 100 }, { totalMs: 9_000 }, { totalMs: 8_000 }],
            medianMs: 8_000,
            until: 'the first screen is read',
          }),
        heap: async (_: string, dir: string) =>
          m({
            file: `${dir}/x.memgraph`,
            bytes: 1_048_576,
            leaks: 3,
            leakedBytes: 192,
            kind: 'memgraph',
          }),
      });
      const snap = (await t.textOf('perf_snapshot')).text.split('\n');
      expect(snap.slice(1, -1)).toEqual([
        'CPU: 5% (of one core, 2000 ms)',
        'memory: physical footprint 51.2 MB (peak 61.0 MB)',
        'no frame measure on a simulator without the probe',
      ]);
      const launch = (await t.textOf('perf_launch')).text.split('\n');
      expect(launch.slice(1, -1)).toEqual([
        'cold launch (until the first screen is read): 100 ms, 9000 ms, 8000 ms',
        'median: 8000 ms',
      ]);
      expect((await t.textOf('perf_heap')).text).toMatch(
        /^measurement pm-\w+\nmemory graph \(Xcode\): .*x\.memgraph \(1\.0 MB\); 3 leaks, 192 bytes$/,
      );
      expect((await t.textOf('perf_scroll')).text).toBe('emulator-5580 cannot measure frames');
      expect((await t.textOf('perf_trace')).text).toBe(
        'emulator-5580 cannot measure a frame trace',
      );
    });

    it('a phone: animation hitches and nothing else yet', async () => {
      const t = await onDevice({
        frameTrace: async () =>
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
      });
      expect((await t.textOf('perf_trace')).text.split('\n').slice(1)).toEqual([
        '300 frames; 2 hitches of the app, 30 ms in all, worst 20 ms; hitch ratio 6 ms/s',
        'frozen frames: 0; main thread stalled 0 times, worst 0 ms',
        'likely causes: 2× expensive commit',
        'trace (Instruments): /t/h.trace',
      ]);
      expect((await t.textOf('perf_snapshot')).text).toBe('emulator-5580 cannot measure CPU');
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
        text: 'another client holds UI automation (AGENT_CONFLICT): stop it first',
      });
  });
});
