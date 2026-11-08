import { execFileSync } from 'node:child_process';
import { afterAll, assert, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Adb,
  androidProvider,
  iphoneProvider,
  simulatorProvider,
  KEYGUARD_READ,
  sleep as pause,
  type AndroidDevice,
  type IosPhoneDevice,
} from './workspace.js';
import { opsOn } from './helpers.js';

/**
 * No silent success, on a device: a failed action says whether it touched anything, a locked phone refuses by name and
 * is not touched, two recordings at once refuse by name. A PIN is set only on an emulator, and taken off again; a phone
 * keeps what it has. APPDYNO_ANDROID_SERIAL, APPDYNO_IOS_UDID, APPDYNO_IPHONE_UDID.
 */
const android = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const phone = process.env.APPDYNO_IPHONE_UDID ?? '';
const simulator = process.env.APPDYNO_IOS_UDID ?? '';
const APP = 'dev.appdyno.fixture';
const PIN = '1234';
/** With no credential to give, `verify` passes: a lock screen a swipe opens. */
const swipeOnly =
  !!android &&
  execFileSync(new Adb().bin, ['-s', android, 'shell', 'locksettings verify'], {
    encoding: 'utf8',
  }).includes('verified successfully');

describe.skipIf(!android)('guards on Android', () => {
  const t = opsOn(androidProvider(new Adb(), {}), android, APP);
  let d: AndroidDevice;

  beforeAll(async () => {
    d = (await t.ctx.session()).device as AndroidDevice;
    await d.open();
    await d.ensureAwake();
    await d.shell(`am start -W -n ${APP}/.MainActivity`);
  });
  afterAll(() => t.ctx.close());

  it('a target that is not there says no touch was sent', async () => {
    const r = await t.call('tap', { selector: { text: 'Nothing is called this' } });
    expect(r.error).toBe(true);
    expect(r.text).toContain('no touch was sent');
  }, 60_000);

  it.runIf(swipeOnly)(
    'a lock screen with no credential is passed: no refusal, and the app is read',
    async (ctx) => {
      await d.shell('input keyevent KEYCODE_SLEEP');
      const locked = async () => (await d.shell(KEYGUARD_READ)).includes('=true');
      // a phone may lock some time after its screen goes dark: a Xiaomi's had not 3 s on
      for (let i = 0; i < 15 && !(await locked()); i++) await pause(1_000);
      if (!(await locked())) {
        await d.ensureAwake();
        return ctx.skip();
      }
      const read = await t.call('screen');
      console.log(read.error, read.data.code, read.text.slice(0, 150));
      expect(read.error, read.text).toBe(false);
      expect(await d.shell(KEYGUARD_READ)).toContain('false');
      expect(await d.foreground()).toBe(APP);
    },
    60_000,
  );

  it('a touch on a dimmed screen reaches the app, not only the brightness', async (ctx) => {
    const dimsAfter = Number(await d.shell('settings get system screen_off_timeout'));
    // a phone that is not soon to dim says nothing
    if (dimsAfter > 120_000) return ctx.skip();
    await d.shell(
      `am start -W -a android.intent.action.VIEW -d appdyno-fixture://open/gestures ${APP}`,
    );
    const pad = (await d.tree()).nodes.find((n) => n.d === 'Gesture pad');
    assert(pad);
    const [l, top, r, b] = pad.b;
    await vi.waitFor(
      async () =>
        expect(await d.shell('dumpsys display | grep -m1 mPowerRequest=')).toContain('policy=DIM'),
      { timeout: dimsAfter, interval: 1_000 },
    );
    await d.tap({ x: (l + r) / 2, y: (top + b) / 2 }, { settle: false });
    await vi.waitFor(async () =>
      expect((await d.tree()).nodes.some((n) => n.t?.includes('travel:'))).toBe(true),
    );
  }, 150_000);

  it.runIf(android.startsWith('emulator-'))(
    'a phone locked behind a PIN refuses by name, reads and touches alike',
    async () => {
      const seen = async (name: 'screen' | 'tap' | 'swipe', args = {}) => {
        const r = await t.call(name, args);
        console.log(name, r.error, r.data.code, r.text.slice(0, 150));
        return r;
      };
      await d.shell(`locksettings set-pin ${PIN}`);
      try {
        await d.shell('input keyevent KEYCODE_SLEEP');
        await pause(2_000);
        const read = await seen('screen');
        expect(read.data.code).toBe('DEVICE_LOCKED');
        expect(read.text).toContain('locked behind its PIN');
        const tap = await seen('tap', { x: 100, y: 100 });
        expect(tap.data.code).toBe('DEVICE_LOCKED');
        expect(tap.text).toContain('no touch was sent');
        const swipe = await seen('swipe', { direction: 'up' });
        expect(swipe.data.code).toBe('DEVICE_LOCKED');
      } finally {
        await d.shell('input keyevent KEYCODE_WAKEUP');
        await pause(500);
        await d.shell(`locksettings clear --old ${PIN}`);
        await d.ensureAwake();
      }
      expect((await seen('screen')).error).toBe(false);
    },
    120_000,
  );
});

for (const [name, serial, provider] of [
  ['a simulator', simulator, simulatorProvider],
  ['an iPhone', phone, iphoneProvider],
] as const)
  describe.skipIf(!serial)(`guards on ${name}`, () => {
    const t = opsOn(provider(), serial, APP);

    afterAll(() => t.ctx.close());

    it('two recordings at once: the second refuses by name, and the first has its trace', async () => {
      const s = await t.ctx.session();
      await s.device.launch(APP);
      const [first, second] = await Promise.allSettled([
        t.call('perf_profile', { seconds: 3 }),
        pause(1_500).then(() => t.call('perf_profile', { seconds: 3 })),
      ]);
      if (first.status !== 'fulfilled' || second.status !== 'fulfilled')
        throw new Error('a recording did not answer');
      const [a, b] = [first.value, second.value];
      console.log(a.text.split('\n')[1], '\n', b.text);
      expect(a.error, a.text).toBe(false);
      expect(a.data.samples).toBeGreaterThan(0);
      expect(b.error).toBe(true);
      expect(b.data.code).toBe('DEVICE_CLAIMED');
      expect(b.text).toContain('a second would come back empty');
    }, 240_000);
  });

describe.skipIf(!phone)('an iPhone that locked itself', () => {
  const t = opsOn(iphoneProvider(), phone, APP);
  let d: IosPhoneDevice;
  const LOCKS_AFTER_MS = 90_000;

  beforeAll(async () => {
    d = (await t.ctx.session()).device as IosPhoneDevice;
    await d.launch(APP);
  }, 120_000);
  afterAll(() => t.ctx.close());

  it('says whether it wants a passcode, as devicectl has it', async () => {
    const r = await d.ctl.lockState();
    console.log('lock state', JSON.stringify(r));
    expect(r.passcodeRequired).toBe(false);
  }, 60_000);

  it('a swipe after it locked reaches the app, and opens nothing of the system', async () => {
    const key = vi.spyOn(d, 'key');
    await pause(LOCKS_AFTER_MS);
    const r = await t.call('swipe', { direction: 'up' });
    console.log(r.text.slice(0, 300), '\nhome presses', key.mock.calls.length);
    expect(r.error, r.text).toBe(false);
    // no press and it never locked, and this has proven nothing
    expect(key).toHaveBeenCalledWith('home', expect.anything());
    expect((await d.tree()).windows[0]?.pkg).toBe(APP);
  }, 240_000);

  it('a read with no app chosen gets past it too', async () => {
    await d.stopAgent();
    const fresh = opsOn(iphoneProvider(), phone, APP);
    await pause(LOCKS_AFTER_MS);
    const s = await fresh.ctx.session();
    const read = await s.device.tree();
    console.log('after the lock', read.windows[0]?.pkg);
    expect(read.nodes.some((n) => n.id === 'lockscreen-date-view')).toBe(false);
    fresh.ctx.close();
  }, 240_000);

  it('reads its thermal state from what it recorded', async () => {
    const r = await t.call('perf_snapshot', { cpuWindowMs: 2_000 });
    console.log(r.text);
    expect(r.error, r.text).toBe(false);
    expect(r.text).toMatch(/thermal \d/);
  }, 180_000);
});
