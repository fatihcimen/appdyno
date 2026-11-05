import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, appleProvider } from './workspace.js';
import { IPHONE, opsOn } from './helpers.js';

/** A PIN comes and goes on the emulator APPDYNO_ANDROID_SERIAL names: never on a phone. */
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const EMULATOR = ANDROID?.startsWith('emulator-');
const PIN = '1234';

const adb = (...words: string[]) =>
  execFileSync('adb', ['-s', ANDROID!, 'shell', ...words], { encoding: 'utf8' });

const until = async (holds: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!holds() && Date.now() < end) await new Promise((r) => setTimeout(r, 300));
  return holds();
};

const lockedNow = () => adb('dumpsys', 'trust').includes('deviceLocked=1');

describe.skipIf(!EMULATOR)('what blocks an emulator', () => {
  afterAll(() => {
    adb('input', 'keyevent', 'KEYCODE_WAKEUP');
    adb('locksettings', 'clear', '--old', PIN);
  });

  it('a lock behind a PIN is listed with its fix, and is gone with the PIN', async () => {
    const { call } = opsOn(androidProvider(new Adb()), ANDROID!, 'dev.appdyno.fixture');
    const listed = async () =>
      (await call('list_devices')).data.devices.find((d) => d.serial === ANDROID);
    expect((await listed())?.blocked).toBeUndefined();

    adb('locksettings', 'set-pin', PIN);
    adb('input', 'keyevent', 'KEYCODE_SLEEP');
    expect(await until(lockedNow)).toBe(true);

    const r = await call('list_devices');
    expect((await listed())?.blocked).toMatchObject({ need: 'locked' });
    expect(r.text).toContain(`${ANDROID} device`);
    expect(r.text).toContain('The device is locked. Unlock it.');
    // it reads and touches nothing else: the lock stays
    expect(lockedNow()).toBe(true);

    adb('input', 'keyevent', 'KEYCODE_WAKEUP');
    adb('locksettings', 'clear', '--old', PIN);
    expect(await until(() => !lockedNow())).toBe(true);
    expect((await listed())?.blocked).toBeUndefined();
  });
});

describe.skipIf(!IPHONE)('what blocks an iPhone', () => {
  it('nothing, when it is unlocked and trusts this Mac', async () => {
    const { call } = opsOn(appleProvider(), IPHONE!, 'dev.appdyno.fixture');
    const { devices } = (await call('list_devices')).data;
    const phone = devices.find((d) => d.serial === IPHONE);
    expect(phone).toBeDefined();
    expect(phone?.blocked).toBeUndefined();
  });
});
