import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElicitResult } from '@modelcontextprotocol/client';
import type { AppManager, PlatformScreen } from '@appdyno/core';
import { androidScreen } from '@appdyno/driver-android';
import { iosScreen } from '@appdyno/driver-apple';
import type { Tree, WireWindow } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { outsideApps } from '../src/apps-guard.js';
import { DEFAULT_POLICY, ServerContext, type Policy } from '../src/index.js';
import { FakeDevice } from './fake-device.js';
import { linkedClient } from './helpers.js';

type Win = Pick<WireWindow, 'type' | 'pkg' | 'layer' | 'b'> & { focused?: boolean; c?: string };

/** A screen of these windows, each with one button filling it, or what `c` names. */
const screen = (...wins: Win[]): Tree => ({
  windows: wins.map(({ c: _, ...w }) => ({ active: true, focused: false, ...w })),
  nodes: wins.map((w, i) => ({
    p: -1,
    w: i,
    c: w.c ?? 'Button',
    t: `in ${w.pkg ?? 'none'}`,
    b: w.b,
    f: 19,
  })),
  truncated: false,
  elapsedMs: 1,
  hash: wins.map((w) => w.pkg).join('+'),
});

const W = 1080;
const app = (pkg: string, layer = 1, focused = true): Win => ({
  type: 1,
  pkg,
  layer,
  b: [0, 0, W, 2400],
  focused,
});
const bars: Win = { type: 3, pkg: 'com.android.systemui', layer: 9, b: [0, 0, W, 80] };
const keyboard: Win = {
  type: 2,
  pkg: 'com.google.android.inputmethod.latin',
  layer: 5,
  b: [0, 1500, W, 2400],
};
const dialog = (pkg: string): Win => ({
  type: 1,
  pkg,
  layer: 4,
  b: [0, 800, W, 1600],
  focused: true,
});

const APPS = ['dev.app'];
const touch = (x: number, y: number) => ({ points: [{ x, y }] });
const judge = (
  tree: Tree,
  input: Parameters<typeof outsideApps>[3],
  port: PlatformScreen = androidScreen,
) => outsideApps(APPS, tree, port, input);

/** A screen read from an API 34 emulator of ours: the fixture, its keyboard, its prompt and share sheet, and others. */
const recorded = (name: string) =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures/apps', `android-${name}.json`), 'utf8'),
  ) as Tree;

/** The middle of the first node on the screen whose words are `label`, as a touch by x,y aims. */
function middle(tree: Tree, label: string) {
  const n = tree.nodes.find(
    (x) => (x.t === label || x.d === label) && x.b[2] > x.b[0] && x.b[3] > x.b[1] && x.b[2] <= 1080,
  );
  if (!n) throw new Error(`no ${label}`);
  return { x: (n.b[0] + n.b[2]) / 2, y: (n.b[1] + n.b[3]) / 2 };
}

const FIXTURE = 'dev.appdyno.fixture';
const on = (name: string, input: Parameters<typeof outsideApps>[3], selected?: string) =>
  outsideApps([FIXTURE], recorded(name), androidScreen, input, selected);
const at = (name: string, label: string) => ({ points: [middle(recorded(name), label)] });

describe('where an input lands on an emulator, the fixture alone allowed', () => {
  it('is the fixture, its keyboard, and the prompt and share sheet that stand alone in front of it', () => {
    expect(on('fixture-keyboard', at('fixture-keyboard', 'SEND'))).toBeUndefined();
    expect(on('fixture-keyboard', at('fixture-keyboard', 'Symbol keyboard'))).toBeUndefined();
    expect(on('fixture-keyboard', { points: [], types: true })).toBeUndefined();
    // Android lists no window under them: the app in front is the one a read saw there before
    for (const [screen, label] of [
      ['fixture-permission', 'While using the app'],
      ['share-over-fixture', 'Chrome'],
    ] as const)
      expect(on(screen, at(screen, label), FIXTURE), screen).toBeUndefined();
    expect(on('fixture-permission', at('fixture-permission', 'While using the app'))).toEqual({
      what: "a touch lands in com.google.android.permissioncontroller over no app's window",
      allow: undefined,
    });
  });

  it('is never the home screen, a browser, Settings, the dialer or the bars', () => {
    for (const [screen, label, pkg] of [
      ['home', 'Chrome', 'com.google.android.apps.nexuslauncher'],
      ['browser', 'Use without an account', 'com.android.chrome'],
      ['settings', 'Network & internet', 'com.android.settings'],
      ['dialer', 'Call', 'com.google.android.dialer'],
      ['fixture-keyboard', 'Wifi signal full.', 'com.android.systemui'],
    ] as const)
      expect(on(screen, at(screen, label), FIXTURE), screen).toEqual({
        what: `a touch lands in ${pkg}`,
        allow: pkg,
      });
    expect(on('home', { points: [], types: true }, FIXTURE)?.what).toBe(
      'typing lands in com.google.android.apps.nexuslauncher',
    );
  });
});

describe('where an input lands, under an app allow list', () => {
  it('is an allowed app, or what a person uses over it: its keyboard, a permission prompt, the share sheet, a system dialog', () => {
    const typing = screen(app('dev.app', 1, true), bars, keyboard);
    expect(judge(typing, touch(540, 1000))).toBeUndefined();
    expect(judge(typing, touch(540, 2000))).toBeUndefined();
    expect(judge(typing, { points: [], types: true })).toBeUndefined();
    expect(judge(typing, { points: [], key: 'enter' })).toBeUndefined();
    for (const pkg of [
      'com.google.android.permissioncontroller',
      'com.android.permissioncontroller',
      'com.android.intentresolver',
      'android',
    ]) {
      const over = screen(app('dev.app', 1, false), dialog(pkg));
      expect(judge(over, touch(540, 1200)), pkg).toBeUndefined();
      expect(judge(over, { points: [], key: 'enter' }), pkg).toBeUndefined();
    }
  });

  it('is refused anywhere else: another app, the bars, a home screen and what is over it, a window of no app', () => {
    const home = screen(app('com.google.android.apps.nexuslauncher'), bars, keyboard);
    expect(judge(home, touch(540, 1000))).toEqual({
      what: 'a touch lands in com.google.android.apps.nexuslauncher',
      allow: 'com.google.android.apps.nexuslauncher',
    });
    expect(judge(home, touch(540, 2000))).toEqual({
      what: 'a touch lands in com.google.android.inputmethod.latin over com.google.android.apps.nexuslauncher',
      allow: 'com.google.android.apps.nexuslauncher',
    });
    expect(judge(home, { points: [], types: true })?.what).toBe(
      'typing lands in com.google.android.apps.nexuslauncher',
    );
    expect(judge(screen(app('dev.app'), bars), touch(540, 40))?.what).toBe(
      'a touch lands in com.android.systemui',
    );
    // the dialog of a permission is the app's in front only: over a browser, the browser's
    const browser = screen(
      app('com.android.chrome', 1, false),
      dialog('com.android.permissioncontroller'),
    );
    expect(judge(browser, touch(540, 1200))?.allow).toBe('com.android.chrome');
    expect(
      judge(screen(app('dev.app'), { type: 4, layer: 8, b: [0, 0, W, 2400] }), touch(1, 1)),
    ).toEqual({
      what: "a touch lands in no app's window",
      allow: undefined,
    });
  });

  it("on iOS, is the app's own window and the home screen's alert over it, and never the home screen", () => {
    const ios = (front: string, over?: string) =>
      screen(
        { type: 1, pkg: front, layer: 0, b: [0, 0, 402, 874], focused: true },
        ...(over
          ? [
              {
                type: 3,
                pkg: 'com.apple.springboard',
                layer: 1,
                b: [40, 300, 362, 560],
                c: over,
              } as Win,
            ]
          : []),
      );
    expect(judge(ios('dev.app', 'Alert'), touch(200, 400), iosScreen)).toBeUndefined();
    expect(judge(ios('dev.app', 'Alert'), touch(200, 100), iosScreen)).toBeUndefined();
    // a window of the home screen's that is no alert, as Control Center would be, is no part of the app
    expect(judge(ios('dev.app', 'Other'), touch(200, 400), iosScreen)?.what).toBe(
      'a touch lands in com.apple.springboard',
    );
    expect(judge(ios('com.apple.springboard'), touch(200, 100), iosScreen)?.what).toBe(
      'a touch lands in com.apple.springboard',
    );
    expect(judge(ios('com.apple.mobilesafari', 'Alert'), touch(200, 400), iosScreen)?.what).toBe(
      'a touch lands in com.apple.springboard over com.apple.mobilesafari',
    );
    expect(judge(ios('com.apple.Preferences'), { points: [], types: true }, iosScreen)?.allow).toBe(
      'com.apple.Preferences',
    );
  });
});

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-apps-guard-')));
});

/** A device showing `tree`, under `policy`; a client that answers each question as `answer` says, or cannot ask. */
async function onDevice(
  tree: Tree,
  policy: Partial<Policy>,
  answer?: ElicitResult['action'],
  app = 'dev.app',
) {
  const asked: string[] = [];
  const device = Object.assign(new FakeDevice(), { fixture: tree });
  const ctx = new ServerContext(
    { ...DEFAULT_POLICY, ...policy },
    [
      {
        list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
        handles: () => true,
        open: () => device,
      },
    ],
    app ? { app } : {},
  );
  const client = await linkedClient(ctx, undefined, answer && ((q) => (asked.push(q), answer)));
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as {
      content: { text?: string }[];
      structuredContent?: { code?: string; hint?: string };
    };
    return { text: r.content.map((c) => c.text).join('\n'), ...r.structuredContent };
  };
  const sent = () =>
    device.calls
      .filter((c) => ['act', 'typeText', 'openUrl', 'launch'].includes(c.name))
      .map((c) => [c.name, ...c.args]);
  return { call, sent, asked, device };
}

describe('an input under an app allow list', () => {
  const home = screen(app('com.google.android.apps.nexuslauncher'), bars);

  it('is refused where it would land in another app, by every way a touch is sent, saying how a person allows it', async () => {
    for (const [tool, args] of [
      ['tap', { x: 540, y: 1000 }],
      ['tap', { selector: { text: 'in com.google.android.apps.nexuslauncher' } }],
      ['swipe', { direction: 'up', x: 540, y: 1000 }],
      ['gesture', { kind: 'long_press', x: 540, y: 1000 }],
      ['steps', { steps: [{ action: 'tap', x: 540, y: 1000 }] }],
      ['type_text', { text: 'settings' }],
      ['press_key', { key: 'enter' }],
    ] as const) {
      const { call, sent } = await onDevice(home, { apps: APPS });
      const r = await call(tool, args);
      expect(r.code, tool).toBe('POLICY_DENIED');
      expect(r.text, tool).toContain(
        'lands in com.google.android.apps.nexuslauncher, not an allowed app (dev.app)',
      );
      expect(r.hint, tool).toBe(
        'press_key back, or launch_app an allowed app, leaves this screen; the person who runs this server allows it by adding com.google.android.apps.nexuslauncher to --allow-apps, and no call can',
      );
      expect(sent(), tool).toEqual([]);
    }
  });

  it('leaves such a screen by back, home and launch_app, and reads it', async () => {
    const { call, sent } = await onDevice(home, { apps: APPS });
    expect((await call('screen', {})).code).toBeUndefined();
    for (const key of ['back', 'home'])
      expect((await call('press_key', { key })).code, key).toBeUndefined();
    expect((await call('launch_app', { app: 'dev.app' })).code).toBeUndefined();
    expect(sent().map((s) => s[0])).toEqual(['act', 'act', 'launch']);
  });

  it('takes a prompt that stands alone in front as over the app an earlier read saw there, selected or not', async () => {
    const prompt = recorded('fixture-permission');
    const allow = middle(prompt, 'While using the app');
    // no app selected: the fixture was in front
    const own = await onDevice(recorded('fixture-keyboard'), { apps: [FIXTURE] }, undefined, '');
    expect((await own.call('screen', {})).code).toBeUndefined();
    own.device.fixture = prompt;
    await own.call('screen', {});
    expect((await own.call('tap', allow)).code).toBeUndefined();
    expect(own.sent()).toHaveLength(1);
    // the fixture selected, and a browser was in front
    const other = await onDevice(recorded('browser'), { apps: [FIXTURE] }, undefined, FIXTURE);
    expect((await other.call('screen', {})).code).toBeUndefined();
    other.device.fixture = prompt;
    await other.call('screen', {});
    const r = await other.call('tap', allow);
    expect(r.code).toBe('POLICY_DENIED');
    expect(r.text).toContain(
      'a touch lands in com.google.android.permissioncontroller over com.android.chrome',
    );
    expect(other.sent()).toEqual([]);
  });

  it('goes as it did with no list, and in an allowed app over its keyboard and prompts', async () => {
    const free = await onDevice(home, {});
    expect((await free.call('tap', { x: 540, y: 1000 })).code).toBeUndefined();
    const own = await onDevice(
      screen(
        app('dev.app', 1, false),
        bars,
        keyboard,
        dialog('com.google.android.permissioncontroller'),
      ),
      { apps: APPS },
    );
    for (const y of [300, 1200, 2000])
      expect((await own.call('tap', { x: 540, y })).code, String(y)).toBeUndefined();
    expect(own.sent()).toHaveLength(3);
  });
});

/** Android's opener: the app named, else the system's own pick. */
const opener =
  (picks: string | undefined) =>
  (_url: string, app?: string): Promise<string | undefined> =>
    Promise.resolve(app ?? picks);

describe('a link under an app allow list', () => {
  const own = screen(app('dev.app'));

  it('opens only in an allowed app, as the device tells before it is sent, held to it', async () => {
    const one = await onDevice(own, { apps: APPS }, undefined, '');
    one.device.apps = { opener: opener('com.android.chrome') } as unknown as AppManager;
    // one app allowed and none selected: the link is held to it
    expect(
      (await one.call('open_link', { url: 'https://example.org', read: 'none' })).code,
    ).toBeUndefined();
    expect(one.sent()).toEqual([['openUrl', 'https://example.org', 'dev.app']]);

    const two = await onDevice(own, { apps: ['dev.app', 'dev.other'] }, undefined, '');
    two.device.apps = { opener: opener('com.android.chrome') } as unknown as AppManager;
    const r = await two.call('open_link', { url: 'https://example.org', read: 'none' });
    expect(r.code).toBe('POLICY_DENIED');
    expect(r.text).toContain(
      'the link opens in com.android.chrome, not an allowed app (dev.app, dev.other)',
    );
    expect(r.hint).toBe(
      'use_device with app selects the allowed app it is for; the person who runs this server allows it by adding com.android.chrome to --allow-apps, and no call can',
    );
    two.device.apps = { opener: opener('dev.other') } as unknown as AppManager;
    expect((await two.call('open_link', { url: 'other://x', read: 'none' })).code).toBeUndefined();
    two.device.apps = { opener: opener(undefined) } as unknown as AppManager;
    expect((await two.call('open_link', { url: 'none://x', read: 'none' })).code).toBe(
      'POLICY_DENIED',
    );
    expect(two.sent()).toEqual([['openUrl', 'other://x', 'dev.other']]);
  });

  it("opens Settings by its own link where Settings is on the list, whatever the app's links say", async () => {
    const { call, sent, device } = await onDevice(own, {
      apps: ['dev.app', 'com.apple.Preferences', 'com.android.settings'],
    });
    device.apps = { opener: () => Promise.resolve(undefined) } as unknown as AppManager;
    expect(
      (await call('open_link', { url: 'App-prefs:root=General', read: 'none' })).code,
    ).toBeUndefined();
    expect(sent()).toEqual([['openUrl', 'App-prefs:root=General', 'dev.app']]);
  });

  it('opens no Settings by a link under --no-home, as by settings', async () => {
    const { call, sent } = await onDevice(own, { allowHome: false });
    for (const url of ['App-prefs:root=General', 'package:dev.app']) {
      const r = await call('open_link', { url, read: 'none' });
      expect(r.text, url).toMatch(
        /^POLICY_DENIED: Settings is off on this server: the app may not be left/,
      );
    }
    expect(sent()).toEqual([]);
  });
});

describe('a call', () => {
  const own = screen(app('dev.app'));

  it('by a link asks the person, and is refused where no one can be asked', async () => {
    for (const url of [
      'tel:112',
      'telprompt:112',
      'facetime:a@b.c',
      'facetime-audio:a@b.c',
      'TEL:911',
    ]) {
      const { call, sent } = await onDevice(own, {});
      const r = await call('open_link', { url, read: 'none' });
      expect(r.code, url).toBe('PERMISSION_REQUIRED');
      expect(r.text, url).toContain(`the link ${url}, which places a call asks the person first`);
      expect(sent(), url).toEqual([]);
    }
    const yes = await onDevice(own, {}, 'accept');
    expect((await yes.call('open_link', { url: 'tel:112', read: 'none' })).code).toBeUndefined();
    expect(yes.asked).toEqual([
      'Let appdyno act on the link tel:112, which places a call on Fake Phone (emulator-5580)? The device may power off, restart, place a call, call for help, or lose all it holds.',
    ]);
    expect(yes.sent()).toEqual([['openUrl', 'tel:112', 'dev.app']]);
    const no = await onDevice(own, {}, 'decline');
    expect((await no.call('open_link', { url: 'tel:112', read: 'none' })).code).toBe(
      'PERMISSION_REQUIRED',
    );
    expect(no.sent()).toEqual([]);
  });

  it('by a touch in a phone app asks the person, by any key of the dial screen', async () => {
    const dialer = recorded('dialer');
    for (const label of ['Call', '2,ABC', 'backspace']) {
      const { call, sent } = await onDevice(dialer, {});
      const r = await call('tap', middle(dialer, label));
      expect(r.code, label).toBe('PERMISSION_REQUIRED');
      expect(sent(), label).toEqual([]);
    }
    for (const pkg of [
      'com.google.android.dialer',
      'com.samsung.android.incallui',
      'com.apple.mobilephone',
    ]) {
      const { call, sent } = await onDevice(screen(app(pkg), bars), {});
      const r = await call('tap', { x: 540, y: 1000 });
      expect(r.code, pkg).toBe('PERMISSION_REQUIRED');
      expect(r.text, pkg).toContain(
        `a touch on the phone app ${pkg}, which may place a call asks the person first`,
      );
      expect(sent(), pkg).toEqual([]);
    }
    const { call, sent } = await onDevice(
      screen(app('com.google.android.dialer'), bars),
      {},
      'accept',
    );
    expect((await call('tap', { x: 540, y: 1000 })).code).toBeUndefined();
    expect(sent()).toHaveLength(1);
  });
});
