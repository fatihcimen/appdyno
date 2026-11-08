import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AndroidEvents } from '../src/events.js';
import { extrasOf, LocalFcm } from '../src/fcm-local.js';

const RECEIVER = 'dev.app/com.google.firebase.iid.FirebaseInstanceIdReceiver';
const BROADCAST = `am broadcast --user 0 -a com.google.android.c2dm.intent.RECEIVE -n ${RECEIVER}`;
const HEAD =
  "--es 'from' 'appdyno' --es 'google.message_id' 'appdyno-1000-1' --es 'google.delivered_priority' 'high' --es 'google.original_priority' 'high'";

type Device = {
  installed?: boolean;
  receiver?: boolean;
  debuggable?: boolean;
  root?: boolean;
  result?: string;
  appops?: string;
};

/** A shell by what it answers: the app's receivers, whether run-as lets in, adbd's uid, the broadcast's end. */
const answers =
  (d: Device, asked: string[] = []) =>
  (c: string) => {
    asked.push(c);
    if (c.startsWith('cmd package query-receivers'))
      return Promise.resolve(
        d.receiver === false
          ? 'No receivers found'
          : `1 receivers found:\n  Receiver #0:\n    ${RECEIVER}`,
      );
    if (c.startsWith('pm path'))
      return Promise.resolve(d.installed === false ? '' : 'package:/data/app/base.apk');
    if (c.startsWith('cmd package resolve-activity'))
      return Promise.resolve('priority=0\ndev.app/.Main');
    if (c.startsWith('run-as') && c.endsWith('id -u'))
      return Promise.resolve(
        d.debuggable === false ? 'run-as: package not debuggable: dev.app' : '10193',
      );
    if (c === 'id -u') return Promise.resolve(d.root ? '0' : '2000');
    if (c.startsWith('cmd appops'))
      return Promise.resolve(d.appops ?? 'No operations.\nDefault mode: allow');
    return Promise.resolve(
      `Broadcasting: Intent { act=... }\nBroadcast completed: result=${d.result ?? '-1'}`,
    );
  };

const local = (d: Device) => {
  const asked: string[] = [];
  return { local: new LocalFcm(answers(d, asked), () => 1000), asked };
};

describe("FCM's own message to an app's Firebase SDK, on this device", () => {
  it('goes by run-as on a debuggable build, else as root where adbd runs so, else says why', async () => {
    expect(await local({}).local.sender('dev.app')).toEqual({ by: 'run-as' });
    expect(await local({ debuggable: false, root: true }).local.sender('dev.app')).toEqual({
      by: 'root',
    });
    expect(await local({ debuggable: false }).local.sender('dev.app')).toEqual({
      why: "dev.app is not a debuggable build and adbd does not run as root here: a debuggable build takes FCM's own message here, or FCM set up with `appdyno push setup fcm`",
    });
    expect(await local({ receiver: false }).local.sender('dev.app')).toEqual({
      why: "dev.app has no Firebase Messaging, which takes FCM's own message: an Android push reaches an app's code only by it",
    });
    expect(await local({ receiver: false, installed: false }).local.sender('dev.app')).toEqual({
      why: 'dev.app is not installed on this device',
    });
  });

  it('hands over a notification and its data as Play services does, each value quoted', async () => {
    const { local: l, asked } = local({});
    const push = { title: 'Order 42', body: "it's here", data: { order: '42' } };
    const said = await l.send('dev.app', { type: 'alert', ...push }, 'run-as');
    expect(asked[0]).toBe(
      `run-as dev.app ${BROADCAST} ${HEAD} --es 'gcm.n.e' '1' --es 'gcm.n.title' 'Order 42' --es 'gcm.n.body' 'it'\\''s here' --es 'order' '42'`,
    );
    expect(said).toBe(
      "pushed to dev.app as FCM's own message, by run-as on its debuggable build: its receiver took it: in front, onMessageReceived gets it; else its Firebase SDK draws it, and a tap opens the app with the data",
    );
  });

  it('hands over data alone as root, with no notification to draw', async () => {
    const { local: l, asked } = local({ root: true });
    const said = await l.send('dev.app', { type: 'background', data: { a: 'b' } }, 'root');
    expect(asked).toEqual([`${BROADCAST} ${HEAD} --es 'a' 'b'`]);
    expect(said).toMatch(
      /by root, as adbd runs here: .*onMessageReceived gets it wherever the app is, started if it was not running$/,
    );
  });

  it("reads FCM's own message: its collapse key, priority, image, channel and action", () => {
    const message = {
      notification: { title: 'T', image: 'https://example.com/p.png' },
      android: {
        priority: 'NORMAL',
        collapse_key: 'orders',
        notification: { channel_id: 'orders', click_action: 'OPEN' },
      },
    };
    expect(extrasOf(message, 'id')).toEqual([
      ['from', 'appdyno'],
      ['google.message_id', 'id'],
      ['google.delivered_priority', 'normal'],
      ['google.original_priority', 'normal'],
      ['collapse_key', 'orders'],
      ['gcm.n.e', '1'],
      ['gcm.n.title', 'T'],
      ['gcm.n.image', 'https://example.com/p.png'],
      ['gcm.n.android_channel_id', 'orders'],
      ['gcm.n.click_action', 'OPEN'],
    ]);
  });

  it("refuses FCM's own names as data keys, a file for an image, a priority FCM has not", () => {
    for (const key of ['from', 'google.x', 'gcm.n.e', 'collapse_key', 'message_type'])
      expect(() => extrasOf({ data: { [key]: 'v' } }, 'id')).toThrow(`${key} is FCM's own name`);
    expect(() => extrasOf({ notification: { image: '/Users/a/p.png' } }, 'id')).toThrow(
      'give a link',
    );
    expect(() => extrasOf({ android: { priority: 'urgent' } }, 'id')).toThrow('HIGH or NORMAL');
  });

  it('says when the receiver took nothing, and when the app may show no notification', async () => {
    await expect(
      local({ result: '0' }).local.send('dev.app', { type: 'background' }, 'run-as'),
    ).rejects.toThrow("dev.app's Firebase receiver did not take the message: result 0");
    const denied = local({ appops: 'Uid mode: POST_NOTIFICATION: ignore' });
    expect(await denied.local.send('dev.app', { type: 'alert', title: 'T' }, 'run-as')).toContain(
      'or would: the app is not allowed notifications',
    );
  });
});

describe("an Android device's pushes, by the app's own Firebase SDK", () => {
  afterEach(() => vi.unstubAllEnvs());
  const events = (d: Device) => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-local-')));
    const shell = answers(d);
    const adb = { exec: (_serial: string, c: string) => shell(c.replace(/ 2>&1$/, '')) };
    return new AndroidEvents(adb as never, 'emulator-5554');
  };
  const said = async (e: AndroidEvents, app?: string) =>
    Object.fromEntries(
      (await e.pushRoutes(app)).map((r) => [r.type, 'route' in r ? r.route : r.why]),
    );

  it('name the route each type takes for the app named', async () => {
    const routes = await said(events({}), 'dev.app');
    expect(routes.background).toMatch(
      /^FCM's own message to the app's Firebase SDK, .* by run-as on its debuggable build: onMessageReceived gets it wherever the app is/,
    );
    expect(routes.alert).toContain('in front onMessageReceived gets it, else the SDK draws it');
    expect(routes.tapped).toContain('the launcher activity');
    // with no app named, nothing is read of a build
    expect((await said(events({}))).background).toContain('name an app with Firebase Messaging');
  });

  it('refuse every push but a tap, saying what it needs, where the app takes no FCM message', async () => {
    const e = events({ debuggable: false });
    const routes = await said(e, 'dev.app');
    for (const type of ['alert', 'rich', 'background', 'live_activity'])
      expect(routes[type], type).toMatch(/^dev\.app is not a debuggable build/);
    for (const type of ['alert', 'background'] as const)
      await expect(e.push('dev.app', { type, title: 'T' })).rejects.toThrow(
        "a debuggable build takes FCM's own message here, or FCM set up with `appdyno push setup fcm`",
      );
    expect(await e.push('dev.app', { type: 'tapped' })).toMatch(
      /^opened dev\.app as a tapped push/,
    );
  });
});
