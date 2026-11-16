import { assert, beforeAll, describe, expect, it } from 'vitest';
import {
  buildScreen,
  DeviceError,
  IosSimulatorDevice,
  NoViewProbe,
  type NativeView,
  type Screen,
  Simctl,
  simulatorProvider,
  sleep,
} from './workspace.js';
import { opsOn, SIM_FIXTURE } from './helpers.js';

/**
 * The fixture's native views on a simulator (APPDYNO_IOS_UDID), by the view probe `launch_app probe` puts in it: SwiftUI
 * on the home screen, UIKit inside SwiftUI on `uikit`, a web view inside SwiftUI on `web`; a secure field's characters
 * nowhere; a main thread that does not answer said as such.
 */
const udid = process.env.APPDYNO_IOS_UDID ?? '';
const APP = 'dev.appdyno.fixture';
const SECRET = 'hunter2views';

describe.skipIf(!udid)('screen views on a simulator', () => {
  const t = opsOn(simulatorProvider(), udid, APP);
  let d: IosSimulatorDevice;
  const open = async (screen: string) => {
    await d.openUrl(`appdyno-fixture://open/${screen}`, APP);
    await sleep(800);
  };
  const screen = async (): Promise<Screen> =>
    buildScreen(await d.tree(), { port: d.platformScreen, appId: APP });
  /** The view is where the accessibility tree has the element of its id. */
  const samePlace = async (v: NativeView) => {
    const seen = (await screen()).list.find((e) => e.id === v.id);
    assert(seen?.rect);
    console.log('view', v.rect, 'element', seen.rect);
    for (const k of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(v.rect[k] - seen.rect[k])).toBeLessThan(2);
  };
  /** `screen views raw`, timed. */
  const views = async () => {
    const from = Date.now();
    const r = await t.call('read_screen', { views: true, raw: true });
    const ms = Date.now() - from;
    console.log(`${String(ms)} ms, ${String(r.data.elements)} views\n${r.text.slice(0, 1500)}`);
    expect(r.error).toBe(false);
    return { ...r, ms, views: (r.data.views ?? []) as NativeView[] };
  };

  beforeAll(async () => {
    await new Simctl().install(udid, SIM_FIXTURE);
    d = (await t.ctx.session()).device as IosSimulatorDevice;
    return async () => {
      // its probe and the slow start the last test asked for end with it
      await d.terminate(APP);
      await d.stopAgent();
      t.ctx.close();
    };
  }, 240_000);

  it('refuses an app started without the probe, naming what puts it in', async () => {
    await d.terminate(APP);
    await d.launch(APP);
    const r = await t.call('read_screen', { views: true });
    console.log(r.text);
    expect([r.error, r.data.code]).toEqual([true, 'UNSUPPORTED']);
    expect(r.text).toMatch(
      /runs without the view probe; its bundle holds no Flutter or React Native/,
    );
    expect(await d.views().catch((e: unknown) => e)).toBeInstanceOf(NoViewProbe);
  }, 120_000);

  it('reads the home screen as SwiftUI once launch_app puts the probe in', async () => {
    const launched = await t.call('launch_app', { restart: true, probe: true, read: 'none' });
    expect(launched.text).toContain('with the view probe in it');
    await sleep(1_000);
    const home = await views();
    expect(home.data.framework).toBe('SwiftUI');
    expect(home.views[0]?.class).toBe('UIWindow');
    expect(home.views.some((v) => v.class.startsWith('SwiftUI._UIHostingView<'))).toBe(true);
  }, 120_000);

  it('reads UIKit inside SwiftUI, at the places and with the words the accessibility tree has', async () => {
    await open('uikit');
    const uikit = await views();
    expect(uikit.data.framework).toBe('UIKit inside SwiftUI');
    const label = uikit.views.find((v) => v.id === 'uikit_label');
    assert(label);
    expect([label.class, label.text]).toEqual(['UILabel', 'UIKit label']);
    expect(uikit.views.find((v) => v.id === 'uikit_table')?.class).toBe('UITableView');
    expect(uikit.views.some((v) => v.controller?.endsWith('TableController'))).toBe(true);
    expect(uikit.text).toMatch(/UILabel #uikit_label "UIKit label"/);
    await samePlace(label);
  }, 120_000);

  it('gives the places of a turned screen as its accessibility tree does', async () => {
    try {
      expect(
        (await t.call('set_device', { name: 'orientation', value: 'landscape_left' })).error,
      ).toBe(false);
      await sleep(1_000);
      const label = (await views()).views.find((v) => v.id === 'uikit_label');
      assert(label);
      expect(label.rect.width).toBeGreaterThan(500);
      await samePlace(label);
    } finally {
      await t.call('set_device', { name: 'orientation', value: 'portrait' });
    }
  }, 120_000);

  it('reads a web view inside SwiftUI', async () => {
    await open('web');
    await sleep(1_500);
    const web = await views();
    expect(web.data.framework).toBe('web view inside SwiftUI');
    expect(web.views.some((v) => v.class === 'WKWebView')).toBe(true);
  }, 120_000);

  it("keeps the probe through this tool's launch without it", async () => {
    const launched = await t.call('launch_app', { restart: true, read: 'none' });
    expect(launched.error).toBe(false);
    await sleep(1_000);
    expect((await views()).data.framework).toBe('SwiftUI');
  }, 120_000);

  it("never says what a secure field holds, the field's own views' text among it", async () => {
    await open('form');
    expect(
      (await t.call('tap_screen', { selector: { id: 'password_input' }, read: 'none' })).error,
    ).toBe(false);
    expect((await t.call('type_text', { text: SECRET, read: 'none' })).error).toBe(false);
    const form = await views();
    const field = form.views.find((v) => v.id === 'password_input');
    console.log(JSON.stringify(field));
    assert(field);
    expect(field.text).toBeUndefined();
    expect(JSON.stringify(form)).not.toContain(SECRET);
  }, 120_000);

  it('refuses an app behind the home screen, which iOS sends to the background and suspends', async () => {
    expect((await t.call('press_key', { key: 'home' })).error).toBe(false);
    for (const wait of [1_000, 12_000]) {
      await sleep(wait);
      const from = Date.now();
      const behind = await t.call('read_screen', { views: true });
      console.log(`${String(Date.now() - from)} ms ${behind.text}`);
      expect([behind.error, behind.data.code]).toEqual([true, 'APP_NOT_RUNNING']);
    }
  }, 120_000);

  it('says a main thread that does not answer within 2 s did not', async () => {
    const env = { APPDYNO_FIXTURE_SLEEP_MS: '4000' };
    expect((await t.call('launch_app', { restart: true, env, read: 'none' })).error).toBe(false);
    await sleep(1_000);
    await open('stall');
    const light = (await screen()).list.find((e) => e.id === 'stall_light');
    assert(light?.rect);
    const at = { x: light.rect.x + light.rect.width / 2, y: light.rect.y + light.rect.height / 2 };
    const tapped = d.tap(at, { settle: false, read: 'none' }).catch(() => undefined);
    await sleep(800);
    const from = Date.now();
    const hung = await d.views().then(
      () => undefined,
      (e: unknown) => e,
    );
    console.log(`${String(Date.now() - from)} ms`, hung);
    assert(hung instanceof DeviceError);
    expect(hung.code).toBe('TIMEOUT');
    expect(hung.message).toMatch(/did not answer the view probe within 2 s/);
    await tapped;
    await sleep(4_000);
    expect((await views()).data.framework).toBe('SwiftUI');
  }, 120_000);
});
