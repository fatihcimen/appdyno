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

  it('mutes the media stream and turns it back, and calls the assistant', async () => {
    const muted = () => /- STREAM_MUSIC:\s+Muted: (\w+)/.exec(shell('dumpsys', 'audio'))?.[1];
    expect(muted()).toBe('false');
    ok(await call('press_key', { key: 'mute' }));
    expect(muted()).toBe('true');
    ok(await call('press_key', { key: 'mute' }));
    expect(muted()).toBe('false');
    // the volume panel leaves no window to read while it is up
    await new Promise((r) => setTimeout(r, 5_000));
    expect(ok(await call('press_key', { key: 'siri' })).text).toContain('not read');
    ok(await call('press_key', { key: 'home', read: 'none' }));
    // the assistant's sheet takes a moment to go, and leaves no window to read until it has
    await vi.waitFor(async () => ok(await call('launch_app')), {
      timeout: 15_000,
      interval: 1_000,
    });
  });

  it('fixes a position and ends it, with no test provider left', async () => {
    ok(await call('set_location', { lat: 41.01, lon: 28.97 }));
    expect(shell('dumpsys', 'location')).toContain('[mock]');
    ok(await call('set_location', { clear: true }));
    expect(shell('dumpsys', 'location')).not.toContain('[mock]');
  });

  it('saves a picture at the size of the screen', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'appdyno-shot-')), 'screen.png');
    const r = ok(await call('screenshot', { file }));
    expect(r.data.width).toBe(ok(await call('device_info')).data.screen.w);
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

/** The language the fixture says it was launched in. */
const language = async (call: Call) => {
  ok(await call('open_link', { url: 'appdyno-fixture://open/locale' }));
  const seen = ok(await call('find', { id: 'result' })).data.matches[0]!;
  return seen.label;
};

describe.skipIf(!ANDROID)('a language on an emulator', () => {
  it('stays with the app until it is put back', async () => {
    const { call, ctx } = opsOn(androidProvider(new Adb()), ANDROID!, APP);
    ok(await call('launch_app', { language: 'tr-TR' }));
    expect(await language(call)).toContain('tr-TR');
    ok(await call('device_setting', { name: 'restore' }));
    await call('terminate_app');
    ok(await call('launch_app'));
    expect(await language(call)).not.toContain('tr');
    ctx.close();
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

  it('mutes by the Action button, where the simulated phone has one', async () => {
    const ring = () =>
      execFileSync(
        'xcrun',
        ['simctl', 'spawn', SIMULATOR!, 'notifyutil', '-g', 'com.apple.springboard.ringerstate'],
        {
          encoding: 'utf8',
        },
      ).trim();
    const was = ring();
    ok(await call('press_key', { key: 'mute' }));
    await vi.waitFor(() => expect(ring()).not.toBe(was), { timeout: 5_000 });
    ok(await call('press_key', { key: 'mute' }));
    await vi.waitFor(() => expect(ring()).toBe(was), { timeout: 5_000 });
  });

  it('holds the side button for Siri, as a window does', async () => {
    ok(await call('press_key', { key: 'siri', read: 'none' }));
    ok(await call('press_key', { key: 'home', read: 'none' }));
    ok(await call('launch_app'));
  });

  it('launches in a language for that launch alone', async () => {
    ok(await call('launch_app', { language: 'tr' }));
    expect(await language(call)).toContain('tr');
    await call('terminate_app');
    ok(await call('launch_app'));
    expect(await language(call)).not.toContain('tr');
    ok(await call('launch_app'));
  });

  it("saves a picture at the screen's own size, and refuses to replace one", async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'appdyno-shot-')), 'screen.png');
    const r = ok(await call('screenshot', { file }));
    const { w, density } = ok(await call('device_info')).data.screen;
    expect(r.data.width).toBe(Math.round(w * density));
    expect((await call('screenshot', { file })).text).toContain('is there already');
  });

  it('takes a picture whose pixels are points', async () => {
    const r = ok(await call('screenshot', { points: true }));
    const { w, h } = ok(await call('device_info')).data.screen;
    expect([r.data.width, r.data.height]).toEqual([w, h]);
    expect(r.data.scale).toBe(1);
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
