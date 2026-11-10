import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type DeviceProvider } from '@appdyno/core';
import { DeviceError, type Tree } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerContext } from '../src/context.js';
import { DEFAULT_POLICY, type Policy } from '../src/policy.js';
import { iosScreen, iphoneProvider, simulatorProvider } from '@appdyno/driver-apple';
import { fine, slowDevicectl } from '../../driver-apple/test/slow-devicectl.js';
import { pinchPaths, swipeLine } from '../src/gesture-paths.js';
import { FakeDevice, LACKS } from './fake-device.js';
import { linkedClient, REVISIONS, type Revision } from './helpers.js';
import { opsFor } from '../src/registry.js';

// a virtual device's numbers are noisy under host load: these answers must not depend on this Mac's
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  loadavg: () => [0, 0, 0],
}));

type Result = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
  structuredContent?: Record<string, unknown>;
};

const MEASUREMENTS = mkdtempSync(join(tmpdir(), 'appdyno-measure-'));

async function connect(
  policy: Partial<Policy> = {},
  device: FakeDevice = new FakeDevice(),
  others: Awaited<ReturnType<DeviceProvider['list']>> = [],
  revision?: Revision,
) {
  const logs: object[] = [];
  const provider: DeviceProvider = {
    list: () =>
      Promise.resolve([
        { serial: device.serial, state: 'device', ready: true, model: 'Fake' },
        ...others,
      ]),
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext({ ...DEFAULT_POLICY, ...policy }, [provider], {
    app: 'dev.app',
    measurements: MEASUREMENTS,
  });
  const client = await linkedClient(ctx, (l) => logs.push(l), undefined, revision);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as Result;
  const textOf = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(name, args);
    return { error: r.isError === true, text: r.content.map((c) => c.text ?? '').join('\n') };
  };
  return { client, call, textOf, device, logs };
}

const refOf = (screen: string, label: string) =>
  must(new RegExp(`(@[a-z0-9-]+) \\w+ "${label}"`).exec(screen)?.[1], `the ref of ${label}`);

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
        "inspector",
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
        "push",
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
      expect(t.description?.length, t.name).toBeLessThan(400);
    }
    expect(
      tools
        .filter((t) => t.annotations?.readOnlyHint)
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
      'perf_heap',
      'perf_profile',
      'perf_query',
      'perf_snapshot',
      'screen',
      'screenshot',
      'visual',
      'wait_for',
    ]);
    expect(tools.length).toBeLessThanOrEqual(48);
  });

  it('reports the server as appdyno with an icon', async () => {
    const { client } = await connect();
    const info = must(client.getServerVersion(), 'the server version');
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

  it('leaves the text its own field: no summary has a text of its own', () => {
    const ops = opsFor(new ServerContext(DEFAULT_POLICY, []));
    expect(Object.values(ops).filter((op) => 'text' in op.output.shape)).toEqual([]);
  });

  describe.each(REVISIONS)(
    'whole in the text alone and in the structured content alone, on %s',
    (revision) => {
      it('the screen, an action with its diff, log lines, and a refusal with its code and hint', async () => {
        const device = new FakeDevice();
        device.logLines = ['E/Fixture: the form failed to load'];
        const t = await connect({}, device, [], revision);
        const both = async (name: string, args: Record<string, unknown> = {}) => {
          const r = (await t.call(name, args)) as Result & {
            structuredContent?: Record<string, unknown>;
          };
          const said = r.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
          const sc = must(r.structuredContent, `${name}'s structured content`);
          expect(sc.text).toBe(said);
          return { said, sc, error: r.isError === true };
        };
        const screen = await both('screen');
        expect(screen.said).toMatch(/button "Form" \d+,\d+/);
        expect(screen.sc).toMatchObject({ elements: 3, foreground: 'dev.app' });
        const tap = await both('tap', { ref: refOf(screen.said, 'Form') });
        expect(tap.sc).toMatchObject({ screen: 'full', changed: true, settled: true });
        expect(tap.said).toContain('button "Gönder"');
        const sent = await both('tap', { ref: refOf(tap.said, 'Gönder') });
        expect(sent.sc).toMatchObject({ screen: 'diff', changes: { added: 1 }, changed: true });
        expect(sent.said).toMatch(/^screen changed: \+1 -0 ~0 .*\n\+ @[\w-]+ text "Gönderildi"/m);
        expect(await both('logs')).toMatchObject({
          said: expect.stringContaining('E/Fixture: the form failed to load') as unknown,
        });
        device.screen = 'login';
        const refusal = await both('tap', { selector: { text: 'Add' } });
        expect(refusal.error).toBe(true);
        expect(refusal.said).toMatch(
          /^AMBIGUOUS: 2 elements match .*\nhint: give the selector an index, or use a ref$/,
        );
        expect(refusal.sc).toMatchObject({
          code: 'AMBIGUOUS',
          hint: 'give the selector an index, or use a ref',
          dispatched: false,
        });
      });
    },
  );
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
    const act = must(
      t.device.calls.find((c) => c.name === 'act'),
      'a touch',
    );
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
    expect(t.device.calls.at(-1)?.args[1]).toEqual({ settle: false, read: 'none' });
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
    expect(t.device.calls.find((c) => c.name === 'typeText')?.args[0]).toMatchObject({
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
    expect(r.content[0]?.text).toContain('its pixel x,y is tapped at x × 2.348, y × 2.348');
    const again = await t.textOf('screenshot');
    expect(again).toMatchObject({ error: true });
  });

  it('turns a device failure into an error that says what to do', async () => {
    await t.textOf('screen');
    t.device.fail = new DeviceError('TIMEOUT', 'act did not answer');
    const r = await t.textOf('tap', { x: 1, y: 1 });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(
      /^TIMEOUT: act did not answer \(the touch may have been sent: .*\)\nhint: .*try again$/,
    );
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
    expect(t.device.calls.find((c) => c.name === 'openUrl')?.args).toEqual([
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
    expect(a?.[0]?.x).toBeGreaterThan(must(a?.[1], 'its second point').x);
    expect(b?.[1]?.x).toBeGreaterThan(must(b?.[0], 'its first point').x);
    const [c] = pinchPaths({ x: 540, y: 1200 }, 0.3, 400, { w: 1080, h: 2400 });
    expect(c?.[1]?.x).toBeGreaterThan(must(c?.[0], 'its first point').x);
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
    const id = must(/measurement (pm-[0-9a-f]{8})/.exec(r.text)?.[1], 'its id');
    const stored = JSON.parse(readFileSync(join(MEASUREMENTS, `${id}.json`), 'utf8')) as unknown;
    expect(stored).toMatchObject({ id, kind: 'snapshot', value: { cpu: { percent: 12.5 } } });
    expect(readFileSync(join(MEASUREMENTS, `${id}.txt`), 'utf8')).toContain('TOTAL PSS');
  });

  it('scroll: reads one round where it is asked for a reading, and three for a scenario a baseline is kept under', async () => {
    const t = await connect({}, new FakeDevice());
    const rounds = async (args: Record<string, unknown>) =>
      (((await t.call('perf_scroll', args)).structuredContent ?? {}) as { rounds?: unknown[] })
        .rounds;
    expect(await rounds({ swipes: 1 })).toHaveLength(1);
    expect(await rounds({ swipes: 1, scenario: 'feed' })).toHaveLength(3);
    expect(await rounds({ swipes: 1, repeats: 2 })).toHaveLength(2);
  });

  it("scroll: names the app's top function where it janked, from one scroll more under the profiler", async () => {
    const dev = new FakeDevice();
    const t = await connect({}, dev);
    expect((await t.textOf('perf_scroll', { swipes: 1 })).text).not.toContain('top function');
    dev.jank = 40;
    const r = (await t.call('perf_scroll', { swipes: 1 })).structuredContent as {
      findings: string[];
      rounds: unknown[];
    };
    expect(r.findings).toContain(
      "the app's top function as it scrolled: dev.app.Busy.loop, 62.1% of its samples",
    );
    expect(r.rounds).toHaveLength(1);
  });

  it('scroll: says the median of an even count of rounds to a tenth, as each round says its own', async () => {
    const dev = new FakeDevice();
    const shares = [98.13, 98.2];
    // each round's frames read the next share
    Object.defineProperty(dev, 'jank', {
      get: () => shares[dev.calls.filter((c) => c.name === 'perf.frames').length % 2],
    });
    const t = await connect({}, dev);
    const r = await t.textOf('perf_scroll', { swipes: 1, repeats: 2 });
    expect(r.text).toContain('median jank: 98.2%');
    expect(r.text).toContain('high jank: median 98.2% (threshold 10%)');
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
    const swipe = must(
      dev.calls.find((c) => c.name === 'act'),
      'a swipe',
    ).args[0] as {
      kind: string;
      from: { y: number };
      to: { y: number };
    };
    expect(swipe.kind).toBe('swipe');
    expect(swipe.to.y).toBeLessThan(swipe.from.y);
  });

  it('scroll: goes on into new rows for as long as the list moves', async () => {
    const dev = new FakeDevice();
    const t = await connect({}, dev);
    await t.textOf('perf_scroll', { swipes: 2, repeats: 3 });
    const way = (c: (typeof dev.calls)[number]) => {
      if (c.name === 'perf.frames') return 'read';
      const s = c.args[0] as { from: { y: number }; to: { y: number } };
      return s.to.y < s.from.y ? 'up' : 'down';
    };
    const seen = dev.calls.filter((c) => c.name === 'act' || c.name === 'perf.frames').map(way);
    expect(seen).toEqual(['up', 'up', 'read', 'up', 'up', 'read', 'up', 'up', 'read']);
  });

  it("scroll and trace: a probe's relaunch measures nothing, as it leaves the app on its first screen", async () => {
    const dev = new FakeDevice();
    let probed = false;
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        framesByProbe: true,
        attachProbe: () => Promise.resolve(!probed && (probed = true)),
      },
    });
    const t = await connect({}, dev);
    for (const name of ['perf_scroll', 'perf_trace']) {
      probed = false;
      const relaunched = await t.call(name);
      expect(relaunched.structuredContent).toMatchObject({
        code: 'CHECK_FAILED',
        hint: 'open the screen to measure again and call once more: the probe stays in until the app stops',
      });
      expect(relaunched.content[0]?.text).toBe(
        'CHECK_FAILED: dev.app was relaunched with the frame probe in it, and shows its first screen: nothing was measured\nhint: open the screen to measure again and call once more: the probe stays in until the app stops',
      );
      expect(dev.calls.some((c) => c.name.startsWith('perf.'))).toBe(false);
      expect((await t.call(name)).isError).toBeUndefined();
      dev.calls.length = 0;
    }
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

  it('profile: says why an iPhone app’s own functions are addresses, and what names them', async () => {
    const dev = new FakeDevice();
    const profile = {
      durationMs: 1000,
      samples: 9,
      top: [{ percent: 90, samples: 8, symbol: '0x24785fec1' }],
      appTop: [{ percent: 99, samples: 9, symbol: '0x1045377c7' }],
    };
    Object.defineProperty(dev, 'measure', {
      value: {
        ...dev.measure,
        symbolFiles: true,
        cpuProfile: () =>
          Promise.resolve({ value: profile, raw: '', at: new Date().toISOString() }),
      },
    });
    const t = await connect({}, dev);
    const bare = (await t.textOf('perf_profile', { seconds: 1 })).text;
    expect(bare).toContain("the app's own functions are addresses: no symbols of this build");
    expect(bare).toContain('DEBUG_INFORMATION_FORMAT is dwarf-with-dsym');
    const given = await t.textOf('perf_profile', { seconds: 1, dsym: '/b/App.app.dSYM' });
    expect(given.text).not.toContain('are addresses');
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
    const onDevice = (measure: object) => {
      const device = new FakeDevice();
      Object.defineProperty(device, 'measure', { value: { ...LACKS, ...measure } });
      return connect({}, device);
    };

    it('a simulator: physical footprint, launch until the first read, a memory graph', async () => {
      const t = await onDevice({
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
      });
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
