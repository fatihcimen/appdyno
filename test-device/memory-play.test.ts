import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Adb, androidProvider, sleep as pause, type AndroidDevice } from './workspace.js';
import { latestRuns, runKeys } from '@appdyno/perf';
import { opsOn } from './helpers.js';

/**
 * Android's memory as Play judges it, against known costs (APPDYNO_ANDROID_SERIAL): anon RSS and swap by process state,
 * and bitmaps, on the fixture's memory screen.
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const APP = 'dev.appdyno.fixture';
const MB = 1024;

describe.skipIf(!serial)('memory by Play’s metric', () => {
  const t = opsOn(androidProvider(new Adb(), {}), serial!, APP);
  let d: AndroidDevice;
  const read = async () => {
    const r = await t.call('perf_snapshot', {
      also: ['anonMemory'],
      cpuWindowMs: 500,
      scenario: 'memory',
    });
    expect(r.error, r.text).toBe(false);
    console.log(r.text.split('\n').filter((l) => /anon RSS|Play: .*(memory|bitmap)/.test(l)));
    return r.data;
  };
  const press = async (id: string, status: string) => {
    const s = await d.read(APP);
    await d.tap(
      s.list.find((e) => e.id === id)!,
      { settle: false },
    );
    for (let i = 0; i < 100; i++) {
      const now = await d.read(APP).catch(() => undefined);
      if (now?.list.some((e) => e.id === 'memory_status' && e.label?.includes(status))) break;
      await pause(200);
    }
    // what a GC or a page written late leaves
    await pause(1_500);
  };

  beforeAll(async () => {
    d = (await t.ctx.session()).device as AndroidDevice;
    await d.open();
  });
  beforeEach(async () => {
    await d.ensureAwake();
    await d.shell(`am force-stop ${APP}`);
    await d.shell(
      `am start -W -a android.intent.action.VIEW -d 'appdyno-fixture://open/memory' ${APP}`,
    );
    await pause(2_000);
  });
  afterAll(() => t.ctx.close());

  const within15 = (rise: number) => {
    expect(rise).toBeGreaterThan(50 * MB * 0.85);
    expect(rise).toBeLessThan(50 * MB * 1.15);
  };

  it('50 MB of Java heap and 50 MB of native memory each raise it within 15 %', async () => {
    const before = await read();
    expect(before.processState).toBe('foreground');
    await press('memory_alloc', 'Held: 50');
    const java = await read();
    within15(java.anonSwapKb! - before.anonSwapKb!);
    await press('memory_native', 'Held native');
    const native = await read();
    within15(native.anonSwapKb! - java.anonSwapKb!);
  }, 180_000);

  it('a 50 MB bitmap raises the anon memory within 15 %, and the bitmaps where this Android lists them', async () => {
    const listed = /Bitmap \(malloced\)/.test(await d.shell(`dumpsys meminfo ${APP}`));
    const before = await read();
    await press('memory_bitmap', 'Held bitmap');
    const held = await read();
    within15(held.anonSwapKb! - before.anonSwapKb!);
    if (listed) within15(held.bitmapKb! - before.bitmapKb!);
    // no row is no reading: a zero here would say the app has no bitmaps
    else expect(held.bitmapKb).toBeUndefined();
  }, 180_000);

  it('going home moves it to another state, with what it holds, and each is kept under its state', async () => {
    await press('memory_alloc', 'Held: 50');
    const foreground = await read();
    await d.shell('input keyevent KEYCODE_HOME');
    await pause(3_000);
    const home = await read();
    console.log(foreground.processState, foreground.anonSwapKb, home.processState, home.anonSwapKb);
    expect(home.processState).not.toBe('foreground');
    expect(Math.abs(home.anonSwapKb! - foreground.anonSwapKb!)).toBeLessThan(
      foreground.anonSwapKb! * 0.25,
    );
    const [key] = await runKeys(t.measurements, { app: APP, scenario: 'memory' });
    const kinds = (await latestRuns(t.measurements, key!, 2)).flat().map((r) => r.kind);
    expect(kinds.some((k) => k.startsWith('memory.anon_swap.foreground.'))).toBe(true);
    expect(kinds.some((k) => k.startsWith(`memory.anon_swap.${home.processState}.`))).toBe(true);
    if (home.bitmapKb !== undefined)
      expect(kinds).toContain(`memory.bitmap.${home.processState}_kb`);
    else expect(kinds.some((k) => k.startsWith('memory.bitmap.'))).toBe(false);
  }, 180_000);
});
