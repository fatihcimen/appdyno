import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Adb, androidProvider, appleProvider, Simctl } from 'appdyno';
import { type Answer, type Call, opsOn } from './helpers.js';

/** The small arguments, each against what the device says, on the emulator and the simulator the variables name. */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const SIMULATOR = process.env.APPDYNO_IOS_UDID;
const PRODUCTS = join(import.meta.dirname, '../ios/.derived/Build/Products/Debug-iphonesimulator');

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

describe.skipIf(!ANDROID)('small tools on an emulator', () => {
  const shell = (...words: string[]) =>
    execFileSync('adb', ['-s', ANDROID!, 'shell', ...words], { encoding: 'utf8' }).trim();
  let o: ReturnType<typeof opsOn>;
  let call: Call;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-small-')));
    o = opsOn(androidProvider(new Adb()), ANDROID!, APP);
    call = o.call;
    ok(await call('launch_app'));
  });
  afterAll(async () => {
    await call('set_orientation', { orientation: 'portrait' });
    await call('device_setting', { name: 'restore' });
    o.ctx.close();
  });

  it('fixes a position and ends it, with no test provider left', async () => {
    ok(await call('set_location', { lat: 41.01, lon: 28.97 }));
    expect(shell('dumpsys', 'location')).toContain('[mock]');
    ok(await call('set_location', { clear: true }));
    expect(shell('dumpsys', 'location')).not.toContain('[mock]');
  });

  it('turns to each of the four rotations, as the device says', async () => {
    for (const [i, orientation] of ['landscape_left', 'upside_down', 'landscape_right'].entries()) {
      ok(await call('set_orientation', { orientation, read: 'none' }));
      expect(shell('settings', 'get', 'system', 'user_rotation')).toBe(String(i + 1));
    }
    ok(await call('set_orientation', { orientation: 'portrait', read: 'none' }));
    expect(shell('settings', 'get', 'system', 'user_rotation')).toBe('0');
  });
});

describe.skipIf(!ANDROID)('accessibility on an emulator', () => {
  let call: Call;
  const shell = (...words: string[]) =>
    execFileSync('adb', ['-s', ANDROID!, 'shell', ...words], { encoding: 'utf8' }).trim();
  beforeAll(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-small-')));
    call = opsOn(androidProvider(new Adb()), ANDROID!, APP).call;
  });

  it('turns on high contrast text, and it goes back', async () => {
    ok(await call('device_setting', { name: 'increase_contrast', value: 'on' }));
    expect(shell('settings', 'get', 'secure', 'high_text_contrast_enabled')).toBe('1');
    expect((await call('device_setting', { name: 'increase_contrast' })).data.value).toBe('on');
    ok(await call('device_setting', { name: 'restore' }));
    expect(shell('settings', 'get', 'secure', 'high_text_contrast_enabled')).not.toBe('1');
  });

  it('says Android has no reduce_transparency', async () => {
    const r = await call('device_setting', { name: 'reduce_transparency', value: 'on' });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain('no reduce_transparency switch');
  });
});

describe.skipIf(!SIMULATOR)('small tools on a simulator', () => {
  let o: ReturnType<typeof opsOn>;
  let call: Call;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-small-')));
    await new Simctl().install(SIMULATOR!, join(PRODUCTS, 'Fixture.app'));
    o = opsOn(appleProvider(), SIMULATOR!, APP);
    call = o.call;
    ok(await call('launch_app'));
  }, 300_000);
  afterAll(async () => {
    await call('set_orientation', { orientation: 'portrait' });
    await call('device_setting', { name: 'restore' });
    o.ctx.close();
  });

  it('turns on contrast and transparency, reads them back, and they go back', async () => {
    for (const name of ['increase_contrast', 'reduce_transparency']) {
      expect((await call('device_setting', { name })).data.value).toBe('off');
      ok(await call('device_setting', { name, value: 'on' }));
      expect((await call('device_setting', { name })).data.value).toBe('on');
    }
    ok(await call('device_setting', { name: 'restore' }));
    for (const name of ['increase_contrast', 'reduce_transparency'])
      expect((await call('device_setting', { name })).data.value).toBe('off');
  });

  it('fixes a position and ends it, as the simulator takes both', async () => {
    ok(await call('set_location', { lat: 41.01, lon: 28.97 }));
    ok(await call('set_location', { clear: true }));
  });

  it('holds a drag before it moves: the pad sees the same travel, later', async () => {
    ok(await call('open_link', { url: 'appdyno-fixture://open/gestures' }));
    const at = Date.now();
    ok(
      await call('gesture', {
        kind: 'drag',
        selector: { text: 'Gesture pad' },
        to: { x: 200, y: 700 },
        holdMs: 1_500,
      }),
    );
    expect(Date.now() - at).toBeGreaterThan(1_500);
    expect(ok(await call('find', { id: 'travel' })).data.matches[0]!.label).not.toBe('travel: 0');
    ok(await call('launch_app'));
  });

  it('turns to a landscape and back, and the app lays out for it', async () => {
    const y = async () => ok(await call('find', { text: 'Permission' })).data.matches[0]!.y;
    const upright = await y();
    ok(await call('set_orientation', { orientation: 'landscape_right', read: 'none' }));
    await vi.waitFor(async () => expect(await y()).not.toBe(upright), { timeout: 8_000 });
    ok(await call('set_orientation', { orientation: 'portrait', read: 'none' }));
    await vi.waitFor(async () => expect(await y()).toBe(upright), { timeout: 8_000 });
  });
});
