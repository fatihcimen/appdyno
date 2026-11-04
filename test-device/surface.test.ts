import { beforeAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, sleep } from 'appdyno';
import { opsOn, type Call } from './helpers.js';

/**
 * Frames that `gfxinfo` never sees: the fixture's `SurfaceView`, drawn from its own thread every `ms` of its
 * link, on the device APPDYNO_ANDROID_SERIAL names, which is taken to refresh at 60 Hz. There a surface's
 * frames land on whole refreshes: 30 ms is a frame every 33.3, 40 ms gaps of 33.3 and two in five of 50, and
 * 60 ms gaps of 50 and 66.7, all of them slow by Play's bars.
 */
const APP = 'dev.appdyno.fixture';
const SERIAL = process.env.APPDYNO_ANDROID_SERIAL;

describe.skipIf(!SERIAL)('frames of a surface', () => {
  let call: Call;
  const surface = async (ms: number) => {
    await call('terminate_app');
    await call('open_link', { url: `appdyno-fixture://open/surface?ms=${ms}` });
    await sleep(3_000);
    await call('perf_snapshot', {});
    await sleep(2_000);
    const r = await call('perf_snapshot', { also: ['surface'], cpuWindowMs: 500 });
    process.stderr.write(`--- every ${ms} ms\n${r.text}\n---\n`);
    return r;
  };

  beforeAll(() => {
    call = opsOn(androidProvider(new Adb()), SERIAL!, APP).call;
  });

  it('reads a surface drawn every 30 ms as 33 ms frames, none slow', async () => {
    const { data, text } = await surface(30);
    const s = data.surface!;
    expect(s.refreshMs).toBeCloseTo(16.7, 0);
    expect(s.fps).toBeGreaterThan(28);
    expect(s.fps).toBeLessThan(35);
    expect(s.slow34Percent).toBeLessThan(25);
    expect(s.slow50Percent).toBeLessThan(25);
    expect(s.layer).toContain('SurfaceActivity');
    expect(s.drawing).toBe(true);
    expect(text).toContain('would not count');
  });

  it('reads one drawn every 40 ms as 25 frames a second, two in five of them slow', async () => {
    const { data, text } = await surface(40);
    const s = data.surface!;
    expect(s.fps).toBeGreaterThan(22.5);
    expect(s.fps).toBeLessThan(27.5);
    expect(s.slow50Percent).toBeGreaterThan(25);
    expect(s.slow50Percent).toBeLessThan(55);
    expect(text).toContain('would count');
  });

  it('reads one drawn every 60 ms as all slow, where gfxinfo reads next to nothing', async () => {
    const { data } = await surface(60);
    const s = data.surface!;
    expect(s.fps).toBeGreaterThan(15);
    expect(s.fps).toBeLessThan(18.5);
    expect(s.slow50Percent).toBeGreaterThan(90);
    expect(data.frames!.total).toBeLessThan(s.frames / 2);
  });

  it('says a screen of the View toolkit has no surface to read', async () => {
    await call('open_link', { url: 'appdyno-fixture://open/list' });
    await sleep(1_000);
    const { data, text } = await call('perf_snapshot', { also: ['surface'], cpuWindowMs: 500 });
    expect(data.surface?.frames).toBe(0);
    expect(text).toContain('no SurfaceView');
  });
});
