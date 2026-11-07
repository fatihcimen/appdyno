import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Adb, androidProvider, simulatorProvider, Simctl } from './workspace.js';
import { type Answer, type Call, IPHONE, onIphone, opsOn, SIM_FIXTURE } from './helpers.js';

/** Settings at a page and at an app's own, read back from what it shows, on the devices the variables name. */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const SIMULATOR = process.env.APPDYNO_IOS_UDID;

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

/** Settings can answer before its page has come. */
const pageShows = async (call: Call, settings: string, shown: RegExp) => {
  ok(await call('open_link', { settings, read: 'none' }));
  const end = Date.now() + 8_000;
  let text = '';
  while (Date.now() < end && !shown.test(text)) text = (await call('screen')).text;
  expect(text).toMatch(shown);
};

describe.skipIf(!SIMULATOR)('Settings on a simulator', () => {
  let call: Call;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-settings-')));
    await new Simctl().install(SIMULATOR!, SIM_FIXTURE);
    call = opsOn(simulatorProvider(), SIMULATOR!, APP).call;
  }, 300_000);
  afterAll(() => call('terminate_app'));

  it.each([
    ['about', /text "About"/],
    ['privacy', /text "Privacy & Security"/],
    ['privacy_photos', /text "Photos"/],
    ['accessibility', /text "Accessibility"/],
    ['language_region', /"Language & Region"/],
    ['apps', /text "Apps"/],
    ['privacy_reminders', /text "Reminders"/],
    ['privacy_bluetooth', /text "Bluetooth"/],
    ['privacy_health', /text "Health"/],
    ['privacy_motion', /text "Motion & Fitness"/],
    ['privacy_speech', /text "Speech Recognition"/],
    ['privacy_media', /"Media & Apple Music"/],
    ['privacy_tracking', /text "Tracking"/],
    ['privacy_analytics', /"Analytics & Improvements"/],
    ['privacy_advertising', /"Apple Advertising"/],
    ['screen_time', /"Screen Time"/],
    ['camera', /text "Camera"/],
    ['game_center', /"Game Center"/],
    ['home_screen', /"Home Screen & App Library"/],
    ['developer', /text "Developer"/],
  ])('opens %s', (page, shown) => pageShows(call, page, shown));

  it("opens an app's own page, by its row on Apps", async () => {
    const r = ok(await call('open_link', { settings: 'app', read: 'full' }));
    expect(r.text).toMatch(/text "appdyno fixture"/);
    expect(r.text).toContain('tapped');
  });

  it('refuses a page a simulator has not got, by name', async () => {
    const r = await call('open_link', { settings: 'wifi' });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain('no wifi page');
  });

  it('goes back to the app by launching it', async () => {
    ok(await call('launch_app'));
    ok(await call('assert', { text: 'Form', timeoutMs: 5_000 }));
  });
});

describe.skipIf(!IPHONE)('Settings on an iPhone', () => {
  let o: Awaited<ReturnType<typeof onIphone>>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-settings-')));
    o = await onIphone(APP);
  }, 300_000);
  afterAll(async () => {
    await o.call('terminate_app');
    await o.ctx.end();
    o.ctx.close();
  }, 60_000);

  // pages with nothing of a person's; Wi-Fi stays out of it, as a phone's proxy is there
  it.each([
    ['about', /"(About|Hakkında)"/],
    ['privacy', /"(Privacy & Security|Gizlilik ve Güvenlik)"/],
    ['accessibility', /"(Accessibility|Erişilebilirlik)"/],
    ['language_region', /"(Language & Region|Dil ve Bölge)"/],
    ['display', /"(Display & Brightness|Ekran ve Parlaklık)"/],
  ])('opens %s', (page, shown) => pageShows(o.call, page, shown));

  it("opens an app's own page, by its row on Apps", async () => {
    const r = ok(await o.call('open_link', { settings: 'app', read: 'full' }));
    expect(r.text).toMatch(/text "appdyno fixture"/);
  });
});

describe.skipIf(!ANDROID)('Settings on Android', () => {
  let call: Call;
  beforeAll(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-settings-')));
    call = opsOn(androidProvider(new Adb()), ANDROID!, APP).call;
  });

  it.each([
    ['about', /Device name|Model|Cihaz|Telefon|sürüm/],
    ['wifi', /Internet|Wi.?Fi/],
    ['bluetooth', /Bluetooth|Pair new device/],
    ['display', /Display|Brightness|Ekran|Parlaklık/],
    ['sounds', /Sound|Media volume|Ses/],
    ['accessibility', /Accessibility|Erişilebilirlik/],
    ['apps', /All apps|App info|Apps|Uygulama/],
    ['privacy', /privacy|gizlilik/i],
    ['privacy_location', /Location|Konum/],
    ['language_region', /Language|dil|Dansk/i],
    ['keyboard', /keyboard|klavye/i],
    ['notifications', /notification|bildirim/i],
    ['battery', /Battery|Power saving|Pil/],
    ['general', /Search settings|Settings|Ayarlar/],
    ['software_update', /update|güncelle/i],
    ['storage', /storage|depolama/i],
    ['date_time', /Date|Tarih/],
    ['vpn', /VPN/],
    ['home_screen', /Home|Default|Ana ekran|Varsayılan/],
  ])('opens %s', (page, shown) => pageShows(call, page, shown));

  it("opens an app's own page", () => pageShows(call, 'app', /appdyno fixture|App info/));

  it('refuses a page Android has not got as one, by name', async () => {
    const r = await call('open_link', { settings: 'privacy_photos' });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain('no privacy_photos page');
  });
});
