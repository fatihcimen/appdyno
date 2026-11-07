import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toolCaller } from './helpers.js';
import { IosSimulatorDevice } from './workspace.js';

/**
 * Pushes as an MCP client sends them, through the built server over stdio, to the fixture: on the emulator
 * APPDYNO_ANDROID_SERIAL names and the simulator APPDYNO_IOS_UDID names. What reached the app's code is read from
 * the fixture's own screen, which shows it.
 */
const APP = 'dev.appdyno.fixture';
const MAIN = fileURLToPath(new URL('../packages/appdyno/dist/main.js', import.meta.url));
const PICTURE = fileURLToPath(new URL('../docs/images/social.png', import.meta.url));
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const SIMULATOR = process.env.APPDYNO_IOS_UDID;

function server(serial: string) {
  let client: Client;
  const call = toolCaller(() => client);
  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [MAIN, 'mcp', '--device', serial, '--app', APP, '--allow-devices', `^${serial}$`],
      env: process.env as Record<string, string>,
      stderr: 'pipe',
    });
    client = new Client({ name: 'push-test', version: '0' });
    await client.connect(transport);
  });
  afterAll(() => client?.close());
  return call;
}

describe.skipIf(!ANDROID)('a push to an Android emulator, over MCP', () => {
  const call = server(ANDROID!);
  const drawn = () =>
    execFileSync('adb', ['-s', ANDROID!, 'shell', 'cmd notification list'], { encoding: 'utf8' });

  it('says which types it takes, and how', async () => {
    const r = await call('push');
    expect(r.text).toContain('tapped: the launcher activity');
    expect(r.text).toContain(
      'background: no: a data message reaches the app only as onMessageReceived',
    );
  });

  it('draws each style, and says the app got nothing', async () => {
    const before = drawn().split('\n').length;
    const alert = await call('push', { type: 'alert', title: 'Order 42', body: 'shipped' });
    expect(alert.text).toMatch(
      /^drawn by the shell in the bigtext style, not by dev\.appdyno\.fixture/,
    );
    for (const [type, extra] of [
      ['rich', { image: PICTURE }],
      ['inbox', { body: 'one\ntwo' }],
      ['messaging', { body: 'Ada: hi\nBo: hello' }],
      ['media', {}],
    ] as const) {
      const r = await call('push', { type, title: type, ...extra });
      expect(r.error ? r.text : '', type).toBe('');
    }
    expect(drawn()).toContain(`appdyno-${APP}`);
    expect(drawn().split('\n').length).toBeGreaterThanOrEqual(before);
  });

  it('opens the app as a tapped push, its data in the extras', async () => {
    const order = String(Date.now());
    const r = await call('push', { type: 'tapped', data: { order, kind: 'shipped' } });
    expect(r.text).toMatch(
      /^opened dev\.appdyno\.fixture as a tapped push, with 2 data keys as extras/,
    );
    // the answer is the screen after, where the app wrote what it was given
    expect(r.text).toContain(`extras: kind=shipped, order=${order}`);
  });

  it('lists the links the app opens, with its App Link as Android verified it', async () => {
    const r = await call('open_link', { links: APP });
    // the state is the verifier's, and it moves: none just after an install, a number of its own once it has tried
    expect(r.text).toMatch(
      /^filter appdyno-fixture:\/\/open\nfilter https:\/\/example\.com\/order\*\napp link example\.com: \w+$/,
    );
  });

  it('refuses what only Google could send, and says why', async () => {
    const r = await call('push', { type: 'background', data: { a: 'b' } });
    expect(r.error).toBe(true);
    expect(r.text).toContain("needs Google's servers");
  });
});

describe.skipIf(!SIMULATOR)('a push to a simulator, over MCP', () => {
  const call = server(SIMULATOR!);
  afterAll(() => new IosSimulatorDevice(SIMULATOR!).stopAgent());
  const last = async () => (await call('find', { id: 'push_last' })).text.match(/"([^"]*)"/)?.[1];

  it('says which types it takes, and how', async () => {
    const r = await call('push');
    expect(r.text).toContain("alert: simctl push: the app's code gets it");
    expect(r.text).toContain('tapped: no: simctl taps nothing');
  });

  it("reaches the app's code with an alert, data and all, and refuses a background push", async () => {
    await call('launch_app');
    await call('open_link', { url: 'appdyno-fixture://open/push' });
    await call('tap', { selector: { id: 'ask_notifications' } });
    // the first time it asks
    await call('alert', { answer: 'allow' });
    const alert = await call('push', { type: 'alert', title: 'Order 42', data: { order: '42' } });
    expect(alert.text).toMatch(/^pushed to dev\.appdyno\.fixture by simctl/);
    await call('wait_for', { text: 'alert Order 42: order=42', timeoutMs: 8_000 });
    expect(await last()).toBe('alert Order 42: order=42');
    // APNs' own payload, with a badge, a sound and a category of actions
    const payload = {
      aps: { alert: { title: 'Raw' }, badge: 3, sound: 'default', category: 'order' },
      order: '7',
    };
    await call('push', { type: 'alert', payload: JSON.stringify(payload) });
    await call('wait_for', { text: 'alert Raw: order=7', timeoutMs: 8_000 });
    expect(await last()).toBe('alert Raw: order=7');
    // the simulator takes no push with nothing to see
    const quiet = await call('push', { type: 'background', data: { sync: '7' } });
    expect(quiet.text).toContain('simctl takes no push with nothing to see');
  });

  it('refuses a payload with no aps, and an Android style', async () => {
    const bad = await call('push', { type: 'alert', payload: '{"x":1}' });
    expect(bad.text).toContain('an APNs payload has aps: an object');
    const style = await call('push', { type: 'inbox', body: 'a' });
    expect(style.text).toContain('an Android style');
  });

  it('lists the links the app opens, read from it', async () => {
    const r = await call('open_link', { links: APP });
    expect(r.text).toBe('scheme appdyno-fixture://');
  });
});
