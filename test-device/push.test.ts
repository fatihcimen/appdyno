import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

/** The server on that device, with the fixture named as its app unless `named` is false, as in a window. */
function server(serial: string, named = true, env: Record<string, string> = {}) {
  let client: Client;
  const call = toolCaller(() => client);
  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        MAIN,
        'mcp',
        '--device',
        serial,
        ...(named ? ['--app', APP] : []),
        '--allow-devices',
        `^${serial}$`,
      ],
      env: { ...(process.env as Record<string, string>), ...env },
      stderr: 'pipe',
    });
    client = new Client({ name: 'push-test', version: '0' });
    await client.connect(transport);
  });
  afterAll(() => client?.close());
  return call;
}

/**
 * To a simulator's home screen. A banner over the app takes the first press, and so does the end of a link's opening:
 * then a second goes home.
 */
async function goHome(call: ReturnType<typeof toolCaller>) {
  const home = async () =>
    (await call('press_key', { key: 'home' })).text.includes('foreground: com.apple.springboard');
  if (!(await home())) expect(await home()).toBe(true);
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
      /^filter appdyno-fixture:\/\/open\nfilter https:\/\/example\.com\/order\*\ndomain https:\/\/example\.com: \w+$/,
    );
    expect(r.data.links).toContainEqual({ url: 'appdyno-fixture://open', kind: 'filter' });
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
    expect(r.text).toContain('live_activity: no: simctl push makes a notification');
  });

  it("reaches the app's code with an alert, data and all, and refuses a background push", async () => {
    await call('launch_app');
    await call('open_link', { url: 'appdyno-fixture://open/push' });
    await call('tap', { selector: { id: 'ask_notifications' } });
    // the first time it asks, and its prompt may come after the tap's answer
    await call('wait_for', { text: 'Would Like to Send You Notifications', timeoutMs: 5_000 });
    await call('alert', { answer: 'allow' });
    const alert = await call('push', { type: 'alert', title: 'Order 42', data: { order: '42' } });
    expect(alert.text).toMatch(/^pushed to dev\.appdyno\.fixture by simctl: it is in front/);
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

  it('says a push to an app in the background or not running is only shown, and its code got nothing', async () => {
    await goHome(call);
    const back = await call('push', { type: 'alert', title: 'Back', data: { order: '8' } });
    expect(back.text).toMatch(
      /^pushed to dev\.appdyno\.fixture by simctl: it is in the background/,
    );
    // brought back as it was, not by the banner: its code still has the push before
    await call('launch_app');
    expect(await last()).toBe('alert Raw: order=7');
    await call('terminate_app');
    const off = await call('push', { type: 'alert', title: 'Off' });
    expect(off.text).toMatch(/^pushed to dev\.appdyno\.fixture by simctl: it is not running/);
    await call('launch_app');
    await call('open_link', { url: 'appdyno-fixture://open/push' });
    expect(await last()).toBe('none');
  });

  it('refuses a payload with no aps, an Android style, and an extension simctl never runs', async () => {
    const bad = await call('push', { type: 'alert', payload: '{"x":1}' });
    expect(bad.text).toContain('an APNs payload has aps: an object');
    const style = await call('push', { type: 'inbox', body: 'a' });
    expect(style.text).toContain('an Android style');
    const rich = await call('push', { type: 'rich', title: 'Rich', image: PICTURE });
    expect(rich.text).toContain('simctl push runs no Notification Service Extension');
  });

  it('lists the links the app opens, read from it', async () => {
    const r = await call('open_link', { links: APP });
    expect(r.text).toBe('scheme appdyno-fixture://');
    expect(r.data.links).toEqual([{ url: 'appdyno-fixture://', kind: 'scheme' }]);
  });
});

describe.skipIf(!SIMULATOR)('a simulator with no app named, over MCP', () => {
  const call = server(SIMULATOR!, false);
  afterAll(() => new IosSimulatorDevice(SIMULATOR!).stopAgent());

  it('reads the app a link brought back, with a runner up, and a push says it was in front', async () => {
    await call('open_link', { url: 'appdyno-fixture://open/push' });
    // a runner, which with no app named would read the home screen whatever is up
    expect((await call('audit', { maxIssues: 1 })).error).toBe(false);
    await goHome(call);
    const back = await call('open_link', { url: 'appdyno-fixture://open/push' });
    expect(back.text).toContain(`foreground: ${APP}`);
    expect((await call('screen')).text).toContain(`foreground: ${APP}`);
    const pushed = await call('push', { app: APP, type: 'alert', title: 'Linked' });
    expect(pushed.text).toMatch(/^pushed to dev\.appdyno\.fixture by simctl: it is in front/);
  });
});

/**
 * A push service's credentials made up here, in a state folder of the suite's own, so that this Mac's own is never read:
 * no team or project owns them, and the fixtures print no token, so each push is refused before anything leaves.
 */
function madeUp(service: 'apns' | 'fcm') {
  const state = mkdtempSync(join(tmpdir(), 'appdyno-push-suite-'));
  mkdirSync(join(state, 'push'), { mode: 0o700 });
  const pem = (type: 'ec' | 'rsa') =>
    (type === 'ec'
      ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      : generateKeyPairSync('rsa', { modulusLength: 2048 })
    ).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const made =
    service === 'apns'
      ? { key: pem('ec'), keyId: 'AAAAAAAAAA', teamId: 'BBBBBBBBBB', production: false }
      : {
          projectId: 'made-up-project',
          clientEmail: 'push@made-up-project.iam.gserviceaccount.com',
          keyId: 'k1',
          key: pem('rsa'),
        };
  writeFileSync(join(state, 'push', `${service}.json`), JSON.stringify(made), { mode: 0o600 });
  return { APPDYNO_STATE_DIR: state };
}

describe.skipIf(!SIMULATOR)('a simulator with APNs set up, over MCP', () => {
  const call = server(SIMULATOR!, true, madeUp('apns'));
  afterAll(() => new IosSimulatorDevice(SIMULATOR!).stopAgent());

  it("takes what simctl cannot by APNs' sandbox, and only by a token the app printed in this session", async () => {
    const types = (await call('push')).text;
    expect(types).toContain(
      "rich: APNs' sandbox, by the device token the app printed in this session",
    );
    expect(types).toContain("live_activity: APNs' sandbox, by the activity token");
    expect(types).toContain('alert: simctl push');
    const rich = await call('push', { type: 'rich', title: 'R' });
    expect(rich.text).toContain(`no device token from ${APP} in this session (NOT_FOUND)`);
    expect(rich.text).toContain('by NSLog or os_log');
  });

  it("refuses a Live Activity's payload that is not ActivityKit's, VoIP the app does not declare, and an app not there", async () => {
    const update = JSON.stringify({ aps: { event: 'update' } });
    expect((await call('push', { type: 'live_activity', payload: update })).text).toContain(
      "a Live Activity's aps.content-state is an object",
    );
    expect((await call('push', { type: 'voip' })).text).toContain('not known to declare VoIP');
    expect((await call('push', { type: 'background', app: 'dev.not.here' })).text).toContain(
      'dev.not.here is not installed on this simulator',
    );
  });
});

describe.skipIf(!ANDROID)('an Android emulator with FCM set up, over MCP', () => {
  const call = server(ANDROID!, true, madeUp('fcm'));

  it('takes what only Google delivers by FCM, by a token the app printed in this session, and nothing aimed elsewhere', async () => {
    const types = (await call('push')).text;
    expect(types).toContain('background: FCM, data alone');
    expect(types).toContain('alert: FCM, a notification');
    expect(types).toContain('inbox: drawn by the shell');
    await call('launch_app');
    const quiet = await call('push', { type: 'background', data: { sync: '7' } });
    expect(quiet.text).toContain(`no registration token from ${APP} in this session (NOT_FOUND)`);
    const topic = await call('push', { type: 'alert', payload: JSON.stringify({ topic: 'news' }) });
    expect(topic.text).toContain('an FCM payload names no topic');
    const away = await call('push', { type: 'alert', app: 'dev.not.here' });
    expect(away.text).toContain('dev.not.here is not installed on this device');
  });
});
