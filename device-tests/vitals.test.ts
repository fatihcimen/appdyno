import { afterAll, assert, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Adb, androidProvider, sleep as pause, type AndroidDevice } from './workspace.js';
import { latestRuns, runKeys } from '@appdyno/perf';
import { opsOn } from './helpers.js';
import { untilWithin } from './until.js';

/**
 * Numbers against Play's definitions, on known shares of frames, a known slow start and a provoked ANR
 * (APPDYNO_ANDROID_SERIAL). What is read is printed: docs/reference/perf.md quotes it.
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const APP = 'dev.appdyno.fixture';
const until = untilWithin(30_000);

describe.skipIf(!serial)("Android against Play's definitions", () => {
  const t = opsOn(androidProvider(new Adb(), {}), serial, APP);
  let d: AndroidDevice;
  const costs = (name: string, ms?: number) =>
    d.shell(
      ms === undefined
        ? `run-as ${APP} rm -f files/${name}`
        : `run-as ${APP} sh -c 'mkdir -p files; echo ${ms} > files/${name}'`,
    );

  /** The frames the fixture draws as asked, in a window of their own, read by a snapshot. */
  const framesOf = async (query: string, seconds: number) => {
    await d.shell(`am force-stop ${APP}`);
    await d.shell(
      `am start -W -a android.intent.action.VIEW -d 'appdyno-fixture://open/frozen?${query}' ${APP}`,
    );
    const shown = async (id: string) => (await d.read(APP)).list.find((e) => e.id === id);
    await until('the start button', async () => {
      const button = await shown('frozen_start').catch((e: unknown) => {
        // no wait ends another client's hold of the device, and running out would read as a slow screen
        if (e instanceof Error && 'code' in e && e.code === 'AGENT_CONFLICT') throw e;
      });
      return !!button;
    });
    await pause(1_000);
    // a read resets the count: from here on it is the frames of the run alone
    await t.call('perf_snapshot', { cpuWindowMs: 500, scenario: 'reset' });
    const start = await shown('frozen_start');
    assert(start, 'frozen_start');
    await d.tap(start, { settle: false });
    const end = Date.now() + seconds * 1_000;
    let status = '';
    while (status !== 'done' && Date.now() < end) {
      await pause(1_000);
      const s = await d.read(APP).catch(() => undefined);
      status = s?.list.find((e) => e.id === 'frozen_status')?.label ?? status;
    }
    expect(status).toBe('done');
    const r = await t.call('perf_snapshot', {
      cpuWindowMs: 500,
      scenario: query.replace(/\W/g, '_'),
    });
    console.log(
      query,
      r.data.frames,
      r.text.split('\n').filter((l) => l.startsWith('Play')),
    );
    return r;
  };

  beforeAll(async () => {
    d = (await t.ctx.session()).device as AndroidDevice;
    await d.open();
  });
  beforeEach(() => d.ensureAwake());
  afterAll(async () => {
    await costs('startup_ms').catch(() => undefined);
    // a phone keeps its ANR dialog over the app until someone answers it, and the next suite would read that
    await d.shell(`am force-stop ${APP}`).catch(() => undefined);
    t.ctx.close();
  });

  it('a screen of 40 ms draws reads near 100 % over 16 ms, and would count', async () => {
    const r = await framesOf('frames=600&draw=40', 90);
    expect(r.data.frames?.slowPercent).toBeGreaterThan(90);
    expect(r.text).toContain('this session would count as slow frames');
  }, 180_000);

  it('a light screen would not count as slow', async () => {
    const r = await framesOf('frames=300', 60);
    expect(r.data.frames?.slowPercent).toBeLessThan(50);
    expect(r.text).toContain('this session would not count as slow frames');
  }, 180_000);

  it('one frozen frame in 500 says too few frames', async () => {
    const r = await framesOf('frames=300&stalls=1', 60);
    assert(r.data.frames);
    expect(r.data.frames.frozenPercent).toBeUndefined();
    expect(r.text).toContain('too few frames to say of frozen frames');
  }, 180_000);

  it('one frozen frame in many would not count, and many would', async () => {
    const few = await framesOf('frames=4000&stalls=1', 180);
    expect(few.data.frames?.frozenPercent).toBeLessThanOrEqual(0.1);
    expect(few.text).toContain('this session would not count as frozen frames');
    const many = await framesOf('frames=1500&stalls=6', 180);
    expect(many.data.frames?.frozenPercent).toBeGreaterThan(0.1);
    expect(many.text).toContain('this session would count as frozen frames');
  }, 600_000);

  it("a slow start would count by the day's longest, and still does once it is fast again", async () => {
    await costs('startup_ms', 5_200);
    const slow = await t.call('perf_launch', { repeats: 1 });
    console.log(slow.text);
    expect(slow.text).toContain('this session would count as a slow cold start');
    expect(slow.data.excessive).toBe(true);
    await costs('startup_ms');
    const fast = await t.call('perf_launch', { repeats: 1 });
    console.log(fast.text);
    expect(fast.data.medianMs).toBeLessThan(5_000);
    expect(fast.text).toContain('this session would count as a slow cold start');
    const [key] = await runKeys(t.measurements, { app: APP, scenario: 'launch-cold' });
    assert(key);
    const [run] = await latestRuns(t.measurements, key, 1);
    expect(run?.find((r) => r.kind === 'launch.worst_cold_ms')?.value).toBeLessThan(5_000);
  }, 300_000);

  it('a hot start says which limit it holds to, and that the two pages differ', async () => {
    const r = await t.call('perf_launch', { mode: 'hot', repeats: 1 });
    console.log(r.text);
    expect(r.text).toContain("Play's developer page says 1.5 s, its help page 1 s");
    expect(r.text).toContain('would not count as a slow hot start');
  }, 180_000);

  it('a touch on a stuck main thread is a user-perceived ANR, and counts', async () => {
    await d.shell(`am force-stop ${APP}`);
    await t.call('launch_app');
    const before = await t.call('perf_snapshot', { also: ['exits'], cpuWindowMs: 500 });
    const heldBefore = before.data.exitsHeld?.userAnrs;
    assert(heldBefore !== undefined);
    await pause(1_500);
    const freeze = (await d.read(APP)).list.find((e) => /freeze/i.test(e.label));
    assert(freeze);
    await d.tap(freeze, { settle: false });
    await pause(800);
    // more touches on the same button, and not awaited as each waits for the app: the system takes longer than one 12 s
    // freeze to come to its dialog, and an app that has recovered by then gets none, so these keep it stuck
    const stuck = [0, 300].map(async (ms) => {
      await pause(ms);
      await d.shell(`input tap ${freeze.x} ${freeze.y}`).catch(() => undefined);
    });
    // the system files it in the time it takes, and an app that recovers ends in no exit: the count is what says. Each
    // snapshot is a run, so the one that sees it counts it, and only that one
    let after = before;
    for (let i = 0; i < 40 && !after.data.userAnrs; i++) {
      await pause(1_000);
      after = await t.call('perf_snapshot', { also: ['exits'], cpuWindowMs: 500 });
    }
    await Promise.all(stuck);
    console.log(after.text);
    expect(after.data.userAnrs).toBe(1);
    expect(after.data.exitsHeld?.userAnrs).toBe(heldBefore + 1);
    expect(after.text).toContain('this session would count as a user-perceived ANR');
    const next = await t.call('perf_snapshot', { also: ['exits'], cpuWindowMs: 500 });
    expect(next.data.userAnrs).toBe(0);
    expect(next.text).toContain('this session would not count as a user-perceived ANR');
    expect((await t.call('crashes', {})).text).toContain('Input dispatching timed out');
  }, 240_000);
});
