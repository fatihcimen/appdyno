import { execFileSync } from 'node:child_process';
import { assert, beforeAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, sleep } from './workspace.js';
import { opsOn, type Call } from './helpers.js';

/**
 * Frames that `gfxinfo` never sees: the fixture's `SurfaceView`, drawn from its own thread every `ms` of its
 * link, on the device APPDYNO_ANDROID_SERIAL names, at the refresh its display reads. A surface's frames land on
 * whole refreshes: at 60 Hz 30 ms is a frame every 33.3, 40 ms gaps of 33.3 and two in five of 50, and 60 ms gaps
 * of 50 and 66.7, all of them slow by Play's bars; at 90 Hz 40 ms is gaps of 33.3 and 44.4, none of them 50.
 */
const APP = 'dev.appdyno.fixture';
const SERIAL = process.env.APPDYNO_ANDROID_SERIAL ?? '';

/** The display's own refresh, as a phone may run at 90 or 120 Hz. */
const refreshOf = () => {
  const said = execFileSync('adb', ['-s', SERIAL, 'shell', 'dumpsys display'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const hz = Number(/renderFrameRate ([\d.]+)/.exec(said)?.[1]);
  assert(hz > 0, 'the display refresh');
  return 1000 / hz;
};

/** A draw every `ms` lands on the two whole refreshes either side of it, by its share: those of `bar` ms or more. */
const shareFrom = (ms: number, refresh: number, bar: number) => {
  const fewer = Math.floor(ms / refresh) * refresh;
  const later = (ms - fewer) / refresh;
  // a gap of whole refreshes is the bar when it comes within half a millisecond, as 3 of 16.67 is 50
  return 100 * ((fewer >= bar - 0.5 ? 1 - later : 0) + (fewer + refresh >= bar - 0.5 ? later : 0));
};

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
    call = opsOn(androidProvider(new Adb()), SERIAL, APP).call;
  });

  it('reads a surface drawn every 30 ms as 33 ms frames, none slow', async () => {
    const { data, text } = await surface(30);
    const s = data.surface;
    assert(s);
    expect(s.refreshMs).toBeCloseTo(refreshOf(), 0);
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
    const s = data.surface;
    assert(s);
    expect(s.fps).toBeGreaterThan(22.5);
    expect(s.fps).toBeLessThan(27.5);
    expect(Math.abs(s.slow50Percent - shareFrom(40, refreshOf(), 50))).toBeLessThan(15);
    expect(text).toContain('would count');
  });

  it('reads one drawn every 60 ms as all slow, where gfxinfo reads next to nothing', async () => {
    const { data } = await surface(60);
    const s = data.surface;
    assert(s);
    expect(s.fps).toBeGreaterThan(15);
    expect(s.fps).toBeLessThan(18.5);
    expect(s.slow50Percent).toBeGreaterThan(90);
    expect(data.frames?.total).toBeLessThan(s.frames / 2);
  });

  it('says a screen of the View toolkit has no surface to read', async () => {
    await call('open_link', { url: 'appdyno-fixture://open/list' });
    await sleep(1_000);
    const { data, text } = await call('perf_snapshot', { also: ['surface'], cpuWindowMs: 500 });
    expect(data.surface?.frames).toBe(0);
    expect(text).toContain('no SurfaceView');
  });
});
