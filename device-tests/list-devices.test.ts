import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, iphoneProvider } from './workspace.js';
import { IPHONE, opsOn } from './helpers.js';
import { untilWithin } from './until.js';

/** A PIN comes and goes on the emulator APPDYNO_ANDROID_SERIAL names: never on a phone. */
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const EMULATOR = ANDROID.startsWith('emulator-');
const PIN = '1234';

const adb = (...words: string[]) =>
  execFileSync('adb', ['-s', ANDROID, 'shell', ...words], { encoding: 'utf8' });

const until = untilWithin(20_000);

const lockedNow = () => adb('dumpsys', 'trust').includes('deviceLocked=1');

describe.skipIf(!EMULATOR)('what blocks an emulator', () => {
  afterAll(() => {
    adb('input', 'keyevent', 'KEYCODE_WAKEUP');
    try {
      adb('locksettings', 'clear', '--old', PIN);
    } catch (e) {
      // Android 17 fails a clear where there is no PIN, as after the test's own
      if (!String((e as { stdout?: string }).stdout).includes('has no password')) throw e;
    }
  });

  it('a lock behind a PIN is listed with its fix, and is gone with the PIN', async () => {
    const { call } = opsOn(androidProvider(new Adb()), ANDROID, 'dev.appdyno.fixture');
    const listed = async () =>
      (await call('list_devices')).data.devices.find((d) => d.serial === ANDROID);
    expect((await listed())?.blocked).toBeUndefined();

    adb('locksettings', 'set-pin', PIN);
    adb('input', 'keyevent', 'KEYCODE_SLEEP');
    await until('the lock', lockedNow);

    const r = await call('list_devices');
    expect((await listed())?.blocked).toMatchObject({ need: 'locked' });
    expect(r.text).toContain(`${ANDROID} device`);
    expect(r.text).toContain('The device is locked. Unlock it.');
    // it reads and touches nothing else: the lock stays
    expect(lockedNow()).toBe(true);

    adb('input', 'keyevent', 'KEYCODE_WAKEUP');
    adb('locksettings', 'clear', '--old', PIN);
    await until('the lock gone', () => !lockedNow());
    expect((await listed())?.blocked).toBeUndefined();
  });
});

describe.skipIf(!IPHONE)('what blocks an iPhone', () => {
  it('nothing, when it is unlocked and trusts this Mac', async () => {
    const { call } = opsOn(iphoneProvider(), IPHONE, 'dev.appdyno.fixture');
    const { devices } = (await call('list_devices')).data;
    const phone = devices.find((d) => d.serial === IPHONE);
    expect(phone).toBeDefined();
    expect(phone?.blocked).toBeUndefined();
  });
});
