import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, appleProvider } from './workspace.js';
import { opsOn, type Call } from './helpers.js';

/**
 * Conditions against what they cost, on the fixture. Airplane mode and mobile data are read back and proven
 * by the host being out of reach from the device and in reach again after `restore`; a fingerprint by the
 * fixture's own prompt; a keychain by an item the fixture saved and can no longer read. On the emulator
 * APPDYNO_ANDROID_SERIAL names and the simulator APPDYNO_IOS_UDID names. An emulator with no fingerprint is
 * given a PIN and one, through Settings, and keeps them.
 */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const SIMULATOR = process.env.APPDYNO_IOS_UDID;
const PIN = '1234';

const adb = (...words: string[]) =>
  execFileSync('adb', ['-s', ANDROID!, 'shell', ...words], { encoding: 'utf8' }).trim();
/** The emulator's way to this Mac, as a device reaches it: no route, no answer. */
const reaches = () => {
  try {
    adb('ping', '-c', '1', '-W', '2', '10.0.2.2');
    return true;
  } catch {
    return false;
  }
};
const until = async (holds: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!holds() && Date.now() < end) await new Promise((r) => setTimeout(r, 300));
  return holds();
};

const value = async (call: Call, name: string) =>
  (await call('device_setting', { name })).data.value;
const set = async (call: Call, name: string, to: string) => {
  const r = await call('device_setting', { name, value: to });
  expect(r.error ? r.text : '').toBe('');
  return r;
};
const result = async (call: Call, text: string) =>
  (await call('wait_for', { id: 'result', text, timeoutMs: 8_000 })).data.met;

describe.skipIf(!ANDROID)('conditions on an emulator', () => {
  let call: Call;
  beforeAll(async () => {
    const o = opsOn(androidProvider(new Adb()), ANDROID!, APP);
    call = o.call;
  });
  afterAll(async () => {
    await call?.('device_setting', { name: 'restore' });
  });

  it('turns mobile data off and on, read back, and the device loses this Mac', async () => {
    await set(call, 'wifi', 'on');
    expect(await value(call, 'mobile_data')).toBe('on');
    expect(reaches()).toBe(true);
    await set(call, 'mobile_data', 'off');
    expect(await value(call, 'mobile_data')).toBe('off');
    expect(await until(() => !reaches())).toBe(true);
    const r = await call('device_setting', { name: 'restore' });
    expect(r.text).toContain('mobile_data: on');
    expect(await value(call, 'mobile_data')).toBe('on');
    expect(await until(reaches)).toBe(true);
  });

  it('turns airplane mode on, read back, cuts everything, and restore brings it all back', async () => {
    expect(await value(call, 'airplane')).toBe('off');
    await set(call, 'airplane', 'on');
    expect(await value(call, 'airplane')).toBe('on');
    expect(await value(call, 'wifi')).toBe('off');
    expect(await until(() => !reaches())).toBe(true);
    await call('device_setting', { name: 'restore' });
    expect(await value(call, 'airplane')).toBe('off');
    expect(await until(reaches)).toBe(true);
    expect(await until(() => adb('settings', 'get', 'global', 'wifi_on') === '1')).toBe(true);
  });

  it('turns Wi-Fi off and on, by the state of the radio', async () => {
    await set(call, 'wifi', 'off');
    expect(await value(call, 'wifi')).toBe('off');
    expect(adb('cmd', 'wifi', 'status')).toContain('Wifi is disabled');
    await set(call, 'wifi', 'on');
    expect(await value(call, 'wifi')).toBe('on');
    expect(adb('cmd', 'wifi', 'status')).toContain('Wifi is enabled');
    await call('device_setting', { name: 'restore' });
  });

  it('refuses what is not on or off, and changes nothing', async () => {
    const r = await call('device_setting', { name: 'wifi', value: 'half' });
    expect(r.data.code).toBe('INVALID_ARGUMENT');
    expect(r.text).toContain('wifi: on or off, not half');
  });

  it('says no fingerprint is enrolled, then takes one and answers the fixture', async () => {
    const counts = () => /"count":(\d+)/.exec(adb('dumpsys', 'fingerprint'))?.[1];
    if (counts() === '0') {
      const none = await call('device_setting', { name: 'biometric', value: 'match' });
      expect(none.data.code).toBe('NOT_FOUND');
      expect(none.text).toContain('no fingerprint is enrolled');
      const nowhere = await call('device_setting', { name: 'biometric', value: 'enroll' });
      expect(nowhere.text).toContain('enrolled nothing');
      adb('locksettings', 'set-pin', PIN);
      adb('am', 'start', '-a', 'android.settings.FINGERPRINT_ENROLL');
      await call('wait_for', { role: 'textField', timeoutMs: 8_000 });
      await call('type_text', { selector: { role: 'textField' }, text: PIN, submit: true });
      await call('wait_for', { text: 'More', timeoutMs: 8_000 });
      await call('tap', { selector: { text: 'More' } });
      await call('tap', { selector: { text: 'I agree' } });
      await call('wait_for', { text: 'Touch the sensor', timeoutMs: 8_000 });
      await set(call, 'biometric', 'enroll');
    }
    expect(counts()).toBe('1');
    await call('terminate_app');
    const nobody = await call('device_setting', { name: 'biometric', value: 'match' });
    expect(nobody.data.code).toBe('NOT_FOUND');
    expect(nobody.text).toContain('an app must be asking');

    await call('open_link', { url: 'appdyno-fixture://open/biometric' });
    await call('tap', { selector: { id: 'authenticate' } });
    await call('wait_for', { text: 'Fixture sign-in', timeoutMs: 5_000 });
    await set(call, 'biometric', 'nomatch');
    // the system's prompt stays up over the fixture, and says it itself
    expect((await call('wait_for', { text: 'Not recognized', timeoutMs: 8_000 })).data.met).toBe(
      true,
    );
    await set(call, 'biometric', 'match');
    expect(await result(call, 'Authenticated')).toBe(true);
  });

  it('says Android has no keychain', async () => {
    const r = await call('device_setting', { name: 'keychain', value: 'reset' });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain('Android has no keychain');
  });
});

describe.skipIf(!SIMULATOR)('conditions on a simulator', () => {
  let call: Call;
  beforeAll(async () => {
    const o = opsOn(appleProvider(), SIMULATOR!, APP);
    call = o.call;
  });

  it('empties the keychain of what an app saved, and counts it', async () => {
    await call('open_link', { url: 'appdyno-fixture://open/keychain' });
    await call('tap', { selector: { id: 'save' } });
    expect(await result(call, 'Saved')).toBe(true);
    await call('tap', { selector: { id: 'read' } });
    expect(await result(call, 'Found')).toBe(true);
    const r = await set(call, 'keychain', 'reset');
    expect(r.text).toBe('the keychain is empty: it held 1 items');
    await call('tap', { selector: { id: 'read' } });
    expect(await result(call, 'Not found')).toBe(true);
    expect((await set(call, 'keychain', 'reset')).text).toContain('it held 0 items');
  });

  it('answers a prompt for a face', async () => {
    await set(call, 'biometric', 'enroll');
    await call('open_link', { url: 'appdyno-fixture://open/biometric' });
    await call('tap', { selector: { id: 'authenticate' } });
    // the scan begins a moment after the request, and takes no answer before it
    await new Promise((r) => setTimeout(r, 2_000));
    await set(call, 'biometric', 'nomatch');
    const miss = await call('wait_for', { text: 'Face Not Recognized', timeoutMs: 8_000 });
    expect(miss.data.met).toBe(true);
    await call('alert', { answer: 'Try Face ID Again' });
    await new Promise((r) => setTimeout(r, 2_000));
    await set(call, 'biometric', 'match');
    expect(await result(call, 'Authenticated')).toBe(true);
  });

  it('says a simulator has no radios', async () => {
    const r = await call('device_setting', { name: 'airplane', value: 'on' });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain("it uses the Mac's network");
  });
});
