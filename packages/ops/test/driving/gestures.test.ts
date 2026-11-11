import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type AppManager } from '@appdyno/core';
import { DeviceError, KEYS, type ActParams } from '@appdyno/protocol';
import { describe, expect, it, onTestFinished } from 'vitest';
import { type OpName } from '../../src/index.js';
import { keyName, keyPress } from '../../src/step-schemas.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect, act } from './shared.js';

describe('gestures, keys, clipboard', () => {
  it('sends double tap, drag, pinch and a free plan', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    await call('gesture', { kind: 'double_tap', x: 10, y: 20 });
    expect(act(d).at(-1)).toEqual({ kind: 'doubleTap', x: 10, y: 20 });
    await call('gesture', { kind: 'drag', x: 10, y: 20, to: { x: 500, y: 600 }, durationMs: 900 });
    const drag = act(d).at(-1) as Extract<ActParams, { kind: 'gesture' }>;
    expect(drag.pointers[0]?.map((p) => [p.x, p.y])).toEqual([
      [10, 20],
      [10, 20],
      [500, 600],
      [500, 600],
    ]);
    const path = must(drag.pointers[0], 'its path');
    expect(must(path[2], 'its third point').t - must(path[1], 'its second point').t).toBe(900);
    const plan = [
      [
        { x: 1, y: 1, t: 0 },
        { x: 2, y: 2, t: 100 },
      ],
      [
        { x: 3, y: 3, t: 0 },
        { x: 4, y: 4, t: 100 },
      ],
    ];
    await call('gesture', { kind: 'plan', pointers: plan });
    expect(act(d).at(-1)).toEqual({ kind: 'gesture', pointers: plan });
    await call('gesture', { kind: 'pinch', scale: 2 });
    expect((act(d).at(-1) as { pointers: unknown[] }).pointers).toHaveLength(2);
    await call('gesture', { kind: 'long_press', x: 1, y: 1, durationMs: 500 });
    expect(act(d).at(-1)).toEqual({ kind: 'longPress', x: 1, y: 1, durationMs: 500 });
    expect((await call('gesture', { kind: 'plan', pointers: [] })).error).toBe(true);
  });

  it('takes every key of the wire, under the name a tool gives it', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const names = KEYS.map(keyName);
    for (const key of names) expect((await call('press_key', { key })).error).toBe(false);
    const sent = act(d).map((a) => (a as Extract<ActParams, { kind: 'key' }>).key);
    expect([...sent].sort()).toEqual([...KEYS].sort());
    expect(names).toContain('app_switch');
  });

  it('holds keys during a letter, a digit or a named key, and only a keyboard key', async () => {
    expect(keyPress('command+a')).toEqual({ key: 'a', modifiers: ['command'] });
    expect(keyPress('control+shift+arrow_left')).toEqual({
      key: 'arrowLeft',
      modifiers: ['control', 'shift'],
    });
    expect(keyPress('7')).toEqual({ key: '7', modifiers: [] });
    // a name whatever its case, and what else a key is called
    for (const enter of ['Enter', 'return', 'RETURN'])
      expect(keyPress(enter)).toEqual({ key: 'enter', modifiers: [] });
    expect(keyPress('Command+A')).toBeUndefined();
    // and so the press says it, and what reads a key after reads it so
    const said = await (await connect(new FakeDevice())).call('press_key', { key: 'Return' });
    expect(said.text).toMatch(/^pressed enter\n/);
    for (const bad of ['command+home', 'alt+a', 'command+', 'A', 'warp'])
      expect(keyPress(bad)).toBeUndefined();

    const d = new FakeDevice();
    const { call } = await connect(d);
    expect((await call('press_key', { key: 'command+a' })).text).toMatch(/^pressed command\+a/);
    expect(act(d).at(-1)).toEqual({ kind: 'key', key: 'a', modifiers: ['command'] });
    const refused = await call('press_key', { key: 'alt+a' });
    expect(refused).toMatchObject({ error: true });
    expect(refused.text).toContain('command+a');
    // a capital would be a shift too, and the refusal says so
    expect((await call('press_key', { key: 'Command+A' })).text).toContain(
      'or a small letter or digit, held keys first: command+a',
    );
  });

  it('presses count times with one settle, the last', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    await call('screen');
    d.calls.length = 0;
    const r = await call('press_key', { key: 'delete', count: 3 });
    expect(r.text).toMatch(/^pressed delete 3 times/);
    const acts = d.calls.filter((c) => c.name === 'act');
    expect(acts.map((c) => c.args[1])).toEqual([
      { settle: false, read: 'none' },
      { settle: false, read: 'none' },
      expect.objectContaining({ read: 'tree' }),
    ]);
    expect((await call('press_key', { key: 'delete', count: 0 })).error).toBe(true);
  });

  it('presses hardware buttons, and a server without home refuses what leaves the app', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    await call('press_key', { key: 'volume_up' });
    expect(act(d).at(-1)).toEqual({ kind: 'key', key: 'volumeUp' });
    await call('press_key', { key: 'lock' });
    expect(act(d).at(-1)).toEqual({ kind: 'key', key: 'lock' });
    const locked = await connect(new FakeDevice(), { policy: { allowHome: false } });
    for (const key of ['home', 'app_switch', 'power', 'lock', 'command+h', 'command+space'])
      expect((await locked.call('press_key', { key })).error).toBe(true);
    expect((await locked.call('press_key', { key: 'volume_down' })).error).toBe(false);
    expect((await locked.call('press_key', { key: 'command+a' })).error).toBe(false);
  });

  it('opens the system views by name, and a server without home refuses them', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const r = await call('press_key', { key: 'control_center' });
    expect(r.text).toMatch(/^opened control_center/);
    expect(d.calls.filter((c) => c.name === 'openView').map((c) => c.args[0])).toEqual([
      'control_center',
    ]);
    const locked = await connect(new FakeDevice(), { policy: { allowHome: false } });
    for (const key of ['control_center', 'notification_center', 'spotlight'])
      expect((await locked.call('press_key', { key })).error).toBe(true);
  });

  it('opens Settings at a page or at an app, and takes one or the other', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const opened = () => d.calls.filter((c) => c.name === 'openSettings').map((c) => c.args[0]);
    expect((await call('open_link', { settings: 'about' })).text).toMatch(
      /^opened Settings: about/,
    );
    await call('open_link', { settings: 'app' });
    await call('open_link', { settings: 'com.example.other' });
    expect(opened()).toEqual([{ page: 'about' }, { app: 'dev.app' }, { app: 'com.example.other' }]);
    expect((await call('open_link', {})).error).toBe(true);
    expect((await call('open_link', { url: 'https://a.b', settings: 'about' })).error).toBe(true);
    const wrong = await call('open_link', { settings: 'wifii' });
    expect(wrong.error).toBe(true);
    // the device's own pages, Android's here: a fingerprint and security, and none of iOS's
    expect(wrong.text).toMatch(/\bfingerprint\b/);
    expect(wrong.text).toMatch(/\bsecurity, /);
    for (const ios of ['siri', 'game_center', 'screen_time', 'privacy_photos'])
      expect(wrong.text).not.toContain(ios);
    const theirs = await call('open_link', { settings: 'game_center' });
    expect([theirs.data.code, theirs.text]).toEqual(['INVALID_ARGUMENT', wrong.text]);
    expect(opened()).toHaveLength(3);
    const locked = await connect(new FakeDevice(), { policy: { allowHome: false } });
    expect((await locked.call('open_link', { settings: 'about' })).data.code).toBe('POLICY_DENIED');
  });

  it('opens Settings under an app allow list only when Settings is on it, as it is an app of its own', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d, { policy: { apps: ['dev.app'] } });
    for (const settings of ['wifi', 'app', 'dev.app']) {
      const r = await call('open_link', { settings });
      expect(r.text).toBe(
        'POLICY_DENIED: Settings is an app of its own, com.android.settings, and not an allowed one (dev.app)\nhint: the person who runs this server allows it by adding com.android.settings to --allow-apps, and no call can',
      );
    }
    // a page this device lacks is a wrong word, never an app
    const theirs = await call('open_link', { settings: 'game_center' });
    expect(theirs.data.code).toBe('INVALID_ARGUMENT');
    expect(theirs.text).toContain("a page of this device's Settings: ");
    expect((await call('open_link', { settings: 'com.example.other' })).text).toMatch(
      /^POLICY_DENIED: com\.example\.other is not an allowed app/,
    );
    expect(d.calls.filter((c) => c.name === 'openSettings')).toEqual([]);
    const allowed = await connect(d, { policy: { apps: ['dev.app', 'com.android.settings'] } });
    expect((await allowed.call('open_link', { settings: 'wifi' })).text).toMatch(
      /^opened Settings: wifi/,
    );
  });

  it('opens a link to Settings under an app allow list only when Settings is on it, as its own pages do', async () => {
    const d = new FakeDevice();
    // Android's: a link goes to the app named
    d.apps = { opener: (_url: string, app?: string) => Promise.resolve(app) } as AppManager;
    const { call } = await connect(d, { policy: { apps: ['dev.app'] } });
    for (const url of [
      'App-prefs:root=General',
      'prefs:root=WIFI',
      'app-settings:',
      'settings-navigation://com.apple.Settings.Apps',
      'package:dev.app',
      'android.settings.settings:',
    ]) {
      const r = await call('open_link', { url, read: 'none' });
      expect(r.text, url).toBe(
        'POLICY_DENIED: Settings is an app of its own, com.android.settings, and not an allowed one (dev.app)\nhint: the person who runs this server allows it by adding com.android.settings to --allow-apps, and no call can',
      );
    }
    expect(d.calls.filter((c) => c.name === 'openUrl')).toEqual([]);
    // a link of the app's own, or a page's, is no way into Settings
    expect(
      (await call('open_link', { url: 'https://example.test/prefs:x', read: 'none' })).text,
    ).toBe('opened https://example.test/prefs:x');
    const allowed = await connect(d, { policy: { apps: ['dev.app', 'com.android.settings'] } });
    expect((await allowed.call('open_link', { url: 'package:dev.app', read: 'none' })).text).toBe(
      'opened package:dev.app',
    );
  });

  it('says of a link the allowed app declares none like that it may open in another, and how to list its links', async () => {
    const d = new FakeDevice();
    // a simulator's: an app opens what it declares, and of anything else nothing is known
    d.apps = { opener: () => Promise.resolve(undefined) } as unknown as AppManager;
    const { call } = await connect(d, { policy: { apps: ['dev.app'] } });
    expect((await call('open_link', { url: 'other://x', read: 'none' })).text).toMatch(
      /^POLICY_DENIED: dev\.app declares no link like this \(open_link links: lists its links\), so it may open in another app\n/,
    );
  });

  it('holds a drag at its start for as long as it is told', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    await call('gesture', { kind: 'drag', x: 10, y: 10, to: { x: 10, y: 500 }, holdMs: 900 });
    const path = must(
      (act(d).at(-1) as Extract<ActParams, { kind: 'gesture' }>).pointers[0],
      'its path',
    );
    expect(path[1]).toEqual({ x: 10, y: 10, t: 900 });
    await call('gesture', { kind: 'drag', x: 10, y: 10, to: { x: 10, y: 500 } });
    const usual = must(
      (act(d).at(-1) as Extract<ActParams, { kind: 'gesture' }>).pointers[0],
      'its path',
    );
    expect(usual[1]?.t).toBe(150);
  });

  it('ends a fixed location, and wants a position or that', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    expect((await call('set_location', { clear: true })).text).toContain('real one');
    expect(d.calls.some((c) => c.name === 'clearLocation')).toBe(true);
    expect((await call('set_location', { lat: 1 })).error).toBe(true);
  });

  it('puts a fixed location back as a condition: at restore, and at the session end', async () => {
    const d = new FakeDevice();
    const { call, ctx } = await connect(d);
    const cleared = () => d.calls.filter((c) => c.name === 'clearLocation').length;
    await call('set_location', { lat: 41, lon: 29 });
    expect((await call('device_setting', { name: 'restore' })).text).toContain(
      'restored location: the real one',
    );
    expect(cleared()).toBe(1);
    // one ended by hand is not ended again
    await call('set_location', { lat: 41, lon: 29 });
    await call('set_location', { clear: true });
    expect((await call('device_setting', { name: 'restore' })).text).toBe('nothing was changed');
    await call('set_location', { lat: 41, lon: 29 });
    expect(await ctx.end()).toEqual([]);
    expect(cleared()).toBe(3);
  });

  it('asks for an image of the screen in tap units', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const asked: unknown[] = [];
    const shot = d.screenshot.bind(d);
    Object.assign(d, {
      screenshot: async (o: unknown) => {
        asked.push(o);
        return shot();
      },
    });
    await call('screenshot', { points: true });
    await call('screenshot');
    await call('screenshot', { width: 540 });
    await call('screenshot', { width: 8_000 });
    expect(asked).toMatchObject([
      { maxPx: 2400 },
      { maxPx: 800 },
      { maxPx: 1200 },
      { maxPx: 8_192 },
    ]);
  });

  it('launches an app by its name, in any case, and refuses a name it cannot settle', async () => {
    const d = new FakeDevice();
    const names = [
      { id: 'dev.one', name: 'Ödeme' },
      { id: 'dev.two', name: 'Twin' },
      { id: 'dev.three', name: 'Twin' },
    ];
    Object.assign(d, { apps: { listApps: () => Promise.resolve(names) } });
    const { call } = await connect(d);
    expect((await call('launch_app', { app: 'ödeme' })).text).toContain(
      'brought dev.one to the front, on the screen it was on',
    );
    const none = await call('launch_app', { app: 'Nothing' });
    expect(none.text).toContain('no app named Nothing');
    expect((await call('launch_app', { app: 'Twin' })).text).toContain('dev.two, dev.three');
  });

  it('says whether a launch started the app or brought a running one to the front, asked before a first launch begins', async () => {
    const d = new FakeDevice();
    d.running = false;
    // the first call's launch begins alongside the device's start, and the app runs from then on
    d.launchAlongside = () => {
      d.running = true;
    };
    const { call } = await connect(d);
    expect((await call('launch_app')).text).toMatch(/^started dev\.app\n/);
    expect((await call('launch_app')).text).toMatch(
      /^brought dev\.app to the front, on the screen it was on\n/,
    );
    d.running = false;
    expect((await call('launch_app')).done).toBe('started dev.app');
  });

  it('warns that the app is not in front only when it left by itself', async () => {
    const d = new FakeDevice();
    let front = 'dev.app';
    const shown = d.current.bind(d);
    d.current = () => {
      const t = shown();
      for (const w of t.windows) w.pkg = front;
      return t;
    };
    const { call } = await connect(d);
    const warned = async (n: OpName, args: Record<string, unknown> = {}) =>
      (await call(n, args)).text.includes('WARNING: the app is not in the foreground');
    await call('screen');
    front = 'launcher';
    expect([await warned('press_key', { key: 'home' }), await warned('screen')]).toEqual([
      false,
      false,
    ]);
    front = 'dev.other';
    expect(await warned('launch_app', { app: 'dev.other' })).toBe(false);
    front = 'dev.app';
    expect(await warned('launch_app')).toBe(false);
    // back in front, and gone with nothing that took it away
    front = 'launcher';
    expect(await warned('screen')).toBe(true);
  });

  it('refuses an app the device does not have by one code on every platform, with how to list them', async () => {
    const d = new FakeDevice();
    let state = 'not_installed';
    Object.assign(d, { apps: { appState: () => Promise.resolve(state) } });
    // a simulator's launch of an app it does not have fails in simctl's own words
    d.launch = () => Promise.reject(new DeviceError('INTERNAL', 'simctl launch: code=4 failed'));
    const { call } = await connect(d);
    const gone = await call('launch_app', { app: 'dev.gone' });
    expect([gone.data.code, gone.text]).toEqual([
      'NOT_FOUND',
      'NOT_FOUND: dev.gone is not installed on emulator-5580\nhint: app action list names the installed apps',
    ]);
    // an app that is there and does not start keeps what its launch said
    state = 'stopped';
    d.launch = () => Promise.reject(new DeviceError('APP_NOT_RUNNING', 'dev.app did not start'));
    expect((await call('launch_app')).text).toBe('APP_NOT_RUNNING: dev.app did not start');
  });

  it('lists the links an app opens, as lines and as data', async () => {
    const d = new FakeDevice();
    const links = [
      { url: 'demo://', kind: 'scheme' },
      { url: 'https://example.com', kind: 'domain', state: 'verified' },
    ];
    Object.assign(d, { apps: { links: () => Promise.resolve(links) } });
    const { call } = await connect(d);
    const r = await call('open_link', { links: 'dev.app' });
    expect(r.text).toBe('scheme demo://\ndomain https://example.com: verified');
    expect(r.data.links).toEqual(links);
    Object.assign(d, { apps: { links: () => Promise.resolve([]) } });
    expect((await call('open_link', { links: 'dev.app' })).text).toBe('dev.app opens no links');
  });

  it('keeps a name to what the server allows', async () => {
    const d = new FakeDevice();
    Object.assign(d, {
      apps: { listApps: () => Promise.resolve([{ id: 'dev.other', name: 'Other' }]) },
    });
    const { call } = await connect(d, { policy: { apps: ['dev.app'] } });
    expect((await call('launch_app', { app: 'Other' })).text).toContain('not an allowed app');
  });

  it('launches in a language, restarting the app, and refuses what is none', async () => {
    const d = new FakeDevice();
    const launched: unknown[] = [];
    Object.assign(d, {
      apps: {
        launchWith: (app: string, o: unknown) => {
          launched.push([app, o]);
          return Promise.resolve();
        },
      },
    });
    const { call } = await connect(d);
    const r = await call('launch_app', { language: 'pt-BR' });
    expect(r.text).toMatch(/^started dev\.app in pt-BR/);
    expect(launched).toEqual([['dev.app', { language: 'pt-BR' }]]);
    expect((await call('launch_app', { language: 'tr; rm -rf' })).error).toBe(true);
  });

  it('saves a picture, into a folder too, and leaves what is there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-shot-'));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const d = new FakeDevice();
    Object.defineProperty(d, 'mirror', { value: {} });
    const { call } = await connect(d);
    const file = join(dir, 'a.png');
    expect((await call('screenshot', { file })).text).toContain(`saved ${file}`);
    expect(readFileSync(file)).toEqual(Buffer.from([1, 2, 3]));
    const again = await call('screenshot', { file });
    expect(again.error).toBe(true);
    expect(again.text).toContain('is there already');
    expect((await call('screenshot', { file, overwrite: true })).error).toBe(false);
    const named = await call('screenshot', { file: dir });
    expect(named.data.file).toMatch(/emulator-5580-.*\.png$/);
    expect((await call('screenshot', { file: join(dir, 'a.gif') })).error).toBe(true);
    // a picture at full size, 3 pixels to a tap unit, says to tap at a third
    const png = Buffer.alloc(24);
    png[0] = 0x89;
    png.writeUInt32BE(3240, 16);
    png.writeUInt32BE(7200, 20);
    d.screenshot = () =>
      Promise.resolve({ meta: { w: 3240, h: 7200, format: 'png', bytes: 24 }, data: png });
    const full = await call('screenshot', { file: join(dir, 'full.png'), inline: false });
    expect([full.text, full.data.scale, full.images]).toEqual([
      `saved ${join(dir, 'full.png')} (3240x7200 px; its pixel x,y is tapped at x/3, y/3)`,
      0.333,
      0,
    ]);
  });

  it('shows the picture it saves as well, a small one, so that the file need not be read back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-shot-'));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const d = new FakeDevice();
    Object.defineProperty(d, 'mirror', { value: {} });
    const asked: { format: string; maxPx?: number | undefined }[] = [];
    const shot = d.screenshot.bind(d);
    Object.assign(d, {
      screenshot: (o: { format: string; maxPx?: number }) => {
        asked.push(o);
        return shot();
      },
    });
    const { call } = await connect(d);
    const file = join(dir, 'a.png');
    const r = await call('screenshot', { file });
    expect(r.images).toBe(1);
    expect(r.text).toMatch(new RegExp(`^saved ${file}.*; the image here: \\d+x\\d+ px`));
    expect(r.data.file).toBe(file);
    // the file at full size, the image as large as a screenshot's
    expect(asked.map((o) => [o.format, o.maxPx])).toEqual([
      ['png', undefined],
      ['jpeg', 800],
    ]);
  });

  it('reads the clipboard and keeps a secret off it', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d, { policy: { secrets: ['hunter2'] } });
    expect((await call('clipboard', { text: 'hi' })).error).toBe(false);
    Object.assign(d, { getClipboard: () => Promise.resolve('pw hunter2') });
    expect((await call('clipboard')).text).not.toContain('hunter2');
    expect((await call('clipboard', { text: 'hunter2' })).error).toBe(true);
  });
});
