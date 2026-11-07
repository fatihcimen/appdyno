import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, ServerContext, type Op } from '@appdyno/ops';
import { checkedOps } from '../packages/ops/test/helpers.js';
import { opCaller, SUITE_POLICY, type Answer, type Call, SIM_FIXTURE } from './helpers.js';
import {
  Adb,
  AndroidDevice,
  AndroidEmulators,
  androidProvider,
  appleProvider,
  Devicectl,
  Simctl,
} from './workspace.js';

/**
 * Driving on real devices, through the operations an agent calls: one suite per platform, each on the
 * device its variable names (never a default).
 */
const APP = 'dev.appdyno.fixture';
const ROOT = join(import.meta.dirname, '..');

function harness(serial: string, provider: ConstructorParameters<typeof ServerContext>[1][number]) {
  const ctx = new ServerContext(SUITE_POLICY, [provider], {
    device: serial,
    app: APP,
    claims: true,
  });
  const call = opCaller(checkedOps(ctx));
  return { ctx, call };
}

const ok = <A extends Answer>(r: A) => {
  expect(r.text && !r.error ? '' : r.text).toBe('');
  return r;
};

/** What both platforms must do, given how each opens the fixture and names its parts. */
function shared(
  get: () => {
    call: Call;
    ctx: ServerContext;
  },
  open: (screen: string) => Promise<void>,
  names: {
    field: { id?: string; role?: string; index?: number };
    row: (n: number) => string;
    /** The button that starts the delayed screen's work, if it has one, and what shows after. */
    delayed: { start?: string; shows: string };
    /** A step that goes back a screen. */
    back: Record<string, unknown>;
    /** A phone's runner cannot reach the clipboard: iOS would ask the user. */
  },
) {
  const call: Call = (n, a) => get().call(n, a);

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

  it('waits on the device: at once with no baseline, then only for a change', async () => {
    await open('home');
    const { device } = await get().ctx.session();
    const first = await device.waitChange!(undefined, 0);
    expect(first?.tree).toBeDefined();
    // a clock may tick once: of two waits on a still screen one answers with nothing
    const quiet = await device.waitChange!(first!.sig, 800);
    const again = quiet?.tree ? await device.waitChange!(quiet.sig, 800) : quiet;
    expect(again?.tree).toBeUndefined();
    ok(await call('tap', { selector: { text: 'Form' }, read: 'none' }));
    const moved = await device.waitChange!(again!.sig, 8_000);
    expect(moved?.tree).toBeDefined();
    expect(moved?.sig).not.toBe(again!.sig);
  });

  it('waits on the device, whichever way the screen comes', async () => {
    await open('delayed');
    if (names.delayed.start) ok(await call('tap', { selector: { text: names.delayed.start } }));
    const r = await call('wait_for', { text: names.delayed.shows, timeoutMs: 8_000 });
    expect(r.data.met).toBe(true);
    const absent = await call('wait_for', { text: 'Never', timeoutMs: 600 });
    expect(absent.error).toBe(true);
    expect(absent.data.code).toBe('TIMEOUT');
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
    const m = f.data.matches[0]!;
    expect(m).toMatchObject({ enabled: true, focused: true, value: 'Ayşe' });
    expect(m.bounds.w).toBeGreaterThan(0);
    ok(await call('assert', { ...names.field, check: 'text', equals: 'Ayşe' }));
    expect((await call('assert', { ...names.field, check: 'text', equals: 'No' })).data.code).toBe(
      'CHECK_FAILED',
    );
  });

  it('says whether the keyboard is open, and closes it or says it cannot', async () => {
    await open('form');
    ok(await call('tap', { selector: names.field }));
    expect(ok(await call('keyboard', { action: 'status' })).data.open).toBe(true);
    const r = await call('keyboard', { action: 'dismiss' });
    if (r.error) expect(r.text).toContain('stayed open');
    else expect(ok(await call('keyboard', { action: 'status' })).data.open).toBe(false);
  });

  it('double-taps, drags and runs a plan, as the app sees it', async () => {
    await open('gestures');
    const pad = { selector: { text: 'Gesture pad' } };
    ok(await call('gesture', { kind: 'double_tap', ...pad }));
    ok(await call('assert', { text: 'double taps: 1' }));
    const f = ok(await call('find', { text: 'Gesture pad' }));
    const b = f.data.matches[0]!;
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

  it('reads the clipboard it set, then types without asking the user about it', async (ctx) => {
    await open('form');
    // on a phone it is a person's
    const held = await call('clipboard');
    const set = await call('clipboard', { text: 'pano içeriği' });
    // a simulator whose pasteboard stalls on a loaded Mac: a refusal that says so, not a hang
    if (set.error && /did not take the text/.test(set.text)) return ctx.skip();
    ok(set);
    expect(ok(await call('clipboard')).text).toBe('pano içeriği');
    ok(await call('type_text', { text: 'x', selector: names.field }));
    ok(await call('assert', { ...names.field, check: 'text', equals: 'x' }));
    if (!held.error && held.text !== 'the clipboard is empty')
      ok(await call('clipboard', { text: held.text }));
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

  it('runs 20 steps within a client’s patience', async () => {
    await open('home');
    const pair = [{ action: 'tap', selector: { text: 'Form' } }, names.back];
    const t0 = Date.now();
    const r = await call('steps', { steps: Array(10).fill(pair).flat() });
    const ms = Date.now() - t0;
    process.stderr.write(
      `20 steps: ${ms} ms${r.error ? `, failed: ${r.text.slice(0, 300)}` : ''}\n`,
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
    back: { action: 'press_key', key: 'back' },
  });

  it('counts two fingers in a plan', async () => {
    await open('gestures');
    const f = ok(await h.call('find', { text: 'Gesture pad' }));
    const b = f.data.matches[0]!;
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
    await open('home');
    const volume = async () => (await sh('dumpsys audio')).match(/Current: [^\n]*/g)?.join();
    const before = await volume();
    expect(before).toBeDefined();
    // presses are ignored until the volume panel shows, which can take more than one
    let presses = 0;
    while ((await volume()) === before && presses++ < 6)
      ok(await h.call('press_key', { key: 'volume_up' }));
    const raised = await volume();
    expect(raised).not.toBe(before);
    ok(await h.call('press_key', { key: 'volume_down' }));
    await expect.poll(volume, { timeout: 5_000 }).not.toBe(raised);
    ok(await h.call('press_key', { key: 'lock' }));
    // a Pixel image dozes for seconds first, with its windows still there to read, and an always-on display stays so
    await expect
      .poll(async () => /mWakefulness=(\w+)/.exec(await sh('dumpsys power'))?.[1], {
        timeout: 15_000,
      })
      .not.toBe('Awake');
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
    expect(ok(await h.call('device_info')).data.foreground).not.toBe(APP);
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
    const slow = await h.call('device_setting', { name: 'network', value: 'slow' });
    // a phone from Android 13 caps its downloads
    const shapes =
      android!.startsWith('emulator-') || Number(await get('getprop ro.build.version.sdk')) >= 33;
    if (shapes) ok(slow);
    else expect(slow.data.code).toBe('UNSUPPORTED');
    const restored = ok(await h.call('device_setting', { name: 'restore' }));
    expect(restored.text).toContain('dark_mode');
    expect(await get('cmd uimode night')).toBe(dark);
    // Android writes 1.0 back by itself once a scale has been set and deleted
    expect(font === 'null' ? ['null', '1.0'] : [font]).toContain(
      await get('settings get system font_scale'),
    );
    expect(await get('settings get global animator_duration_scale')).toBe(anim);
    expect(await get(`cmd locale get-app-locales ${APP}`)).not.toContain('tr-TR');
    expect(await get('settings get global ingress_rate_limit_bytes_per_second')).toBe('null');
    expect(ok(await h.call('device_setting', { name: 'restore' })).text).toContain('nothing');
  });

  it('has one owner for the animations: the session option gives way to a setting', async () => {
    const scales = () =>
      sh(
        'settings get global window_animation_scale; settings get global transition_animation_scale; settings get global animator_duration_scale',
      );
    const before = await scales();
    const session = () => {
      const ctx = new ServerContext(DEFAULT_POLICY, [androidProvider(adb, { animations: 'off' })], {
        device: android!,
        app: APP,
        share: true,
      });
      const ops = checkedOps(ctx);
      const set = async (args: Record<string, unknown>) => {
        const op = ops.device_setting as Op;
        return op.handler(op.input.parse(args) as Record<string, unknown>);
      };
      return { ctx, set };
    };
    // the option, then a setting: the setting's old value is the user's, not the option's zeros
    const a = session();
    await a.ctx.use(android!);
    expect((await scales()).replace(/\s+/g, ' ').trim()).toBe('0 0 0');
    await a.set({ name: 'animations', value: 'on' });
    expect((await scales()).replace(/\s+/g, ' ').trim()).toBe('1 1 1');
    await a.ctx.end();
    a.ctx.close();
    await expect.poll(scales, { timeout: 15_000, interval: 500 }).toBe(before);

    // a setting, then a session with the option that dies and comes back: as the user had them, whichever came last
    ok(await h.call('device_setting', { name: 'animations', value: 'off' }));
    const b = session();
    await b.ctx.use(android!);
    await b.set({ name: 'restore' });
    await b.ctx.end();
    b.ctx.close();
    ok(await h.call('device_setting', { name: 'restore' }));
    await expect.poll(scales, { timeout: 15_000, interval: 500 }).toBe(before);
  }, 120_000);

  it('posts a notification, and says biometrics are not here', async () => {
    ok(await h.call('push', { type: 'alert', title: 'appdyno', body: 'merhaba' }));
    // posting is queued: the list has it a moment later
    await expect.poll(() => sh('cmd notification list')).toContain('appdyno');
    const b = await h.call('device_setting', { name: 'biometric', value: 'match' });
    expect(b.data.code).toBe('UNSUPPORTED');
  });

  it('holds the device: a second process is refused by name, may share, and the holder shows', async (ctx) => {
    const other = join(ROOT, 'packages/appdyno/dist/main.js');
    const list = ok(await h.call('list_devices'));
    expect(JSON.stringify(list.data)).toContain(`"pid":${process.pid}`);
    if (!existsSync(other)) return ctx.skip();
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

  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-drive-')));
    await simctl.install(ios!, SIM_FIXTURE);
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
    back: { action: 'tap', selector: { text: 'Back' } },
  });

  it('pinches with two fingers in a plan, as the app sees it', async () => {
    await open('gestures');
    const f = ok(await h.call('find', { text: 'Gesture pad' }));
    const b = f.data.matches[0]!;
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
    // the home screen may come later than the settle's window
    await expect
      .poll(async () => ok(await h.call('device_info')).data.foreground, {
        timeout: 8_000,
      })
      .not.toBe(APP);
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
    ok(await h.call('app', { action: 'install', path: SIM_FIXTURE }));
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
    // with an app selected, its own launches: the whole simulator is left alone
    const global = await simctl.exec(['spawn', ios!, 'defaults', 'read', '-g', 'AppleLocale']);
    ok(await h.call('device_setting', { name: 'locale', value: 'tr-TR' }));
    expect(ok(await h.call('device_setting', { name: 'locale' })).data.value).toBe('tr-TR');
    expect(await simctl.exec(['spawn', ios!, 'defaults', 'read', '-g', 'AppleLocale'])).toBe(
      global,
    );
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

  // neither leaves anything to read back: what stands here is that the simulator takes them
  it('takes a push and a biometric result with no refusal', async () => {
    ok(await h.call('push', { type: 'alert', title: 'appdyno', body: 'merhaba' }));
    ok(await h.call('device_setting', { name: 'biometric', value: 'match' }));
  });
});

const iphone = process.env.APPDYNO_IPHONE_UDID;
const iphoneFixture = process.env.APPDYNO_IPHONE_FIXTURE_APP;
describe.skipIf(!iphone || !iphoneFixture)('driving on an iPhone', () => {
  let h: ReturnType<typeof harness>;
  const open = async (screen: string) => {
    await h.call('terminate_app');
    ok(await h.call('launch_app'));
    if (screen !== 'home')
      ok(await h.call('open_link', { url: `appdyno-fixture://open/${screen}` }));
  };

  beforeAll(async () => {
    await new Devicectl(iphone!).install(iphoneFixture!);
    h = harness(iphone!, appleProvider());
    ok(await h.call('use_device', { device: iphone!, app: APP }));
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
    back: { action: 'tap', selector: { text: 'Back' } },
  });

  it('lists apps and their state, launches with an environment, uninstalls and installs', async () => {
    const mine = ok(await h.call('app', { action: 'list' }));
    expect(mine.text).toContain(APP);
    expect(ok(await h.call('app', { action: 'list', all: true })).text).toContain(
      'com.apple.Preferences',
    );
    ok(
      await h.call('app', { action: 'launch', args: ['-mode', 'test'], env: { FIXTURE_VAR: '1' } }),
    );
    expect(ok(await h.call('app', { action: 'state' })).data.state).toBe('foreground');
    ok(await h.call('terminate_app'));
    expect(ok(await h.call('app', { action: 'state' })).data.state).toBe('stopped');
    ok(await h.call('app', { action: 'uninstall' }));
    expect(ok(await h.call('app', { action: 'state' })).data.state).toBe('not_installed');
    ok(await h.call('app', { action: 'install', path: iphoneFixture! }));
    expect(ok(await h.call('app', { action: 'state' })).data.state).toBe('stopped');
    expect((await h.call('app', { action: 'install', path: '/tmp/none.app' })).error).toBe(true);
  }, 240_000);

  it('says what an iPhone cannot do, and why', async () => {
    for (const [action, why] of [
      ['clear', /uninstall/],
      ['grant', /alert/],
      ['revoke', /alert/],
    ] as const) {
      const r = await h.call('app', { action, service: 'camera' });
      expect(r.data.code, action).toBe('UNSUPPORTED');
      expect(r.text).toMatch(why);
    }
    for (const name of ['animations', 'network', 'proxy', 'battery']) {
      const r = await h.call('device_setting', { name, value: name === 'battery' ? '50' : 'on' });
      expect(r.data.code, name).toBe('UNSUPPORTED');
    }
    for (const [name, value] of [
      ['push', 'x'],
      ['biometric', 'match'],
      ['fold', 'open'],
      ['call', '5551234'],
      ['sms', 'x'],
    ] as const)
      expect((await h.call('device_setting', { name, value })).data.code, name).toBe('UNSUPPORTED');
  });

  it('changes and restores dark mode, text size and reduce motion', async () => {
    const read = async (name: string) => ok(await h.call('device_setting', { name })).data.value!;
    const before = {
      dark: await read('dark_mode'),
      size: await read('text_size'),
      motion: await read('reduce_motion'),
    };
    expect(before.dark).toMatch(/^(light|dark)$/);
    expect(before.motion).toMatch(/^(on|off)$/);
    const other = before.dark === 'dark' ? 'off' : 'on';
    ok(await h.call('device_setting', { name: 'dark_mode', value: other }));
    expect(await read('dark_mode')).toBe(before.dark === 'dark' ? 'light' : 'dark');
    const size = before.size === 'extra-large' ? 'large' : 'extra-large';
    ok(await h.call('device_setting', { name: 'text_size', value: size }));
    expect(await read('text_size')).toBe(size);
    ok(
      await h.call('device_setting', {
        name: 'reduce_motion',
        value: before.motion === 'on' ? 'off' : 'on',
      }),
    );
    expect(await read('reduce_motion')).not.toBe(before.motion);
    const restored = ok(await h.call('device_setting', { name: 'restore' }));
    expect(restored.text).toContain('dark_mode');
    expect(await read('dark_mode')).toBe(before.dark);
    expect(await read('text_size')).toBe(before.size);
    expect(await read('reduce_motion')).toBe(before.motion);
  }, 120_000);

  it('presses volume, then locks and comes back', async () => {
    await open('home');
    ok(await h.call('press_key', { key: 'volume_up' }));
    ok(await h.call('press_key', { key: 'volume_down' }));
    ok(await h.call('press_key', { key: 'lock', read: 'none' }));
    // the next launch must find the phone usable again
    await open('home');
    ok(await h.call('assert', { text: 'appdyno fixture' }));
  }, 120_000);
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
    // other work may run the same AVD: the name is then ambiguous, a refusal, and the driver boots it as asked
    const up = await h.call('simulator', { action: 'boot', name: avd });
    if (up.error) expect(up.data.code).toBe('AMBIGUOUS');
    const serial = up.error ? await new AndroidEmulators(adb).boot(avd) : up.data.serial!;
    expect(await serials()).toContain(serial);
    if (!up.error) {
      expect(ok(await h.call('simulator', { action: 'list' })).text).toContain(
        'started by this tool',
      );
      ok(await h.call('simulator', { action: 'shutdown' }));
    } else ok(await h.call('simulator', { action: 'shutdown', name: serial }));
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
