import { execFile, execFileSync } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, simulatorProvider } from './workspace.js';
import { opsOn, type Call } from './helpers.js';
import { untilWithin } from './until.js';

/**
 * Conditions against what they cost, on the fixture. Airplane mode and mobile data are read back and proven
 * by the host being out of reach from the device and in reach again after `restore`; a fingerprint by the
 * fixture's own prompt; a keychain by an item the fixture saved and can no longer read. On the emulator
 * APPDYNO_ANDROID_SERIAL names and the simulator APPDYNO_IOS_UDID names. The emulator must have no fingerprint and
 * no screen lock: the tool gives it both, and takes both away at restore.
 */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const SIMULATOR = process.env.APPDYNO_IOS_UDID ?? '';

const adb = (...words: string[]) =>
  execFileSync('adb', ['-s', ANDROID, 'shell', ...words], { encoding: 'utf8' }).trim();
/** The emulator's way to this Mac, as a device reaches it: no route, no answer. */
const reaches = () => {
  try {
    adb('ping', '-c', '1', '-W', '2', '10.0.2.2');
    return true;
  } catch {
    return false;
  }
};
const until = untilWithin(15_000);

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
  let ctx: ReturnType<typeof opsOn>['ctx'];
  beforeAll(() => {
    const o = opsOn(androidProvider(new Adb()), ANDROID, APP);
    call = o.call;
    ctx = o.ctx;
    return () => call('device_setting', { name: 'restore' });
  });

  it('puts the rotation lock and the user rotation back once turned back, and when its connection ends', async () => {
    const lock = () =>
      ['accelerometer_rotation', 'user_rotation'].map((k) => adb('settings', 'get', 'system', k));
    const was = lock();
    await call('set_orientation', { orientation: 'landscape_left', read: 'none' });
    expect(lock()).toEqual(['0', '1']);
    await call('set_orientation', { orientation: 'portrait', read: 'none' });
    expect(lock()).toEqual(was);
    await call('set_orientation', { orientation: 'landscape_left', read: 'none' });
    (await ctx.session()).device.close();
    await until('the lock back', () => lock().join() === was.join());
  });

  it('puts text_size back as the device had it, unset or 1.0, and the languages the system writes beside it', async () => {
    const read = () =>
      ['font_scale', 'system_locales'].map((k) => adb('settings', 'get', 'system', k));
    const unset = read();
    for (const start of ['unset', '1.0']) {
      if (start === '1.0') adb('settings', 'put', 'system', 'font_scale', '1.0');
      const was = read();
      await set(call, 'text_size', '1.3');
      expect(read()[0]).toBe('1.3');
      await call('device_setting', { name: 'restore' });
      expect(read(), start).toEqual(was);
    }
    adb('settings', 'delete', 'system', 'font_scale');
    expect(read()).toEqual(unset);
  });

  it('turns mobile data off and on, read back, and the device loses this Mac', async () => {
    await set(call, 'wifi', 'on');
    expect(await value(call, 'mobile_data')).toBe('on');
    expect(reaches()).toBe(true);
    await set(call, 'mobile_data', 'off');
    expect(await value(call, 'mobile_data')).toBe('off');
    await until('the network gone', () => !reaches());
    const r = await call('device_setting', { name: 'restore' });
    expect(r.text).toContain('mobile_data: on');
    expect(await value(call, 'mobile_data')).toBe('on');
    await until('the network back', reaches);
  });

  it('turns airplane mode on, read back, cuts everything, and restore brings it all back', async () => {
    expect(await value(call, 'airplane')).toBe('off');
    await set(call, 'airplane', 'on');
    expect(await value(call, 'airplane')).toBe('on');
    expect(await value(call, 'wifi')).toBe('off');
    await until('the network gone', () => !reaches());
    await call('device_setting', { name: 'restore' });
    expect(await value(call, 'airplane')).toBe('off');
    await until('the network back', reaches);
    await until('Wi-Fi on', () => adb('settings', 'get', 'global', 'wifi_on') === '1');
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

  it('enrols a fingerprint through Settings, answers the fixture, and takes its PIN back off', async () => {
    const counts = () => /"count":(\d+)/.exec(adb('dumpsys', 'fingerprint'))?.[1];
    // with a lock, a check without its credential fails the command
    const unlocked = () =>
      adb('cmd lock_settings verify 2>&1 || true').includes('verified successfully');
    expect([counts(), unlocked()]).toEqual(['0', true]);
    const none = await call('device_setting', { name: 'biometric', value: 'match' });
    expect(none.data.code).toBe('NOT_FOUND');
    expect(none.text).toContain('no fingerprint is enrolled');
    const enrolled = await set(call, 'biometric', 'enroll');
    expect(enrolled.text).toContain(
      'the screen lock is PIN 1234 for it: restore takes the PIN off, and the fingerprints with it',
    );
    expect([counts(), unlocked()]).toEqual(['1', false]);
    expect((await set(call, 'biometric', 'enroll')).text).toBe('biometric: enroll');
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

    const back = await call('device_setting', { name: 'restore' });
    expect(back.text).toContain('screen_lock: none');
    expect([counts(), unlocked()]).toEqual(['0', true]);
  });

  it('sets the whole device in Turkish below API 33, which Settings reads, and puts it back', async (t) => {
    if (Number(adb('getprop', 'ro.build.version.sdk')) >= 33) t.skip();
    const was = await value(call, 'locale');
    expect(was).toMatch(/^en/);
    await set(call, 'locale', 'tr-TR');
    expect([await value(call, 'locale'), adb('getprop', 'persist.sys.locale')]).toEqual([
      'tr-TR',
      'tr-TR',
    ]);
    await call('open_link', { settings: 'general' });
    expect((await call('wait_for', { text: 'Ayarlar', timeoutMs: 8_000 })).data.met).toBe(true);
    const back = await call('device_setting', { name: 'restore' });
    expect(back.text).toContain(`locale: ${String(was)}`);
    expect(adb('getprop', 'persist.sys.locale')).toBe(was);
    await call('press_key', { key: 'home' });
  });

  it('folds a foldable by its device state, read back, and restore ends the request', async (t) => {
    const override = () => /mOverrideState=(.*)/.exec(adb('dumpsys device_state'))?.[1];
    if (!adb('cmd device_state print-states 2>&1 || true').includes("name='CLOSED'")) t.skip();
    expect([await value(call, 'fold'), override()]).toEqual([
      'default (now open)',
      'Optional.empty',
    ]);
    await set(call, 'fold', 'closed');
    expect(await value(call, 'fold')).toBe('closed');
    expect(override()).toContain("name='CLOSED'");
    const back = await call('device_setting', { name: 'restore' });
    expect(back.text).toContain('fold: default (now open)');
    expect([await value(call, 'fold'), override()]).toEqual([
      'default (now open)',
      'Optional.empty',
    ]);
  });

  it('caps what the device downloads from API 33, and restore lifts the cap', async (t) => {
    if (Number(adb('getprop', 'ro.build.version.sdk')) < 33) t.skip();
    // a megabyte to each connection, from this Mac, which an emulator reaches at 10.0.2.2
    const server = createServer((c) => c.end(Buffer.alloc(1_000_000)));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    const download = async () => {
      const start = Date.now();
      const { stdout } = await promisify(execFile)('adb', [
        '-s',
        ANDROID,
        'shell',
        `nc 10.0.2.2 ${port} | wc -c`,
      ]);
      expect(stdout.trim()).toBe('1000000');
      return Date.now() - start;
    };
    try {
      const full = await download();
      const capped = await set(call, 'network', '100000');
      expect(capped.text).toBe(
        'network: 100000; a download cap alone: no delay, and uploads go at full speed, at 100 kB/s',
      );
      const slow = await download();
      expect(slow).toBeGreaterThan(Math.max(5_000, full * 4));
      expect((await call('device_setting', { name: 'restore' })).text).toContain('network: full');
      expect(adb('settings', 'get', 'global', 'ingress_rate_limit_bytes_per_second')).toBe('null');
      expect(await download()).toBeLessThan(slow / 4);
      console.log(`a megabyte: ${full} ms, capped ${slow} ms`);
    } finally {
      server.close();
    }
  });

  it('says Android has no keychain', async () => {
    const r = await call('device_setting', { name: 'keychain', value: 'reset' });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain('Android has no keychain');
  });
});

describe.skipIf(!SIMULATOR)('conditions on a simulator', () => {
  let call: Call;
  beforeAll(() => {
    const o = opsOn(simulatorProvider(), SIMULATOR, APP);
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

  it('holds one app in a language for its launches, or with app "" the whole simulator', async () => {
    const PREFS = 'com.apple.Preferences';
    const global = () =>
      execFileSync(
        'xcrun',
        ['simctl', 'spawn', SIMULATOR, 'defaults', 'read', '-g', 'AppleLocale'],
        {
          encoding: 'utf8',
        },
      ).trim();
    const before = global();
    // what a session changes goes back when it ends, and the answer says so
    const back =
      'put back when this session ends, or by restore; it cannot be kept past the session';
    const one = await call('device_setting', { name: 'locale', value: 'tr-TR', app: PREFS });
    expect(one.text).toBe(
      `locale: tr-TR; ${PREFS}'s launches by this tool, not the system's own text: app "" for the whole simulator; ${back}`,
    );
    expect(global()).toBe(before);
    await call('launch_app', { app: PREFS });
    expect((await call('wait_for', { text: 'Ayarlar', timeoutMs: 10_000 })).data.met).toBe(true);
    expect((await call('device_setting', { name: 'restore' })).text).toBe('restored locale: ');
    // it ran, so it started again in the simulator's own
    expect((await call('wait_for', { text: 'Settings', timeoutMs: 10_000 })).data.met).toBe(true);

    const whole = await call('device_setting', { name: 'locale', value: 'tr-TR', app: '' });
    expect(whole.text).toBe(
      `locale: tr-TR; the whole simulator: app for one app's launches; ${back}`,
    );
    expect(global()).toBe('tr_TR');
    await call('device_setting', { name: 'restore' });
    expect(global()).toBe(before);
    await call('terminate_app', { app: PREFS });
  });

  it('says a simulator has no radios', async () => {
    const r = await call('device_setting', { name: 'airplane', value: 'on' });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain("it uses the Mac's network");
  });
});
