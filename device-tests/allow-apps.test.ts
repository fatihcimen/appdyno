import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServerContext } from '@appdyno/ops';
import { checkedOps } from '../packages/ops/test/helpers.js';
import {
  Adb,
  androidProvider,
  pause,
  simulatorProvider,
  Simctl,
  type DeviceProvider,
} from './workspace.js';
import { type Call, opCaller, SIM_FIXTURE, SUITE_POLICY } from './helpers.js';

/**
 * `--allow-apps` on a device, the fixture alone allowed: it is driven, over its keyboard and its permission prompt, and
 * nothing lands in a home screen, Settings or a browser, nor opens there by a link. A call's link asks, and with no one to
 * ask opens nothing; its number is no emergency one. APPDYNO_ANDROID_SERIAL, APPDYNO_IOS_UDID.
 */
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const SIMULATOR = process.env.APPDYNO_IOS_UDID ?? '';
const APP = 'dev.appdyno.fixture';
const LINK = `appdyno-fixture://open`;

/** A server of `apps`, with `app` selected: '' selects none. */
const on = (provider: DeviceProvider, device: string, apps = [APP], app = APP) => {
  const ctx = new ServerContext({ ...SUITE_POLICY, apps }, [provider], {
    device,
    ...(app && { app }),
  });
  return { ctx, call: opCaller(checkedOps(ctx)) };
};

/**
 * The middle of the first node of the window `pkg` matches whose words `words` match, read for up to 15 s: a window
 * that comes in is not read until it has drawn.
 */
async function nodeIn(ctx: ServerContext, pkg: RegExp, words: RegExp) {
  const s = await ctx.session();
  const end = Date.now() + 15_000;
  for (;;) {
    const tree = await s.read().then(
      (r) => r.tree,
      (e: unknown) => {
        if (Date.now() > end) throw e;
        return { windows: [], nodes: [] };
      },
    );
    const n = tree.nodes.find(
      (x) =>
        pkg.test(tree.windows[x.w]?.pkg ?? '') &&
        x.b[2] > x.b[0] &&
        words.test(`${x.t ?? ''} ${x.d ?? ''} ${x.h ?? ''}`.trim()),
    );
    if (n || Date.now() > end)
      return n && { x: Math.round((n.b[0] + n.b[2]) / 2), y: Math.round((n.b[1] + n.b[3]) / 2) };
    await pause(300);
  }
}

/** Reads until `words` show, up to 10 s: a screen a link opens draws for a while. */
async function shows(call: Call, words: RegExp) {
  const end = Date.now() + 10_000;
  let text = '';
  while (Date.now() < end && !words.test(text)) text = (await call('screen')).text;
  expect(text).toMatch(words);
}

const refused = (r: { error: boolean; text: string; data: { code?: string } }, code: string) => {
  expect(r.error, r.text).toBe(true);
  expect(r.data.code, r.text).toBe(code);
  return r.text;
};

function suite(
  device: () => { provider: DeviceProvider; serial: string },
  home: RegExp,
  keys: RegExp,
) {
  let call: Call;
  let ctx: ServerContext;
  beforeAll(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-allow-apps-')));
    ({ ctx, call } = on(device().provider, device().serial));
  });
  afterAll(async () => {
    await call('terminate_app');
    ctx.close();
  });

  it('drives the fixture, its own keyboard and its permission prompt', async () => {
    expect((await call('open_link', { url: `${LINK}/form`, read: 'none' })).error).toBe(false);
    await shows(call, /Your name/);
    const field = await nodeIn(ctx, /fixture/, /Your name/);
    expect((await call('tap', { ...field, read: 'none' })).error).toBe(false);
    const key = await nodeIn(ctx, keys, /^q$|^Q$/);
    expect(key, 'a key of the keyboard').toBeDefined();
    const typed = await call('tap', { ...key, read: 'none' });
    expect(typed.error, typed.text).toBe(false);
    expect((await call('open_link', { url: `${LINK}/permission`, read: 'none' })).error).toBe(
      false,
    );
    const ask = await nodeIn(ctx, /fixture/, /^request location$/i);
    expect((await call('tap', { ...ask, read: 'none' })).error).toBe(false);
    const allow = await nodeIn(ctx, /permissioncontroller|springboard/, /while using|^allow/i);
    expect(allow, 'the prompt').toBeDefined();
    const answered = await call('tap', { ...allow, read: 'none' });
    expect(answered.error, answered.text).toBe(false);
  });

  it('refuses the home screen, and leaves it by launch_app', async () => {
    expect((await call('press_key', { key: 'home' })).error).toBe(false);
    await shows(call, home);
    const text = refused(await call('tap', { x: 100, y: 400 }), 'POLICY_DENIED');
    expect(text).toMatch(/^a touch lands in [\w.]+, not an allowed app \(dev\.appdyno\.fixture\)/);
    expect((await call('launch_app', { app: APP })).error).toBe(false);
  });

  it('opens no Settings, and no link outside the fixture', async () => {
    refused(
      await call('open_link', { url: 'App-prefs:root=General', read: 'none' }),
      'POLICY_DENIED',
    );
    refused(await call('open_link', { settings: 'about', read: 'none' }), 'POLICY_DENIED');
    const r = await call('open_link', { url: 'https://example.org/', read: 'none' });
    expect(r.error, r.text).toBe(true);
    expect((await (await ctx.session()).device.foreground()) ?? APP).toBe(APP);
  });

  it('opens no call by a link where no one can be asked, with any app allowed', async () => {
    const any = on(device().provider, device().serial, []);
    const text = refused(
      await any.call('open_link', { url: 'tel:5551234', read: 'none' }),
      'PERMISSION_REQUIRED',
    );
    expect(text).toContain('the link tel:5551234, which places a call asks the person first');
    // under the list it is no link of the fixture's either
    expect((await call('open_link', { url: 'tel:5551234', read: 'none' })).error).toBe(true);
    any.ctx.close();
  });
}

describe.skipIf(!ANDROID)('--allow-apps on an Android emulator', () => {
  suite(
    () => ({ provider: androidProvider(new Adb(), {}), serial: ANDROID }),
    /Phone|Chrome|Search/,
    /inputmethod/,
  );

  it("opens a link with no app selected only where the system's pick is allowed", async () => {
    const { ctx, call } = on(
      androidProvider(new Adb(), {}),
      ANDROID,
      [APP, 'dev.appdyno.other'],
      '',
    );
    const text = refused(
      await call('open_link', { url: 'https://example.org/', read: 'none' }),
      'POLICY_DENIED',
    );
    expect(text).toMatch(/^the link opens in [\w.]+, not an allowed app/);
    expect((await call('open_link', { url: `${LINK}/form`, read: 'none' })).error).toBe(false);
    ctx.close();
  });
});

describe.skipIf(!SIMULATOR)('--allow-apps on a simulator', () => {
  beforeAll(() => new Simctl().install(SIMULATOR, SIM_FIXTURE), 300_000);
  suite(
    () => ({ provider: simulatorProvider(), serial: SIMULATOR }),
    /Safari|Settings|Photos/,
    /fixture/,
  );
});
