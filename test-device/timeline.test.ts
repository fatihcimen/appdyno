import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, appleProvider, sleep as pause, videoStamps } from 'appdyno';
import { opsOn } from './helpers.js';
import type { Timeline } from '@appdyno/perf';

/**
 * A real journey on the fixture with a stall put in on purpose, and what the page says of it (APPDYNO_ANDROID_SERIAL).
 * The video is the check on the frames: both are stamped by the device, by two different parts of it, so a slow frame
 * and the freeze in the video have to fall together. Numbers are printed: docs/perf.md quotes them.
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const APP = 'dev.appdyno.fixture';
const run = promisify(execFile);
const adb = (command: string) => run('adb', ['-s', serial!, 'shell', command]);
const flows = mkdtempSync(join(tmpdir(), 'appdyno-timeline-flows-'));

const pageData = (file: string) =>
  JSON.parse(
    /id="timeline">([\s\S]*?)<\/script>/.exec(readFileSync(file, 'utf8'))![1]!,
  ) as Timeline;

describe.skipIf(!serial)('a timeline of a journey', () => {
  const t = opsOn(androidProvider(new Adb(), {}), serial!, APP);
  afterAll(() => t.ctx.close());

  const journey = async (name: string, steps: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-timeline-'));
    const file = join(flows, `${name}.flow`);
    writeFileSync(file, `${[`app ${APP}`, ...steps].join('\n')}\n`);
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
    expect(Math.abs(worst.at - last)).toBeLessThan(50);
    expect(Math.abs(next - end)).toBeLessThan(50);

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
describe.skipIf(!udid)('a timeline on a simulator', () => {
  const t = opsOn(appleProvider(), udid!, APP);
  afterAll(async () => {
    await (await t.ctx.session()).device.stopAgent();
    t.ctx.close();
  });

  it('holds the stall, and says what a simulator cannot give', async () => {
    const s = await t.ctx.session();
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
