import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Adb,
  androidProvider,
  simulatorProvider,
  sleep as pause,
  videoStamps,
} from './workspace.js';
import { opsOn } from './helpers.js';
import type { Timeline } from '@appdyno/perf';

/**
 * A real journey on the fixture with a stall put in on purpose, and what the page says of it (APPDYNO_ANDROID_SERIAL).
 * The video is the check on the frames: both are stamped by the device, by two different parts of it, so a slow frame
 * and the freeze in the video have to fall together. Numbers are printed: docs/reference/perf.md quotes them.
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const APP = 'dev.appdyno.fixture';
const run = promisify(execFile);
const adb = (command: string) => run('adb', ['-s', serial!, 'shell', command]);
const flows = mkdtempSync(join(tmpdir(), 'appdyno-timeline-flows-'));
/** Longer than a look of the flight recorder, which queues behind the device's other work: 22 s apart under load. */
const WATCHED_MS = 30_000;
/** One UI writes no Choreographer line: a hold no frame shows stays unseen there, and a test holds it to that. */
const writesSkippedFrames = async () =>
  !/samsung/i.test((await adb('getprop ro.product.manufacturer')).stdout);

const pageData = (file: string) =>
  JSON.parse(
    /id="timeline">([\s\S]*?)<\/script>/.exec(readFileSync(file, 'utf8'))![1]!,
  ) as Timeline;

/** The screen on, and the fixture in front: what a video holds on a phone is what is in front when it starts. */
const fixtureInFront = async () => {
  await adb('input keyevent KEYCODE_WAKEUP');
  await adb(`am start -W -n ${APP}/.MainActivity`);
};

/** No agent stays behind on a device that is someone's. */
const leave = async (t: ReturnType<typeof opsOn>) => {
  await (await t.ctx.session()).device.stopAgent();
  t.ctx.close();
};

describe.skipIf(!serial)('a timeline of a journey', () => {
  const t = opsOn(androidProvider(new Adb(), {}), serial!, APP);
  afterAll(() => leave(t));

  const journey = async (name: string, steps: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-timeline-'));
    const file = join(flows, `${name}.flow`);
    writeFileSync(file, `${[`app ${APP}`, ...steps].join('\n')}\n`);
    await fixtureInFront();
    const started = await t.call('report', { action: 'timeline', dir });
    expect(started.error, started.text).toBe(false);
    console.log(started.text);
    const ran = await t.call('flow', { action: 'run', file });
    const done = await t.call('report', { action: 'stop' });
    expect(ran.error, ran.text).toBe(false);
    expect(done.error, done.text).toBe(false);
    console.log(done.text, 'host load', loadavg()[0]);
    return { dir, file: done.data.timeline!, page: pageData(done.data.timeline!) };
  };

  it('puts a slow frame where the video stood still, to within a display refresh', async () => {
    const { dir, file, page } = await journey('stall', [
      'open_link appdyno-fixture://open/list_stall',
      'swipe up',
      'swipe up',
      'swipe up',
      'swipe up',
    ]);
    const worst = page.frames.marks.reduce((a, b) => (b.ms > a.ms ? b : a));
    console.log('worst frame', worst);
    expect(worst.ms).toBeGreaterThan(900);
    expect(worst.late).toBe(true);
    expect(page.video?.bytes).toBeGreaterThan(1_000);

    const stamps = (await videoStamps(join(dir, 'video', 'screen.mp4')))!;
    expect(page.video!.firstAt).toBe(stamps[0]);
    const end = worst.at + worst.ms;
    const last = stamps.findLast((x) => x < worst.at + worst.ms / 2)!;
    const next = stamps.find((x) => x > worst.at + worst.ms / 2)!;
    console.log(
      `the video stood still ${(next - last).toFixed(1)} ms, for a frame of ${worst.ms} ms: ` +
        `${(worst.at - last).toFixed(1)} ms after its last frame, and ${(next - end).toFixed(1)} ms before its next`,
    );
    expect(next - last).toBeGreaterThan(worst.ms * 0.9);
    // no further off than the page says it is
    const within = page.clock.sources.find((s) => s.row === 'Video')!.withinMs;
    expect(Math.abs(worst.at - last)).toBeLessThan(within);
    expect(Math.abs(next - end)).toBeLessThan(within);

    expect(page.touches.marks.length).toBeGreaterThanOrEqual(4);
    expect(page.steps.marks.map((m) => m.name)).toContain('flow');
    expect(page.memory.marks.length).toBeGreaterThan(0);
    expect(page.logs.marks.length).toBeGreaterThan(0);
    expect(page.network.absent).toContain('no capture ran');
    expect(page.clock.sources.map((s) => s.row)).toEqual(
      expect.arrayContaining(['Video', 'Frames', 'Touches', 'Log']),
    );
    console.log('page', statSync(file).size, 'bytes; clock', JSON.stringify(page.clock));
  }, 180_000);

  it('still shows a main thread held up while a ripple goes on drawing', async () => {
    await adb(
      `run-as ${APP} sh -c 'mkdir -p files; rm -f files/stall_ms; echo 1500 > files/sleep_ms'`,
    );
    try {
      const { page } = await journey('held', [
        'open_link appdyno-fixture://open/cpu',
        'tap id=cpu_stall',
        'wait_for text="Taps: 1"',
      ]);
      const longest = Math.max(...page.frames.marks.map((f) => f.ms));
      console.log('longest frame', longest, 'stalls', JSON.stringify(page.stalls.marks));
      // what every frame source says of it
      expect(longest).toBeLessThan(200);
      if (!(await writesSkippedFrames())) return expect(page.stalls.marks).toEqual([]);
      expect(page.stalls.marks).toHaveLength(1);
      expect(page.stalls.marks[0]!.ms).toBeGreaterThan(1_200);
      expect(page.stalls.marks[0]!.ms).toBeLessThan(1_800);
    } finally {
      await adb(`run-as ${APP} rm -f files/sleep_ms`);
    }
  }, 180_000);
});

const udid = process.env.APPDYNO_IOS_UDID;

/** The same journey on a simulator, where everything but the video is on one clock already. */
/** The hold no frame shows, in the measure that used to read its longest frame for it. */
describe.skipIf(!serial)('perf_trace of a held main thread', () => {
  const t = opsOn(androidProvider(new Adb(), {}), serial!, APP);
  afterAll(() => leave(t));

  it('reads the hold, and says where that came from', async () => {
    await adb(
      `run-as ${APP} sh -c 'mkdir -p files; rm -f files/stall_ms; echo 1500 > files/sleep_ms'`,
    );
    try {
      await fixtureInFront();
      await adb(
        `am start -W -a android.intent.action.VIEW -d 'appdyno-fixture://open/cpu?n=${Date.now()}' ${APP}`,
      );
      await pause(1_500);
      await t.call('screen');
      const [trace] = await Promise.all([
        t.call('perf_trace', { seconds: 6 }),
        pause(3_000).then(() => t.call('tap', { selector: { id: 'cpu_stall' } })),
      ]);
      expect(trace.error, trace.text).toBe(false);
      console.log(`longest frame ${trace.data.worstMs}, held ${trace.data.heldMs}`);
      if (!(await writesSkippedFrames())) return expect(trace.data.heldMs).toBeUndefined();
      expect(trace.data.heldMs).toBeGreaterThan(1_200);
      expect(trace.data.heldMs).toBeLessThan(1_800);
      expect(trace.text).toContain('Skipped frames');
    } finally {
      await adb(`run-as ${APP} rm -f files/sleep_ms`);
    }
  }, 120_000);
});

describe.skipIf(!udid)('a timeline on a simulator', () => {
  const t = opsOn(simulatorProvider(), udid!, APP);
  afterAll(() => leave(t));

  it('holds the stall, and says what a simulator cannot give', async () => {
    const s = await t.ctx.session();
    // this screen stalls once: a process that has shown it has nothing left to show
    await s.device.terminate(APP);
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-timeline-'));
    const started = await t.call('report', { action: 'timeline', dir });
    expect(started.error, started.text).toBe(false);
    await s.device.openUrl('appdyno-fixture://open/list_stall', APP);
    await pause(1_000);
    for (let i = 0; i < 4; i++) await t.call('swipe', { direction: 'up' });
    await pause(1_000);
    const done = await t.call('report', { action: 'stop' });
    expect(done.error, done.text).toBe(false);
    console.log(done.text, 'host load', loadavg()[0]);
    const page = pageData(done.data.timeline!);
    const worst = page.frames.marks.reduce((a, b) => (b.ms > a.ms ? b : a));
    console.log('worst frame', worst, 'clock', JSON.stringify(page.clock));
    expect(worst.ms).toBeGreaterThan(900);
    // a simulator runs on this Mac's clock, and that is read as well, not assumed
    expect(Math.abs(page.clock.offsetMs)).toBeLessThanOrEqual(page.clock.boundMs);
    expect(page.clock.sources.find((c) => c.row === 'Video')!.withinMs).toBe(150);
    expect(page.touches.absent).toContain('Steps are what this tool sent');
    expect(page.steps.marks.map((m) => m.name)).toContain('swipe');
    expect(page.memory.marks.length).toBeGreaterThan(0);
  }, 240_000);
});

/**
 * The flight recorder against a real crash and a real stall of the fixture: it holds the last moments, and both keep them
 * unasked (APPDYNO_ANDROID_SERIAL). Nothing here tells it what happened: it finds out by what it watches.
 */
describe.skipIf(!serial)('the flight recorder', () => {
  const t = opsOn(androidProvider(new Adb(), {}), serial!, APP);
  afterAll(() => leave(t));

  /** The query makes each link a new intent: one equal to the task's root only brings the task to front. */
  const open = async (screen: string) => {
    await fixtureInFront();
    const url = `appdyno-fixture://open/${screen}?n=${Date.now()}`;
    await adb(`am start -W -a android.intent.action.VIEW -d '${url}' ${APP}`);
    await pause(1_500);
  };
  /** What it kept while `act` ran, with the recorder off again whatever became of `act`. */
  const flying = async (act: () => Promise<void>) => {
    const on = await t.call('report', { action: 'flight' });
    expect(on.error, on.text).toBe(false);
    const failed = await act().then(
      () => undefined,
      (e: unknown) => e,
    );
    const off = await t.call('report', { action: 'stop' });
    if (failed) throw failed;
    console.log(off.text, 'host load', loadavg()[0]);
    expect(off.data.saved).toHaveLength(1);
    return pageData(off.data.saved![0]!);
  };
  /** What it answers, as a tap that ends the app may have no good answer: the test looks at what came of it. */
  const tapById = async (id: string) => {
    await t.call('screen');
    return t.call('tap', { selector: { id } });
  };

  it('keeps a real crash, with the screen and the log up to it', async () => {
    await open('crash');
    const page = await flying(async () => {
      await pause(20_000);
      const before = (await adb(`pidof ${APP}`)).stdout.trim();
      await tapById('crash');
      await pause(15_000);
      // the fixture's process really ended: anything less proves nothing of the recorder
      const after = await adb(`pidof ${APP}`).then(
        (r) => r.stdout.trim(),
        () => '',
      );
      expect(before).not.toBe('');
      expect(after).not.toBe(before);
    });
    console.log(
      JSON.stringify({
        reason: page.reason,
        video: page.video,
        seconds: (page.to - page.from) / 1_000,
        frames: page.frames.marks.length,
        logs: page.logs.marks.length,
      }),
    );
    expect(page.reason).toContain('a crash');
    expect(page.video?.bytes).toBeGreaterThan(1_000);
    expect(page.frames.marks.length).toBeGreaterThan(0);
    expect(page.logs.marks.some((l) => /fixture crash|FATAL EXCEPTION/.test(l.text))).toBe(true);
  }, 180_000);

  it('keeps a real stall, by the frame that stood still', async () => {
    await open('list_stall');
    const page = await flying(async () => {
      await pause(5_000);
      for (let i = 0; i < 4; i++) await t.call('swipe', { direction: 'up' });
      await pause(WATCHED_MS);
    });
    console.log(page.reason);
    // a device that counts a frozen frame and gives no length for it says that
    expect(page.reason).toMatch(/a stall of \d+ ms|a frozen frame/);
    expect(Math.max(...page.frames.marks.map((f) => f.ms))).toBeGreaterThan(900);
  }, 180_000);

  it('keeps a stall no frame shows, by the log that says so', async (ctx) => {
    if (!(await writesSkippedFrames())) return ctx.skip();
    await adb(
      `run-as ${APP} sh -c 'mkdir -p files; rm -f files/stall_ms; echo 1500 > files/sleep_ms'`,
    );
    try {
      await open('cpu');
      const page = await flying(async () => {
        await pause(5_000);
        await tapById('cpu_stall');
        await pause(WATCHED_MS);
      });
      console.log(page.reason, JSON.stringify(page.stalls.marks));
      // an emulator's frame reads are blind to it and only the log tells; a Xiaomi's gfxinfo saw a frame of it too
      expect(page.reason).toMatch(/a stall of its main thread|a stall of \d+ ms/);
      expect(page.stalls.marks).toHaveLength(1);
    } finally {
      await adb(`run-as ${APP} rm -f files/sleep_ms`);
    }
  }, 180_000);
});

/** The same on a simulator, which restarts nothing, and whose crash reports are this Mac's (APPDYNO_IOS_UDID). */
describe.skipIf(!udid)('the flight recorder on a simulator', () => {
  const t = opsOn(simulatorProvider(), udid!, APP);
  afterAll(() => leave(t));

  it('keeps a real crash', async () => {
    const s = await t.ctx.session();
    await s.device.terminate(APP);
    await s.device.launch(APP);
    await pause(1_500);
    const on = await t.call('report', { action: 'flight' });
    expect(on.error, on.text).toBe(false);
    await s.device.openUrl('appdyno-fixture://open/crash', APP);
    await pause(8_000);
    await t.call('screen');
    await t.call('tap', { selector: { id: 'crash' } });
    await pause(12_000);
    const off = await t.call('report', { action: 'stop' });
    console.log(off.text, 'host load', loadavg()[0]);
    expect(off.data.saved).toHaveLength(1);
    const page = pageData(off.data.saved![0]!);
    console.log(
      JSON.stringify({
        reason: page.reason,
        seconds: (page.to - page.from) / 1_000,
        video: page.video?.bytes,
        frames: page.frames.marks.length,
      }),
    );
    expect(page.reason).toContain('a crash');
    expect(page.frames.marks.length).toBeGreaterThan(0);
    expect(page.video?.bytes).toBeGreaterThan(1_000);
  }, 240_000);
});
