import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DeviceError } from 'appdyno';
import { beforeEach, describe, expect, it } from 'vitest';
import { ServerContext } from '../src/context.js';
import { DEFAULT_POLICY, type Policy } from '../src/policy.js';
import { createServer } from '../src/server.js';
import { createTools, pinchPaths, swipeLine } from '../src/tools.js';
import { FakeDevice } from './fake-device.js';

type Result = { isError?: boolean; content: { type: string; text?: string; data?: string }[] };

const MEASUREMENTS = mkdtempSync(join(tmpdir(), 'gd-measure-'));

async function connect(policy: Partial<Policy> = {}, device = new FakeDevice()) {
  const logs: object[] = [];
  const adb = {
    devices: async () => [{ serial: device.serial, state: 'device', props: { model: 'Fake' } }],
  };
  const ctx = new ServerContext(
    { ...DEFAULT_POLICY, ...policy },
    adb,
    { app: 'dev.app', measurements: MEASUREMENTS },
    () => device,
  );
  const server = createServer(createTools(ctx), (l) => logs.push(l));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
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
        "device_info",
        "dismiss_alert",
        "find",
        "launch_app",
        "list_devices",
        "long_press",
        "open_link",
        "perf_launch",
        "perf_scroll",
        "perf_snapshot",
        "perf_trace",
        "pinch",
        "press_key",
        "screen",
        "screenshot",
        "set_clipboard",
        "set_location",
        "set_orientation",
        "steps",
        "swipe",
        "tap",
        "terminate_app",
        "type_text",
        "use_device",
        "wait_for",
      ]
    `);
    for (const t of tools) {
      expect(t.annotations, t.name).toBeDefined();
      expect(t.title, t.name).toBeTruthy();
      expect(t.description!.length, t.name).toBeLessThan(400);
    }
    expect(
      tools
        .filter((t) => t.annotations!.readOnlyHint)
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'device_info',
      'find',
      'list_devices',
      'perf_snapshot',
      'screen',
      'screenshot',
      'wait_for',
    ]);
    expect(tools.length).toBeLessThanOrEqual(30);
  });

  it('reports the server as appdyno with an icon', async () => {
    const { client } = await connect();
    const info = client.getServerVersion()!;
    expect(info.title).toBe('appdyno');
    expect((info as { icons?: unknown[] }).icons).toHaveLength(1);
  });
});

describe('act and read', () => {
  let t: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    t = await connect();
  });

  it('a tap by ref acts on the element centre with a settle, and answers with the diff', async () => {
    const screen = (await t.textOf('screen')).text;
    expect(screen).toContain('ön planda: dev.app');
    const form = refOf(screen, 'Form');
    const r = await t.textOf('tap', { ref: form });
    expect(r.error).toBe(false);
    const act = t.device.calls.find((c) => c.name === 'act')!;
    expect(act.args[0]).toEqual({ kind: 'tap', x: 540, y: 350 });
    expect(act.args[1]).toMatchObject({ settle: { quietMs: 250, maxMs: 3000 }, read: 'tree' });
    expect((act.args[1] as { before?: string }).before).toBeDefined();
    expect(r.text).toMatch(/^dokunuldu @\w+ "Form"/);
    // another screen: the full view comes back
    expect(r.text).toContain('"Gönder"');
  });

  it('refuses a ref that is not on the current screen', async () => {
    await t.textOf('screen');
    const r = await t.textOf('tap', { ref: '@zzzz' });
    expect(r).toMatchObject({ error: true });
    expect(r.text).toContain('ref eskidi');
  });

  it('answers a small change as a diff and an unchanged screen in one line', async () => {
    const home = (await t.textOf('screen')).text;
    const form = (await t.textOf('tap', { ref: refOf(home, 'Form') })).text;
    const sent = await t.textOf('tap', { ref: refOf(form, 'Gönder') });
    expect(sent.text).toContain('ekran değişti: +1 -0 ~0');
    expect(sent.text).toContain('+ @');
    expect(sent.text).toContain('"Gönderildi"');
    const again = await t.textOf('tap', { ref: refOf(form, 'Gönder') });
    expect(again.text).toContain('ekran değişmedi');
  });

  it('read none acts without a settle or a read', async () => {
    await t.textOf('screen');
    const r = await t.textOf('tap', { x: 10, y: 10, read: 'none' });
    expect(r.text).toBe('dokunuldu 10,10');
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
    expect(r.text).toMatch(/^yazıldı \(16 karakter\)/);
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
      '1. dokunuldu ' + refOf(home, 'Form') + ' "Form"',
      '2. yazıldı (3 karakter)',
      '3. enter tuşuna basıldı',
    ]);
    const reads = t.device.calls
      .filter((c) => c.name === 'act')
      .map((c) => (c.args[1] as { read?: string }).read);
    // tap, the fake's typing, then the key with the one read
    expect(reads).toEqual(['none', 'none', 'tree']);
  });

  it('answers only a system permission prompt', async () => {
    const home = (await t.textOf('screen')).text;
    const none = await t.textOf('dismiss_alert');
    expect(none.text).toContain('açık sistem izin penceresi yok');
    const asked = await t.textOf('tap', { ref: refOf(home, 'İzin') });
    expect(asked.text).toContain('dismiss_alert ile yanıtla');
    const r = await t.textOf('dismiss_alert');
    expect(r.text).toContain('"Uygulamayı kullanırken"');
    expect(t.device.permissionUp).toBe(false);
  });

  it('sends a screenshot once per screen', async () => {
    await t.textOf('screen');
    const r = await t.call('screenshot');
    expect(r.content.map((c) => c.type)).toEqual(['text', 'image']);
    expect(r.content[0]!.text).toContain('piksel × 2.348');
    const again = await t.textOf('screenshot');
    expect(again).toMatchObject({ error: true });
  });

  it('turns a device failure into an error that says what to do', async () => {
    await t.textOf('screen');
    t.device.fail = new DeviceError('TIMEOUT', 'act did not answer');
    const r = await t.textOf('tap', { x: 1, y: 1 });
    expect(r.error).toBe(true);
    expect(r.text).toContain('(TIMEOUT)');
    expect(r.text).toContain('tekrar dene');
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
    expect((await t.textOf('open_link', { url: 'appdyno://home', read: 'none' })).error).toBe(false);
    expect(t.device.calls.find((c) => c.name === 'openUrl')!.args).toEqual([
      'appdyno://home',
      'dev.app',
    ]);
  });

  it('keeps launches to the allowed apps and the home key off when asked', async () => {
    const t = await connect({ apps: ['dev.app'], allowHome: false });
    expect((await t.textOf('launch_app', { app: 'com.other', read: 'none' })).error).toBe(true);
    expect((await t.textOf('launch_app', { read: 'none' })).error).toBe(false);
    expect((await t.textOf('press_key', { key: 'home' })).text).toContain(
      'home bu sunucuda kapalı',
    );
  });

  it('drives only the allowed devices', async () => {
    const t = await connect({ devices: /^emulator-55\d\d$/ });
    expect((await t.textOf('use_device', { device: 'EXAMPLE0SERIAL00' })).error).toBe(true);
    expect((await t.textOf('use_device', { device: 'emulator-5580' })).text).toContain(
      'seçildi emulator-5580',
    );
    expect((await t.textOf('list_devices')).text).toContain('← seçili');
  });

  it('hides secrets in what it shows and keeps them off the clipboard', async () => {
    const t = await connect({ secrets: ['Gönderildi'] });
    expect((await t.textOf('set_clipboard', { text: 'xGönderildix' })).error).toBe(true);
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
    expect(r.text).toContain('sanal cihaz: göreli');
    expect(r.text).toContain('CPU: %12.5');
    expect(r.text).toContain('takılan %4');
    const id = /ölçüm (pm-[0-9a-f]{8})/.exec(r.text)![1];
    const stored = JSON.parse(readFileSync(join(MEASUREMENTS, `${id}.json`), 'utf8'));
    expect(stored).toMatchObject({ id, kind: 'snapshot', value: { cpu: { percent: 12.5 } } });
    expect(readFileSync(join(MEASUREMENTS, `${id}.txt`), 'utf8')).toContain('TOTAL PSS');
  });

  it('scroll: each round resets frames, swipes, reads; jank over the threshold and memory growth are said', async () => {
    const dev = new FakeDevice();
    dev.jank = 25;
    const t = await connect({}, dev);
    const r = await t.textOf('perf_scroll', { swipes: 2, repeats: 3 });
    expect(r.text).toContain('medyan takılma: %25');
    expect(r.text).toContain('takılma yüksek');
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
    expect(r.text).toContain('medyan: 600 ms');
    expect(r.text).not.toContain('aşırı');
    expect((await t.textOf('perf_launch', { app: 'com.other' })).error).toBe(true);
  });

  it('trace: the frame timeline summary', async () => {
    const t = await connect();
    const r = await t.textOf('perf_trace', { seconds: 2 });
    expect(r.text).toContain('50 kare; uygulamanın geciktirdiği 4 (%8)');
    expect(r.text).toContain('sanal cihazda birleştirici');
  });
});
