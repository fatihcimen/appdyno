import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Adb, androidProvider, appleProvider, Simctl } from 'appdyno';
import { type Answer, type Call, opsOn } from './helpers.js';

/** Settings at a page and at an app's own, read back from what it shows, on the devices the variables name. */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const SIMULATOR = process.env.APPDYNO_IOS_UDID;
const PRODUCTS = join(import.meta.dirname, '../ios/.derived/Build/Products/Debug-iphonesimulator');

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
    await new Simctl().install(SIMULATOR!, join(PRODUCTS, 'Fixture.app'));
    call = opsOn(appleProvider(), SIMULATOR!, APP).call;
  }, 300_000);
  afterAll(() => call('terminate_app'));

  it.each([
    ['about', /text "About"/],
    ['privacy', /text "Privacy & Security"/],
    ['privacy_photos', /text "Photos"/],
    ['accessibility', /text "Accessibility"/],
    ['language_region', /"Language & Region"/],
    ['apps', /text "Apps"/],
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

describe.skipIf(!ANDROID)('Settings on an emulator', () => {
  let call: Call;
  beforeAll(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-settings-')));
    call = opsOn(androidProvider(new Adb()), ANDROID!, APP).call;
  });

  it.each([
    ['about', /Device name/],
    ['wifi', /Internet|Wi.?Fi/],
    ['bluetooth', /Bluetooth|Pair new device/],
    ['display', /Display|Brightness/],
    ['sounds', /Sound|Media volume/],
    ['accessibility', /Accessibility/],
    ['apps', /All apps|App info|Apps/],
    ['privacy', /privacy/i],
    ['privacy_location', /Location/],
    ['language_region', /Language/],
    ['keyboard', /keyboard|Keyboard/],
    ['notifications', /Notification|notification/],
    ['battery', /Battery/],
    ['general', /Search settings|Settings/],
  ])('opens %s', (page, shown) => pageShows(call, page, shown));

  it("opens an app's own page", () => pageShows(call, 'app', /appdyno fixture|App info/));

  it('refuses a page Android has not got as one, by name', async () => {
    const r = await call('open_link', { settings: 'privacy_photos' });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain('no privacy_photos page');
  });
});
