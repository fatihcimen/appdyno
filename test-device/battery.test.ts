import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Adb, androidProvider, sleep as pause, type AndroidDevice } from 'appdyno';
import { opsOn } from './helpers.js';

/**
 * A battery's signals against known costs, with no power model and nothing reset (APPDYNO_ANDROID_SERIAL): a tagged wake
 * lock, wakeup alarms, jobs, on a phone and on an emulator alike.
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const APP = 'dev.appdyno.fixture';
const LOCK_MS = 30_000;

describe.skipIf(!serial)('battery signals on Android', () => {
  const t = opsOn(androidProvider(new Adb(), {}), serial!, APP);
  let d: AndroidDevice;
  /** The fixture's battery screen, under what is asked of it, with its buttons found. */
  const open = async (query: string) => {
    await d.shell(`am force-stop ${APP}`);
    await d.shell(
      `am start -W -a android.intent.action.VIEW -d 'appdyno-fixture://open/battery?${query}' ${APP}`,
    );
    for (let i = 0; i < 50; i++) {
      const s = await d.read(APP).catch(() => undefined);
      if (s?.list.some((e) => e.id === 'battery_lock')) return s;
      await pause(200);
    }
    throw new Error('the battery screen did not come');
  };
  const button = (s: Awaited<ReturnType<typeof open>>, id: string) =>
    s.list.find((e) => e.id === id)!;
  const reading = (windowMs: number) =>
    t.call('perf_snapshot', {
      also: ['battery'],
      cpuWindowMs: 500,
      batteryWindowMs: windowMs,
      scenario: 'battery',
    });
  /** A touch on a phone just woken can be lost, which says nothing of what is measured: it goes again until the screen reacts. */
  const press = async (s: Awaited<ReturnType<typeof open>>, id: string) => {
    const status = async () =>
      (await d.read(APP)).list.find((e) => e.id === 'battery_status')?.label;
    const was = await status();
    for (let i = 0; i < 3; i++) {
      await d.tap(button(s, id), { settle: false });
      await pause(700);
      if ((await status()) !== was) return;
    }
    throw new Error(`no reaction to ${id}`);
  };
  /** What it has counted on battery so far, and not the share of the time that is, which moves with the clock. */
  const onBattery = async () =>
    /Time on battery: (.*?) \(/.exec(
      await d.shell('dumpsys batterystats --charged | head -20'),
    )?.[1];

  beforeAll(async () => {
    d = (await t.ctx.session()).device as AndroidDevice;
    await d.open();
  });
  beforeEach(() => d.ensureAwake());
  afterAll(() => t.ctx.close());

  it('a 30 s tagged wake lock reads within 10 %, under its tag', async () => {
    const s = await open(`lock_ms=${LOCK_MS}`);
    const counted = await onBattery();
    const [r] = await Promise.all([
      reading(LOCK_MS + 15_000),
      pause(5_000).then(() => press(s, 'battery_lock')),
    ]);
    console.log(r.text);
    expect(r.error, r.text).toBe(false);
    const lock = r.data.wakeLocks!.find((l) => l.tag === 'fixture:held')!;
    expect(Math.abs(lock.ms - LOCK_MS)).toBeLessThan(LOCK_MS * 0.1);
    expect(Math.abs(r.data.longestLockMs! - LOCK_MS)).toBeLessThan(LOCK_MS * 0.1);
    expect(r.text).toContain('would count as excessive partial wake locks, at this pace');
    // nothing was reset, and the phone was never told it was unplugged
    expect(await d.shell('dumpsys battery')).not.toMatch(/UPDATES STOPPED/);
    expect(await onBattery()).toBe(counted);
  }, 180_000);

  it('6 wakeup alarms count 6, under their tag', async () => {
    const s = await open('alarms=6');
    const [r] = await Promise.all([
      reading(20_000),
      pause(3_000).then(() => press(s, 'battery_alarms')),
    ]);
    console.log(r.text);
    expect(r.error, r.text).toBe(false);
    expect(r.data.wakeups).toBe(6);
    expect(r.text).toContain('*walarm*:fixture.alarm 6');
    expect(r.text).toContain('would count as excessive wakeups, at this pace');
  }, 120_000);

  it('3 jobs count 3, and an idle app reads none of any', async () => {
    const s = await open('');
    const idle = await reading(5_000);
    console.log(idle.text);
    expect(idle.data).toMatchObject({ wakeLockMs: 0, wakeups: 0, jobs: 0 });
    expect(idle.text).toContain('would not count as excessive wakeups');
    const [r] = await Promise.all([
      reading(15_000),
      (async () => {
        await pause(2_000);
        for (let i = 0; i < 3; i++) {
          await d.tap(button(s, 'battery_job'), { settle: false });
          await pause(2_000);
        }
      })(),
    ]);
    console.log(r.text);
    expect(r.data.jobs).toBe(3);
  }, 120_000);
});
