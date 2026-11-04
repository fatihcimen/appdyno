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

  it('turns to each of the four rotations, as the device says', async () => {
    for (const [i, orientation] of ['landscape_left', 'upside_down', 'landscape_right'].entries()) {
      ok(await call('set_orientation', { orientation, read: 'none' }));
      expect(shell('settings', 'get', 'system', 'user_rotation')).toBe(String(i + 1));
    }
    ok(await call('set_orientation', { orientation: 'portrait', read: 'none' }));
    expect(shell('settings', 'get', 'system', 'user_rotation')).toBe('0');
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

  it('turns to a landscape and back, and the app lays out for it', async () => {
    const y = async () => ok(await call('find', { text: 'Permission' })).data.matches[0]!.y;
    const upright = await y();
    ok(await call('set_orientation', { orientation: 'landscape_right', read: 'none' }));
    await vi.waitFor(async () => expect(await y()).not.toBe(upright), { timeout: 8_000 });
    ok(await call('set_orientation', { orientation: 'portrait', read: 'none' }));
    await vi.waitFor(async () => expect(await y()).toBe(upright), { timeout: 8_000 });
  });
});
