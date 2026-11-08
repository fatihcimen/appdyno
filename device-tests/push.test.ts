import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { madeUp, toolCaller } from './helpers.js';
import { IosSimulatorDevice } from './workspace.js';

/**
 * Pushes as an MCP client sends them, through the built server over stdio, to the fixture: on the emulator
 * APPDYNO_ANDROID_SERIAL names and the simulator APPDYNO_IOS_UDID names. What reached the app's code is read from
 * the fixture's own screen, which shows it, and from the push fixture's log, which says what Firebase handed it.
 */
const APP = 'dev.appdyno.fixture';
const PUSH_APP = 'dev.appdyno.pushfixture';
const MAIN = fileURLToPath(new URL('../packages/appdyno/dist/main.js', import.meta.url));
const PICTURE = fileURLToPath(new URL('../docs/images/social.png', import.meta.url));
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const SIMULATOR = process.env.APPDYNO_IOS_UDID;

/** The server on that device, with `app` named as its app, or none, as in a window. */
function server(serial: string, app: string | undefined = APP, env: Record<string, string> = {}) {
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
        ...(app ? ['--app', app] : []),
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

/** To a simulator's home screen, by one press, over a banner or just after a link: it answers once the app has gone. */
async function goHome(call: ReturnType<typeof toolCaller>) {
  const r = await call('press_key', { key: 'home' });
  expect([r.data.foreground, r.data.changed]).toEqual(['com.apple.springboard', true]);
}

describe.skipIf(!ANDROID)('a push to an Android emulator, over MCP', () => {
  const call = server(ANDROID!);
  /** The notifications the shell posted, which would be no app's own. */
  const byShell = () =>
    execFileSync('adb', ['-s', ANDROID!, 'shell', 'cmd notification list'], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.includes('|com.android.shell|')).length;

  it('says which types it takes, and how', async () => {
    const r = await call('push');
    expect(r.text).toContain('tapped: the launcher activity');
    expect(r.text).toContain(
      "background: no: dev.appdyno.fixture has no Firebase Messaging, which takes FCM's own message",
    );
    expect(r.text).toContain('inbox: no: an Android app draws its inbox style itself');
  });

  it('refuses every push but a tap to an app with no Firebase Messaging, saying why, and draws none of its own', async () => {
    const before = byShell();
    for (const [type, extra] of [
      ['alert', { body: 'shipped' }],
      ['rich', { image: 'https://example.com/p.png' }],
      ['background', {}],
      ['live_activity', {}],
    ] as const) {
      const r = await call('push', { type, title: type, ...extra });
      expect(r.error, type).toBe(true);
      expect(r.text, type).toContain('dev.appdyno.fixture has no Firebase Messaging');
    }
    for (const type of ['inbox', 'messaging', 'media'] as const) {
      const r = await call('push', { type, title: type, body: 'a' });
      expect(r.text, type).toContain(`draws its ${type} style itself`);
    }
    expect(byShell()).toBe(before);
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
});

describe.skipIf(!ANDROID)("FCM's own message to the push fixture on an emulator, over MCP", () => {
  const call = server(ANDROID!, PUSH_APP);
  const adb = (...words: string[]) =>
    execFileSync('adb', ['-s', ANDROID!, ...words], { encoding: 'utf8' });
  // a mark in the fixture's own log before each push, as clearing the log would clear it for all on a shared phone
  let mark = '';
  /** What the fixture's code was handed since the last push, a line a message. */
  const received = () => {
    const lines = adb('logcat', '-d', '-s', 'PushFixture:I').split('\n');
    return lines
      .slice(lines.findLastIndex((l) => l.includes(mark)) + 1)
      .filter((l) => l.includes('onMessageReceived'));
  };
  const pushed = async (args: Record<string, unknown>) => {
    mark = `push ${Date.now()}`;
    adb('shell', 'log', '-t', 'PushFixture', '-p', 'i', `'${mark}'`);
    const r = await call('push', args);
    expect(r.error ? r.text : '', String(args.type)).toBe('');
    return r.text;
  };
  /** In front with the screen on: a locked screen counts as away to Firebase. A device locked by a code stays locked. */
  const inFront = async () => {
    adb('shell', 'input keyevent KEYCODE_WAKEUP && wm dismiss-keyguard');
    await call('launch_app');
  };

  it('names the route each type takes for its debuggable build', async () => {
    const types = (await call('push')).text;
    expect(types).toMatch(
      /alert: FCM's own message to the app's Firebase SDK, as Google Play services hands it, by run-as on its debuggable build/,
    );
    expect(types).toMatch(/background: FCM's own message .*onMessageReceived gets it wherever/);
    expect(types).toContain('inbox: no: an Android app draws its inbox style itself');
  });

  it('hands its code a data message in front, away and not running, each value as given', async () => {
    await inFront();
    const text = await pushed({ type: 'background', data: { order: "42 it's", kind: 'sync' } });
    expect(text).toMatch(
      /^pushed to dev\.appdyno\.pushfixture as FCM's own message, by run-as on its debuggable build: its receiver took it/,
    );
    await expect
      .poll(received)
      .toEqual([expect.stringContaining("data=kind=sync,order=42 it's notification=none")]);
    await call('press_key', { key: 'home' });
    await pushed({ type: 'live_activity', data: { stage: 'away' } });
    await expect.poll(received).toEqual([expect.stringContaining('data=stage=away')]);
    const pid = adb('shell', 'pidof', PUSH_APP).trim();
    adb('shell', `run-as ${PUSH_APP} kill -9 ${pid}`);
    await expect.poll(() => adb('shell', `pidof ${PUSH_APP} || true`).trim()).toBe('');
    await pushed({ type: 'background', data: { stage: 'cold' } });
    await expect
      .poll(received, { timeout: 15_000 })
      .toEqual([expect.stringContaining('data=stage=cold')]);
    expect(adb('shell', 'pidof', PUSH_APP).trim()).not.toBe(pid);
  });

  it('hands its code an alert and a rich one in front, and its SDK draws one when it is away', async () => {
    await inFront();
    await pushed({ type: 'alert', title: 'Order 42', body: 'shipped', data: { order: '42' } });
    await expect
      .poll(received)
      .toEqual([
        expect.stringContaining('priority=1 data=order=42 notification=Order 42|shipped|'),
      ]);
    const image = 'https://example.com/p.png';
    await pushed({ type: 'rich', title: 'Pic', body: 'b', image });
    await expect.poll(received).toEqual([expect.stringContaining(`notification=Pic|b|${image}`)]);
    await call('press_key', { key: 'home' });
    await pushed({ type: 'alert', title: 'Away', body: 'drawn by its SDK' });
    await expect
      .poll(() => adb('shell', 'cmd notification list'))
      .toContain(`|${PUSH_APP}|0|FCM-Notification:`);
    expect(received()).toEqual([]);
  });

  it("says when it may show no notification, and refuses FCM's own names and an image file", async () => {
    adb('shell', 'pm', 'revoke', PUSH_APP, 'android.permission.POST_NOTIFICATIONS');
    try {
      expect(await pushed({ type: 'alert', title: 'T' })).toContain(
        'or would: the app is not allowed notifications',
      );
    } finally {
      adb('shell', 'pm', 'grant', PUSH_APP, 'android.permission.POST_NOTIFICATIONS');
    }
    const named = await call('push', { type: 'background', data: { 'google.x': 'y' } });
    expect(named.text).toContain("google.x is FCM's own name");
    const file = await call('push', { type: 'rich', title: 'T', image: PICTURE });
    expect(file.text).toContain('give a link');
  });

  it('is a command as the tool is, and `push setup` stays the credentials', () => {
    const cli = (...words: string[]) =>
      spawnSync(process.execPath, [MAIN, 'push', ...words], { encoding: 'utf8' });
    // shared: this suite's server holds the device
    const types = cli('--device', ANDROID!, '--share', '--app', PUSH_APP);
    expect(types.status, types.stderr).toBe(0);
    expect(types.stdout).toMatch(/background: FCM's own message .* by run-as/);
    const setup = cli('setup');
    expect(setup.status).toBe(2);
    expect(setup.stdout + setup.stderr).toContain('usage: appdyno push setup');
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
  const call = server(SIMULATOR!, undefined);
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

describe.skipIf(!SIMULATOR)('a simulator with APNs set up, over MCP', () => {
  const call = server(SIMULATOR!, APP, madeUp('apns'));
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
  const call = server(ANDROID!, APP, madeUp('fcm'));

  it('takes what only Google delivers by FCM, by a token the app printed in this session, and nothing aimed elsewhere', async () => {
    const types = (await call('push')).text;
    expect(types).toContain('background: FCM, data alone');
    expect(types).toContain('alert: FCM, a notification');
    expect(types).toContain('inbox: no: an Android app draws its inbox style itself');
    await call('launch_app');
    const quiet = await call('push', { type: 'background', data: { sync: '7' } });
    expect(quiet.text).toContain(`no registration token from ${APP} in this session (NOT_FOUND)`);
    const topic = await call('push', { type: 'alert', payload: JSON.stringify({ topic: 'news' }) });
    expect(topic.text).toContain('an FCM payload names no topic');
    const away = await call('push', { type: 'alert', app: 'dev.not.here' });
    expect(away.text).toContain('dev.not.here is not installed on this device');
  });
});
