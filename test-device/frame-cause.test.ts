import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, sleep as pause, type AndroidDevice } from './workspace.js';
import { opsOn } from './helpers.js';

/**
 * Why a slow frame was slow, against a known cause in each mode of the fixture, and none in a smooth run
 * (APPDYNO_ANDROID_SERIAL).
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const APP = 'dev.appdyno.fixture';

describe.skipIf(!serial)('why a slow frame was slow', () => {
  const t = opsOn(androidProvider(new Adb(), {}), serial!, APP);
  let d: AndroidDevice;

  /** A trace of the fixture's frames of this kind, started inside the recording. */
  const traced = async (query: string) => {
    await d.ensureAwake();
    await d.shell(`am force-stop ${APP}`);
    await d.shell(
      `am start -W -a android.intent.action.VIEW -d 'appdyno-fixture://open/frozen?${query}' ${APP}`,
    );
    await pause(1_500);
    const start = (await d.read(APP)).list.find((e) => e.id === 'frozen_start')!;
    const [r] = await Promise.all([
      t.call('perf_trace', { seconds: 7 }),
      pause(3_000).then(() => d.tap(start, { settle: false })),
    ]);
    console.log(query, '\n', r.text);
    expect(r.error, r.text).toBe(false);
    return r;
  };

  beforeAll(async () => {
    d = (await t.ctx.session()).device as AndroidDevice;
    await d.open();
  });
  afterAll(() => t.ctx.close());

  it.each([
    ['lock', 'lock', /waiting for a monitor lock.*Thread/],
    ['binder', 'binder', /in binder calls/],
    ['gc', 'gc', /waiting for the garbage collector/],
    ['busy', 'busy', /at work on the main thread/],
  ])(
    'a 100 ms %s in each frame names %s',
    async (cause, named, words) => {
      const r = await traced(`frames=300&cause=${cause}`);
      expect(r.data.slowFrames!).toBeGreaterThan(5);
      expect(r.data.slowBecause).toBe(named);
      expect(r.text).toMatch(words);
    },
    120_000,
  );

  it('a sleep nothing names is said to be one', async () => {
    const r = await traced('frames=300&draw=40');
    expect(r.data.slowBecause).toBe('sleeping');
  }, 120_000);

  it('a smooth run names no cause', async () => {
    const r = await traced('frames=120');
    expect(r.data.slowBecause).toBeUndefined();
    expect(r.text).not.toContain('why the');
  }, 120_000);
});
