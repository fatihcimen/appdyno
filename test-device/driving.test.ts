import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, opsFor, ServerContext, ToolError, type Op } from '@appdyno/ops';
import { Adb, AndroidDevice, androidProvider, appleProvider, Simctl } from 'appdyno';

/**
 * Phase 4 on real devices, through the operations an agent calls: one suite per platform, each on the
 * device its variable names (never a default).
 */
const APP = 'dev.appdyno.fixture';
const ROOT = join(import.meta.dirname, '..');

type Answer = { error: boolean; text: string; data: Record<string, unknown> };

function harness(serial: string, provider: ConstructorParameters<typeof ServerContext>[1][number]) {
  const ctx = new ServerContext(DEFAULT_POLICY, [provider], {
    device: serial,
    app: APP,
    claims: true,
  });
  const ops = opsFor(ctx);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Answer> => {
    const op = ops[name] as Op;
    try {
      const r = await op.handler(op.input.parse(args) as Record<string, unknown>);
      return {
        error: false,
        text: r.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'),
        data: r.data,
      };
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      return { error: true, text: e.message, data: { code: e.code } };
    }
  };
  return { ctx, call };
}

const ok = (r: Answer) => {
  expect(r.text && !r.error ? '' : r.text).toBe('');
  return r;
};

/** What both platforms must do, given how each opens the fixture and names its parts. */
function shared(
  get: () => { call: (name: string, args?: Record<string, unknown>) => Promise<Answer> },
  open: (screen: string) => Promise<void>,
  names: {
    field: { id?: string; role?: string; index?: number };
    row: (n: number) => string;
    /** The button that starts the delayed screen's work, if it has one, and what shows after. */
    delayed: { start?: string; shows: string };
  },
) {
  const call = (n: string, a?: Record<string, unknown>) => get().call(n, a);

  it('taps by a selector, folding case and accents, and refuses several or none', async () => {
    await open('list');
    const many = await call('tap', { selector: { text: 'Product' } });
    expect(many.error).toBe(true);
    expect(many.data.code).toBe('AMBIGUOUS');
    expect(many.text).toMatch(/@\w+/);
    const none = await call('tap', { selector: { text: 'Producz 1' } });
    expect(none.data.code).toBe('NOT_FOUND');
    expect(none.text).toContain('nearest');
  });

  it('runs steps across screens with selectors, wait_for and assert, and names a failure', async () => {
    await open('home');
    const r = await call('steps', {
      steps: [
        { action: 'tap', selector: { text: 'Form' } },
        { action: 'wait_for', ...names.field, timeoutMs: 8_000 },
        { action: 'assert', ...names.field, check: 'exists' },
        { action: 'tap', selector: names.field },
        { action: 'type_text', text: 'İstanbul' },
      ],
    });
    ok(r);
    expect(r.text).toContain('5. typed');
    const fail = await call('steps', {
      steps: [
        { action: 'assert', ...names.field, check: 'enabled' },
        { action: 'assert', text: 'Nothing here' },
      ],
    });
    expect(fail.error).toBe(true);
    expect(fail.text).toContain('2. assert failed');
    expect(fail.text).toMatch(/@\w+/);
  });

  it('waits on the device, whichever way the screen comes', async () => {
    await open('delayed');
    if (names.delayed.start) ok(await call('tap', { selector: { text: names.delayed.start } }));
    const r = await call('wait_for', { text: names.delayed.shows, timeoutMs: 8_000 });
    expect(r.data.met).toBe(true);
    const absent = await call('wait_for', { text: 'Never', timeoutMs: 600 });
    expect(absent.data.met).toBe(false);
  });

  it('scrolls to a row, and stops at the list’s end', async () => {
    await open('list');
    const found = ok(await call('scroll_to', { selector: { text: names.row(25) }, maxSwipes: 15 }));
    expect(found.text).toContain(names.row(25));
    const end = await call('scroll_to', { selector: { text: 'No such row' }, maxSwipes: 40 });
    expect(end.error).toBe(true);
    expect(end.text).toContain('the list did not move');
  });

  it('reports attributes and checks them', async () => {
    await open('form');
    ok(await call('tap', { selector: names.field }));
    ok(await call('type_text', { text: 'Ayşe' }));
    const f = ok(await call('find', { ...names.field }));
    const m = (f.data.matches as Record<string, unknown>[])[0]!;
    expect(m).toMatchObject({ enabled: true, focused: true, value: 'Ayşe' });
    expect((m.bounds as { w: number }).w).toBeGreaterThan(0);
    ok(await call('assert', { ...names.field, check: 'text', equals: 'Ayşe' }));
    expect((await call('assert', { ...names.field, check: 'text', equals: 'No' })).data.code).toBe(
      'CHECK_FAILED',
    );
  });

  it('says whether the keyboard is open, and closes it or says it cannot', async () => {
    await open('form');
    ok(await call('tap', { selector: names.field }));
    expect((ok(await call('keyboard', { action: 'status' })).data as { open: boolean }).open).toBe(
      true,
    );
    const r = await call('keyboard', { action: 'dismiss' });
    if (r.error) expect(r.text).toContain('stayed open');
    else
      expect(
        (ok(await call('keyboard', { action: 'status' })).data as { open: boolean }).open,
      ).toBe(false);
  });

  it('double-taps, drags and runs a plan, as the app sees it', async () => {
    await open('gestures');
    const pad = { selector: { text: 'Gesture pad' } };
    ok(await call('gesture', { kind: 'double_tap', ...pad }));
    ok(await call('assert', { text: 'double taps: 1' }));
    const f = ok(await call('find', { text: 'Gesture pad' }));
    const b = (f.data.matches as { x: number; y: number }[])[0]!;
    ok(
      await call('gesture', {
        kind: 'drag',
        x: b.x,
        y: b.y + 100,
        to: { x: b.x, y: b.y - 100 },
        durationMs: 600,
      }),
    );
    const moved = ok(await call('find', { text: 'travel' }));
    const travel = /travel: (-?\d+)/.exec(JSON.stringify(moved.data))?.[1];
    expect(Number(travel)).toBeLessThan(-60);
    const r = await call('gesture', {
      kind: 'plan',
      pointers: [
        [
          { x: b.x - 30, y: b.y, t: 0 },
          { x: b.x - 120, y: b.y, t: 200 },
          { x: b.x - 150, y: b.y, t: 400 },
        ],
        [
          { x: b.x + 30, y: b.y, t: 0 },
          { x: b.x + 120, y: b.y, t: 200 },
          { x: b.x + 150, y: b.y, t: 400 },
        ],
      ],
    });
    ok(r);
  });

  it('reads the clipboard it set', async () => {
    await open('home');
    ok(await call('clipboard', { text: 'pano içeriği' }));
    expect(ok(await call('clipboard')).text).toBe('pano içeriği');
  });

  it('leaves the app’s own dialog alone', async () => {
    await open('dialog');
    ok(await call('tap', { selector: { text: 'Open dialog' } }));
    expect((await call('alert', { answer: 'OK' })).text).toContain('no system alert');
  });

  it('says what an app is doing, and lists it', async () => {
    await open('home');
    expect(ok(await call('app', { action: 'state' })).data.state).toBe('foreground');
    const list = ok(await call('app', { action: 'list' }));
    expect(list.text).toContain(APP);
    ok(await call('terminate_app'));
    expect(ok(await call('app', { action: 'state' })).data.state).toBe('stopped');
    expect(ok(await call('app', { action: 'state', app: 'dev.nobody.here' })).data.state).toBe(
      'not_installed',
    );
  });

  it('runs 30 steps within a client’s patience', async () => {
    await open('home');
    const pair = [
      { action: 'tap', selector: { text: 'Form' } },
      { action: 'press_key', key: 'back' },
    ];
    const t0 = Date.now();
    const r = await call('steps', { steps: Array(15).fill(pair).flat() });
    const ms = Date.now() - t0;
    process.stderr.write(
      `30 steps: ${ms} ms${r.error ? `, failed: ${r.text.slice(0, 300)}` : ''}\n`,
    );
    expect(r.error).toBe(false);
    expect(ms).toBeLessThan(55_000);
  });
}

const android = process.env.APPDYNO_ANDROID_SERIAL;
describe.skipIf(!android)('driving on Android', () => {
  let h: ReturnType<typeof harness>;
  const adb = new Adb();
  const sh = (c: string) => adb.exec(android!, c);
  const open = async (screen: string) => {
    await h.call('terminate_app');
    if (screen === 'home') ok(await h.call('launch_app'));
    else ok(await h.call('open_link', { url: `appdyno-fixture://open/${screen}` }));
  };

  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-drive-')));
    h = harness(android!, androidProvider(adb));
    ok(await h.call('use_device', { device: android!, app: APP }));
  }, 180_000);
  afterAll(async () => {
    await h.ctx.end();
    h.ctx.close();
    await new AndroidDevice(android!).stopAgent().catch(() => undefined);
  }, 60_000);

  shared(() => h, open, {
    field: { id: 'name_input' },
    row: (n) => `Product ${n}`,
    delayed: { start: 'Load', shows: 'Result 1' },
  });

  it('counts two fingers in a plan', async () => {
    await open('gestures');
    const f = ok(await h.call('find', { text: 'Gesture pad' }));
    const b = (f.data.matches as { x: number; y: number }[])[0]!;
    ok(
      await h.call('gesture', {
        kind: 'plan',
        pointers: [
          [
            { x: b.x - 30, y: b.y, t: 0 },
            { x: b.x - 200, y: b.y, t: 300 },
          ],
          [
            { x: b.x + 30, y: b.y, t: 0 },
            { x: b.x + 200, y: b.y, t: 300 },
          ],
        ],
      }),
    );
    ok(await h.call('assert', { text: 'fingers: 2' }));
  });

  it('reads and answers a permission prompt', async () => {
    ok(await h.call('app', { action: 'revoke', service: 'location' }));
    await open('permission');
    ok(await h.call('tap', { selector: { text: 'Request location' } }));
    const read = ok(await h.call('alert'));
    expect(read.text).toContain('buttons:');
    const wrong = await h.call('alert', { answer: 'Definitely not a button' });
    expect(wrong.error).toBe(true);
    ok(await h.call('alert', { answer: 'allow' }));
    expect(await sh(`dumpsys package ${APP}`)).toMatch(
      /ACCESS_(COARSE|FINE)_LOCATION: granted=true/,
    );
    ok(await h.call('app', { action: 'revoke', service: 'location' }));
  });

  it('presses volume, lock and power; the next read wakes the screen', async () => {
    const volume = async () =>
      /STREAM_MUSIC[\s\S]*?Current: ([^\n]*)/.exec(await sh('dumpsys audio'))?.[1];
    const before = await volume();
    ok(await h.call('press_key', { key: 'volume_down' }));
    ok(await h.call('press_key', { key: 'volume_up' }));
    expect(await volume()).toBeDefined();
    expect(before).toBeDefined();
    ok(await h.call('press_key', { key: 'lock' }));
    await expect
      .poll(async () => /mWakefulness=(\w+)/.exec(await sh('dumpsys power'))?.[1])
      .toBe('Asleep');
    ok(await h.call('screen'));
    await expect
      .poll(async () => /mWakefulness=(\w+)/.exec(await sh('dumpsys power'))?.[1])
      .toBe('Awake');
    await open('home');
  });

  it('switches to the app switcher and home', async () => {
    await open('home');
    ok(await h.call('press_key', { key: 'app_switch' }));
    ok(await h.call('press_key', { key: 'home' }));
    expect((ok(await h.call('device_info')).data as { foreground?: string }).foreground).not.toBe(
      APP,
    );
  });

  it('manages apps: clear, grant, launch with extras, uninstall and install', async () => {
    ok(await h.call('app', { action: 'grant', service: 'location' }));
    expect(await sh(`dumpsys package ${APP}`)).toMatch(/ACCESS_FINE_LOCATION: granted=true/);
    ok(await h.call('app', { action: 'revoke', service: 'location' }));
    expect(await sh(`dumpsys package ${APP}`)).toMatch(/ACCESS_FINE_LOCATION: granted=false/);
    ok(await h.call('app', { action: 'launch', args: ['who=me'] }));
    expect((await h.call('app', { action: 'launch', env: { A: '1' } })).data.code).toBe(
      'UNSUPPORTED',
    );
    ok(await h.call('app', { action: 'clear' }));
    const apk = join(ROOT, 'android/fixture/build/outputs/apk/debug/fixture-debug.apk');
    expect(existsSync(apk)).toBe(true);
    ok(await h.call('app', { action: 'uninstall' }));
    expect(ok(await h.call('app', { action: 'state' })).data.state).toBe('not_installed');
    ok(await h.call('app', { action: 'install', path: apk }));
    expect(ok(await h.call('app', { action: 'state' })).data.state).toBe('stopped');
    expect((await h.call('app', { action: 'install', path: '/tmp/none.apk' })).error).toBe(true);
  });

  it('changes and restores dark mode, text size, animations, locale and the network', async () => {
    const get = async (c: string) => (await sh(c)).trim();
    const dark = await get('cmd uimode night');
    const font = await get('settings get system font_scale');
    const anim = await get('settings get global animator_duration_scale');
    ok(
      await h.call('device_setting', {
        name: 'dark_mode',
        value: dark.includes('yes') ? 'off' : 'on',
      }),
    );
    expect(await get('cmd uimode night')).not.toBe(dark);
    ok(await h.call('device_setting', { name: 'text_size', value: '1.3' }));
    expect(await get('settings get system font_scale')).toBe('1.3');
    ok(await h.call('device_setting', { name: 'animations', value: 'off' }));
    expect(await get('settings get global window_animation_scale')).toBe('0');
    ok(await h.call('device_setting', { name: 'reduce_motion', value: 'on' }));
    ok(await h.call('device_setting', { name: 'locale', value: 'tr-TR' }));
    expect(await get(`cmd locale get-app-locales ${APP}`)).toContain('tr-TR');
    ok(await h.call('device_setting', { name: 'network', value: 'slow' }));
    const restored = ok(await h.call('device_setting', { name: 'restore' }));
    expect(restored.text).toContain('dark_mode');
    expect(await get('cmd uimode night')).toBe(dark);
    expect(await get('settings get system font_scale')).toBe(font);
    expect(await get('settings get global animator_duration_scale')).toBe(anim);
    expect(await get(`cmd locale get-app-locales ${APP}`)).not.toContain('tr-TR');
    expect(ok(await h.call('device_setting', { name: 'restore' })).text).toContain('nothing');
  });

  it('posts a notification, and says biometrics are not here', async () => {
    ok(await h.call('device_setting', { name: 'push', value: 'merhaba', title: 'appdyno' }));
    // posting is queued: the list has it a moment later
    await expect.poll(() => sh('cmd notification list')).toContain('appdyno');
    const b = await h.call('device_setting', { name: 'biometric', value: 'match' });
    expect(b.data.code).toBe('UNSUPPORTED');
  });

  it('holds the device: a second process is refused by name, may share, and the holder shows', async () => {
    const other = join(ROOT, 'packages/appdyno/dist/main.js');
    const list = ok(await h.call('list_devices'));
    expect(JSON.stringify(list.data)).toContain(`"pid":${process.pid}`);
    if (!existsSync(other)) return;
    const refused = (() => {
      try {
        return execFileSync(process.execPath, [other, 'screen', '--device', android!], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        });
      } catch (e) {
        return (e as { stderr: string }).stderr;
      }
    })();
    expect(refused).toContain(`pid ${process.pid}`);
  });
});

const ios = process.env.APPDYNO_IOS_UDID;
describe.skipIf(!ios)('driving on a simulator', () => {
  let h: ReturnType<typeof harness>;
  const simctl = new Simctl();
  const open = async (screen: string) => {
    await h.call('terminate_app');
    ok(await h.call('launch_app'));
    if (screen !== 'home')
      ok(await h.call('open_link', { url: `appdyno-fixture://open/${screen}` }));
  };
  const PRODUCTS = join(ROOT, 'ios/.derived/Build/Products/Debug-iphonesimulator');

  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-drive-')));
    await simctl.install(ios!, join(PRODUCTS, 'Fixture.app'));
    h = harness(ios!, appleProvider());
    ok(await h.call('use_device', { device: ios!, app: APP }));
    ok(await h.call('launch_app'));
  }, 300_000);
  afterAll(async () => {
    await h.ctx.end();
    h.ctx.close();
  }, 60_000);

  shared(() => h, open, {
    field: { id: 'name_input' },
    row: (n) => `Product ${n}`,
    delayed: { shows: 'Loaded' },
  });

  it('pinches with two fingers in a plan, as the app sees it', async () => {
    await open('gestures');
    const f = ok(await h.call('find', { text: 'Gesture pad' }));
    const b = (f.data.matches as { x: number; y: number }[])[0]!;
    ok(
      await h.call('gesture', {
        kind: 'plan',
        pointers: [
          [
            { x: b.x - 20, y: b.y, t: 0 },
            { x: b.x - 80, y: b.y, t: 300 },
            { x: b.x - 120, y: b.y, t: 600 },
          ],
          [
            { x: b.x + 20, y: b.y, t: 0 },
            { x: b.x + 80, y: b.y, t: 300 },
            { x: b.x + 120, y: b.y, t: 600 },
          ],
        ],
      }),
    );
    ok(await h.call('assert', { text: 'pinches: 1', timeoutMs: 2_000 }));
  });

  it('reads and answers a permission alert', async () => {
    await simctl.privacy(ios!, 'reset', 'location', APP).catch(() => undefined);
    await open('permission');
    ok(await h.call('tap', { selector: { text: 'Request location' } }));
    const read = ok(await h.call('alert'));
    expect(read.text).toContain('buttons:');
    expect((await h.call('alert', { answer: 'No such button' })).error).toBe(true);
    ok(await h.call('alert', { answer: 'allow' }));
    expect(ok(await h.call('alert')).text).toContain('no system alert');
  });

  it('switches to the app switcher, and goes home', async () => {
    await open('home');
    ok(await h.call('press_key', { key: 'app_switch' }));
    ok(await h.call('press_key', { key: 'home' }));
    expect((ok(await h.call('device_info')).data as { foreground?: string }).foreground).not.toBe(
      APP,
    );
  });

  it('volume and lock answer, or say why not', async () => {
    await open('home');
    for (const key of ['volume_up', 'volume_down', 'lock']) {
      const r = await h.call('press_key', { key });
      if (r.error) expect(r.data.code).toBe('UNSUPPORTED');
      process.stderr.write(`${key}: ${r.text}\n`);
    }
    await open('home');
  });

  it('manages apps: permissions, launch with arguments, clear, uninstall and install', async () => {
    ok(await h.call('app', { action: 'grant', service: 'photos' }));
    ok(await h.call('app', { action: 'revoke', service: 'photos' }));
    ok(
      await h.call('app', { action: 'launch', args: ['-mode', 'test'], env: { FIXTURE_VAR: '1' } }),
    );
    ok(await h.call('app', { action: 'clear' }));
    expect(ok(await h.call('app', { action: 'state' })).data.state).toBe('stopped');
    ok(await h.call('app', { action: 'uninstall' }));
    expect(ok(await h.call('app', { action: 'state' })).data.state).toBe('not_installed');
    ok(await h.call('app', { action: 'install', path: join(PRODUCTS, 'Fixture.app') }));
    expect(ok(await h.call('app', { action: 'state' })).data.state).toBe('stopped');
    expect((await h.call('app', { action: 'install', path: '/tmp/none.app' })).error).toBe(true);
  });

  it('changes and restores dark mode, text size, reduce motion and locale', async () => {
    const ui = async (...w: string[]) => (await simctl.exec(['ui', ios!, ...w])).trim();
    const before = { dark: await ui('appearance'), size: await ui('content_size') };
    ok(
      await h.call('device_setting', {
        name: 'dark_mode',
        value: before.dark === 'dark' ? 'off' : 'on',
      }),
    );
    expect(await ui('appearance')).not.toBe(before.dark);
    ok(await h.call('device_setting', { name: 'text_size', value: 'extra-large' }));
    expect(await ui('content_size')).toBe('extra-large');
    ok(await h.call('device_setting', { name: 'reduce_motion', value: 'on' }));
    expect(ok(await h.call('device_setting', { name: 'reduce_motion' })).data.value).toBe('on');
    ok(await h.call('device_setting', { name: 'locale', value: 'tr-TR' }));
    expect(ok(await h.call('device_setting', { name: 'locale' })).data.value).toBe('tr_TR');
    const restored = ok(await h.call('device_setting', { name: 'restore' }));
    expect(restored.text).toContain('dark_mode');
    expect(await ui('appearance')).toBe(before.dark);
    expect(await ui('content_size')).toBe(before.size);
    expect(ok(await h.call('device_setting', { name: 'reduce_motion' })).data.value).toBe('off');
    expect((await h.call('device_setting', { name: 'network', value: 'slow' })).data.code).toBe(
      'UNSUPPORTED',
    );
    expect((await h.call('device_setting', { name: 'animations', value: 'off' })).data.code).toBe(
      'UNSUPPORTED',
    );
  });

  it('sends a push to the app and a biometric result', async () => {
    ok(await h.call('device_setting', { name: 'push', value: 'merhaba', title: 'appdyno' }));
    ok(await h.call('device_setting', { name: 'biometric', value: 'match' }));
  });
});

/** Last of all: it stops the emulator it names and starts its AVD again (read-only flags from the caller). */
const emulator = process.env.APPDYNO_TEST_EMULATOR;
describe.skipIf(!emulator)('emulator lifecycle', () => {
  it('lists, shuts down the one named, boots its AVD, and shuts down only that', async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-life-')));
    const adb = new Adb();
    const serials = async () => (await adb.devices()).map((d) => d.serial);
    const h = harness(emulator!, androidProvider(adb));
    const list = ok(await h.call('simulator', { action: 'list' }));
    const avd = new RegExp(`${emulator} "([^"]+)"`).exec(list.text)![1]!;
    const others = (await serials()).filter((x) => x !== emulator);
    expect(ok(await h.call('simulator', { action: 'shutdown' })).text).toContain(
      'none to shut down',
    );
    expect(await serials()).toContain(emulator);
    ok(await h.call('simulator', { action: 'shutdown', name: emulator! }));
    expect(await serials()).not.toContain(emulator);
    const up = ok(await h.call('simulator', { action: 'boot', name: avd }));
    const serial = up.data.serial as string;
    expect(await serials()).toContain(serial);
    expect(ok(await h.call('simulator', { action: 'list' })).text).toContain(
      'started by this tool',
    );
    ok(await h.call('simulator', { action: 'shutdown' }));
    expect(await serials()).not.toContain(serial);
    for (const o of others) expect(await serials()).toContain(o);
  }, 500_000);
});

describe.skipIf(!ios)('simulator lifecycle', () => {
  it('lists, shuts down the one named, and boots it again', async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-life-')));
    const h = harness(ios!, appleProvider());
    expect(ok(await h.call('simulator', { action: 'list' })).text).toContain(ios!);
    expect(ok(await h.call('simulator', { action: 'shutdown' })).text).toContain(
      'none to shut down',
    );
    expect(await new Simctl().state(ios!)).toBe('Booted');
    ok(await h.call('simulator', { action: 'shutdown', name: ios! }));
    expect(await new Simctl().state(ios!)).toBe('Shutdown');
    ok(await h.call('simulator', { action: 'boot', name: ios! }));
    expect(await new Simctl().state(ios!)).toBe('Booted');
    ok(await h.call('simulator', { action: 'shutdown' }));
    expect(await new Simctl().state(ios!)).toBe('Shutdown');
    ok(await h.call('simulator', { action: 'boot', name: ios! }));
  }, 400_000);
});
