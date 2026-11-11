import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  must,
  type DeviceProvider,
  type LiveMetrics,
  type LiveSample,
  type ScreenRecorder,
} from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeVideo } from '@appdyno/testing/fake-video.js';
import { ServerContext } from '../src/context.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import { filming } from '../src/record.js';
import { VideoRing } from '../src/timeline/ring.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { callerOf } from '@appdyno/testing/calls.js';

/** A recorder that writes a real file, and counts what it was asked. */
const recorder = (over: Partial<ScreenRecorder> = {}) => {
  const log = { started: 0, stopped: 0, running: 0, most: 0, light: [] as (boolean | undefined)[] };
  const r: ScreenRecorder = {
    extension: 'mp4',
    start: (file, o) => {
      log.started++;
      log.running++;
      log.most = Math.max(log.most, log.running);
      log.light.push(o.light);
      return Promise.resolve({ file });
    },
    stop: (h) => {
      log.stopped++;
      log.running--;
      writeFileSync(String(h.file), fakeVideo([Buffer.from(`frame of ${String(h.file)}`)]));
      return Promise.resolve({ files: [String(h.file)] });
    },
    ...over,
  };
  return { r, log };
};

describe('a ring of video', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'appdyno-ring-'));

  it('overlaps its segments, so that nothing falls between two', async () => {
    const { r, log } = recorder();
    const ring = new VideoRing(r, dir(), 15, 0);
    await ring.rotate();
    await ring.rotate();
    expect(log.most).toBe(2);
    expect(log.running).toBe(1);
  });

  it('asks for the light rate, and a limit a dead process cannot outrun', async () => {
    const { r, log } = recorder();
    const start = vi.spyOn(r, 'start');
    const ring = new VideoRing(r, dir(), 15, 0);
    await ring.rotate();
    expect(log.light).toEqual([true]);
    expect(start.mock.calls[0]?.[1].maxSeconds).toBe(45);
  });

  it('keeps no more than it says, however long it runs', async () => {
    const { r } = recorder();
    const d = dir();
    const ring = new VideoRing(r, d, 15, 0);
    for (let i = 0; i < 40; i++) await ring.rotate();
    expect(readdirSync(d).filter((f) => f.startsWith('segment-')).length).toBeLessThanOrEqual(3);
  });

  it('gives what it keeps as one video, each part where it was on the clock', async () => {
    const { r } = recorder();
    const d = dir();
    const ring = new VideoRing(r, d, 15, 40);
    await ring.rotate();
    await ring.rotate();
    const v = must(await ring.seal(join(d, 'whole.mp4')), 'the video');
    expect(v.file).toBe(join(d, 'whole.mp4'));
    expect(v.facts.parts).toHaveLength(2);
    expect(v.facts.parts?.[0]?.s).toBe(0);
    expect(v.facts.parts?.[1]?.s).toBeGreaterThan(0);
    expect(existsSync(v.file)).toBe(true);
  });

  it('gives the newest alone where two will not join', async () => {
    let n = 0;
    const { r } = recorder({
      stop: (h) => {
        writeFileSync(String(h.file), fakeVideo([Buffer.from('x')], { stsd: `settings ${++n}` }));
        return Promise.resolve({ files: [String(h.file)] });
      },
    });
    const d = dir();
    const ring = new VideoRing(r, d, 15, 0);
    await ring.rotate();
    await ring.rotate();
    const v = must(await ring.seal(join(d, 'whole.mp4')), 'the video');
    expect(v.file).toBe(join(d, 'segment-2.mp4'));
    expect(v.facts.parts).toBeUndefined();
  });

  it('starts nothing once it is closing: a turn that comes late has nothing to do', async () => {
    let letGo: () => void = () => undefined;
    const held = new Promise<void>((r) => (letGo = r));
    const { r, log } = recorder();
    const start = r.start.bind(r);
    let first = true;
    r.start = async (file, o) => {
      if (first) await held;
      first = false;
      return start(file, o);
    };
    const d = dir();
    const ring = new VideoRing(r, d, 15, 0);
    const turning = ring.rotate();
    const sealing = ring.seal(join(d, 'whole.mp4'));
    const late = ring.rotate();
    letGo();
    await Promise.all([turning, sealing, late]);
    expect(log.started).toBe(1);
    expect(log.running).toBe(0);
  });

  it('ends the old segment first where a device runs one encoder, and asks no more', async () => {
    const { r, log } = recorder();
    const start = r.start.bind(r);
    r.start = async (file, o) => {
      if (log.running > 0) throw new Error('screenrecord did not start: Encoder failed (err=-38)');
      return start(file, o);
    };
    const d = dir();
    const ring = new VideoRing(r, d, 15, 0);
    for (let i = 0; i < 4; i++) await ring.rotate();
    expect(log.started).toBe(4);
    expect(log.stopped).toBe(3);
    expect(log.most).toBe(1);
    expect(await ring.seal(join(d, 'whole.mp4'))).toBeDefined();
    expect(log.running).toBe(0);
  });

  it('keeps what it holds when the last segment has nothing in it', async () => {
    const { r } = recorder();
    const stop = r.stop.bind(r);
    let stops = 0;
    r.stop = async (h) => {
      if (++stops === 2) throw new Error('the recording failed: seg1.mp4 is empty');
      return stop(h);
    };
    const d = dir();
    const ring = new VideoRing(r, d, 15, 0);
    await ring.rotate();
    await ring.rotate();
    expect((await ring.seal(join(d, 'whole.mp4')))?.facts.bytes).toBeGreaterThan(0);
  });

  it('leaves nothing behind when it is dropped', async () => {
    const { r, log } = recorder();
    const d = dir();
    const ring = new VideoRing(r, d, 15, 0);
    await ring.rotate();
    await ring.rotate();
    await ring.drop();
    expect(log.running).toBe(0);
    expect(readdirSync(d).filter((f) => f.startsWith('segment-1'))).toEqual([]);
  });
});

const refused = (): Promise<never> => Promise.reject(new Error('it will not start'));

/** A device whose app, stalls and crashes a test decides. */
class FlightDevice extends FakeDevice {
  rec = recorder();
  override recorder = this.rec.r;
  tell: (s: LiveSample) => void = () => undefined;
  liveEnded = 0;
  readonly liveMetrics: LiveMetrics = {
    start: (onSample) => {
      this.tell = onSample;
      return Promise.resolve(() => this.liveEnded++);
    },
  };
  frameRuns = 0;
  /** Traces under way now. */
  frameTraces = 0;
  /** While set, a trace being started does not come up. */
  frameGate: Promise<void> | undefined;
  /** What its trace leaves on this Mac. */
  tracePath: string | undefined;
  override get measure() {
    return {
      ...super.measure,
      frameMarks: async (_a: string, _s: number, during: () => Promise<unknown>) => {
        this.frameRuns++;
        await this.frameGate;
        this.frameTraces++;
        await during();
        this.frameTraces--;
        return {
          value: {
            frames: [{ at: Date.now(), ms: 900, late: true }],
            ...(this.tracePath && { tracePath: this.tracePath }),
          },
          raw: '',
          at: new Date().toISOString(),
        };
      },
    };
  }
}

function connect(device: FlightDevice, flightSeconds?: number) {
  const provider: DeviceProvider = {
    list: () =>
      Promise.resolve([{ serial: device.serial, state: 'device', ready: true, model: 'Fake' }]),
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext(DEFAULT_POLICY, [provider], {
    app: 'dev.app',
    measurements: mkdtempSync(join(tmpdir(), 'appdyno-measure-')),
    ...(flightSeconds !== undefined && { flightSeconds }),
  });
  return { ctx, call: callerOf(ctx) };
}

const until = async (met: () => boolean) => {
  for (let i = 0; i < 400 && !met(); i++) await vi.advanceTimersByTimeAsync(50);
  expect(met()).toBe(true);
};

describe('the flight recorder', () => {
  let state: string;
  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'appdyno-state-'));
    vi.stubEnv('APPDYNO_STATE_DIR', state);
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const saved = () =>
    existsSync(join(state, 'traces'))
      ? readdirSync(join(state, 'traces')).filter((f) => f.endsWith('.timeline.html'))
      : [];

  it('is off until asked: nothing of it runs in a session', async () => {
    const d = new FlightDevice();
    const { call } = connect(d);
    await call('screen');
    expect(d.rec.log.started).toBe(0);
    expect(d.frameRuns).toBe(0);
  });

  it('keeps the last seconds when a frame stands still, and goes on', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 20);
    const r = await call('report', { action: 'flight' });
    expect(r.text).toContain('the last 20 s');
    await vi.advanceTimersByTimeAsync(10_500);
    d.tell({ at: Date.now(), worstFrameMs: 950 });
    await until(() => saved().length === 1);
    const page = readFileSync(join(state, 'traces', must(saved()[0], 'a page')), 'utf8');
    expect(page).toContain('a stall of 950 ms');
    expect(page).toContain('id="video-bytes"');
    await until(() => d.frameRuns === 2);
    const off = await call('report', { action: 'stop' });
    expect(off.data.saved).toHaveLength(1);
  });

  it('calls one stall that repeats one, within what it keeps', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 20);
    await call('report', { action: 'flight' });
    d.tell({ at: Date.now(), worstFrameMs: 950 });
    await until(() => saved().length === 1);
    await until(() => d.frameRuns === 2);
    d.tell({ at: Date.now(), worstFrameMs: 950 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(saved()).toHaveLength(1);
    await call('report', { action: 'stop' });
  });

  it('goes by a frozen frame too, and by nothing less', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 20);
    await call('report', { action: 'flight' });
    d.tell({ at: Date.now(), worstFrameMs: 300, frozenFrames: 0 });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(saved()).toEqual([]);
    d.tell({ at: Date.now(), frozenFrames: 1 });
    await until(() => saved().length === 1);
    await call('report', { action: 'stop' });
  });

  it('keeps a crash, says why, and waits for the app to come back', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 20);
    await call('report', { action: 'flight' });
    d.running = false;
    d.crashReports = [{ at: new Date().toISOString(), reason: 'java.lang.IllegalStateException' }];
    d.tell({ at: Date.now() });
    await until(() => saved().length === 1);
    expect(readFileSync(join(state, 'traces', must(saved()[0], 'a page')), 'utf8')).toContain(
      'a crash: java.lang.IllegalStateException',
    );
    const runs = d.frameRuns;
    d.running = true;
    await until(() => d.frameRuns === runs + 1);
    await call('report', { action: 'stop' });
  });

  it('sees a crash Android has already restarted: the app runs, in another process', async () => {
    const d = new FlightDevice();
    d.pid = '100';
    d.appPid = d.fakePid;
    const { call } = connect(d, 20);
    await call('report', { action: 'flight' });
    d.pid = '200';
    d.crashReports = [{ at: new Date().toISOString(), reason: 'it crashed' }];
    d.tell({ at: Date.now() });
    await until(() => saved().length === 1);
    expect(readFileSync(join(state, 'traces', must(saved()[0], 'a page')), 'utf8')).toContain(
      'a crash: it crashed',
    );
    await call('report', { action: 'stop' });
  });

  it('claims no more of a stretch than it watched', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 30);
    await call('report', { action: 'flight' });
    await vi.advanceTimersByTimeAsync(5_000);
    d.tell({ at: Date.now(), worstFrameMs: 950 });
    await until(() => saved().length === 1);
    const html = readFileSync(join(state, 'traces', must(saved()[0], 'a page')), 'utf8');
    const page = JSON.parse(
      must(/id="timeline">([\s\S]*?)<\/script>/.exec(html)?.[1], 'its timeline'),
    ) as {
      from: number;
      to: number;
    };
    expect(page.to - page.from).toBeLessThan(10_000);
    await call('report', { action: 'stop' });
  });

  it('keeps nothing of an app a person closed: no report, no crash', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 20);
    await call('report', { action: 'flight' });
    d.running = false;
    d.tell({ at: Date.now() });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(saved()).toEqual([]);
    d.running = true;
    // it may be in its look for the app: a stop waits that second out
    const off = call('report', { action: 'stop' });
    await vi.advanceTimersByTimeAsync(2_000);
    await off;
  });

  it('goes on after a save that failed: only that one is lost', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 20);
    await call('report', { action: 'flight' });
    const traces = join(state, 'traces');
    rmSync(traces, { recursive: true });
    writeFileSync(traces, 'where its pages would go');
    await vi.advanceTimersByTimeAsync(10_500);
    const runs = d.frameRuns;
    d.tell({ at: Date.now(), worstFrameMs: 950 });
    await until(() => d.frameRuns === runs + 1);
    await call('report', { action: 'stop' });
  });

  it('keeps what it holds when a person asks', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 20);
    await call('report', { action: 'flight' });
    const r = call('report', { action: 'write' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await r).text).toContain('kept: ');
    expect(saved()).toHaveLength(1);
    await call('report', { action: 'stop' });
  });

  it('leaves nothing on this Mac, and no recording running, when it is turned off', async () => {
    const d = new FlightDevice();
    d.tracePath = join(state, 'ring.pftrace');
    writeFileSync(d.tracePath, 'a trace');
    const { call } = connect(d, 20);
    await call('report', { action: 'flight' });
    await vi.advanceTimersByTimeAsync(25_000);
    await call('report', { action: 'stop' });
    expect(existsSync(d.tracePath)).toBe(false);
    expect(d.rec.log.running).toBe(0);
    expect(filming.read(d.serial)).toBeUndefined();
    expect(existsSync(join(state, 'flight'))).toBe(true);
    expect(readdirSync(join(state, 'flight'))).toEqual([]);
    expect(d.liveEnded).toBe(1);
  });

  it('turned off in the middle of a save, keeps that page and leaves nothing running', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 20);
    await call('report', { action: 'flight' });
    d.tell({ at: Date.now(), worstFrameMs: 950 });
    // it is in the pause after a stall, before it writes the page
    await vi.advanceTimersByTimeAsync(500);
    const stopping = call('report', { action: 'stop' });
    await vi.advanceTimersByTimeAsync(5_000);
    const off = await stopping;
    expect(off.data.saved).toHaveLength(1);
    expect(d.rec.log.running).toBe(0);
    expect(filming.read(d.serial)).toBeUndefined();
    const runs = d.frameRuns;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(d.frameRuns).toBe(runs);
    expect(d.rec.log.running).toBe(0);
  });

  it.each([
    ['its numbers', (d: FlightDevice) => (d.liveMetrics.start = () => refused())],
    ['the process of the app', (d: FlightDevice) => (d.appPid = refused)],
  ])('leaves nothing running when %s will not start', async (_, spoil) => {
    const d = new FlightDevice();
    spoil(d);
    const { call } = connect(d, 20);
    await expect(call('report', { action: 'flight' })).rejects.toThrow('it will not start');
    expect(d.rec.log.running).toBe(0);
    expect(d.frameTraces).toBe(0);
    expect(filming.read(d.serial)).toBeUndefined();
    const { started } = d.rec.log;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(d.rec.log.started).toBe(started);
    expect(d.frameTraces).toBe(0);
  });

  it('ends the trace that was coming up when it was turned off', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 20);
    await call('report', { action: 'flight' });
    let up: () => void = () => undefined;
    d.frameGate = new Promise((r) => (up = r));
    await vi.advanceTimersByTimeAsync(480_000);
    expect(d.frameRuns).toBe(2);
    const off = call('report', { action: 'stop' });
    await vi.advanceTimersByTimeAsync(1_000);
    d.frameGate = undefined;
    up();
    await vi.advanceTimersByTimeAsync(5_000);
    await off;
    expect(d.frameTraces).toBe(0);
  });

  it('looks for a crash by the clock of the device, which may be far from this one', async () => {
    const behind = 3_600_000;
    const d = new FlightDevice();
    d.wallClock = () => Promise.resolve(Date.now() - behind);
    const { call } = connect(d, 20);
    await call('report', { action: 'flight' });
    const all = d.crashes.bind(d);
    d.crashes = async (q) => {
      const answer = await all(q);
      return {
        ...answer,
        reports: answer.reports.filter((r) => !q.since || Date.parse(r.at) >= q.since),
      };
    };
    d.running = false;
    d.crashReports = [{ at: new Date(Date.now() - behind).toISOString(), reason: 'it crashed' }];
    d.tell({ at: Date.now() });
    await until(() => saved().length === 1);
    d.running = true;
    const off = call('report', { action: 'stop' });
    await vi.advanceTimersByTimeAsync(2_000);
    await off;
  });

  it('ends with its session', async () => {
    const d = new FlightDevice();
    const { call, ctx } = connect(d, 20);
    await call('report', { action: 'flight' });
    expect(await ctx.end()).toEqual([]);
    expect(d.rec.log.running).toBe(0);
    expect((await ctx.session()).flight).toBeUndefined();
  });

  it('refuses a second one, a command line, and an app that is not running', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 20);
    await call('report', { action: 'flight' });
    await expect(call('report', { action: 'flight' })).rejects.toThrow(/a flight recorder runs/);
    await call('report', { action: 'stop' });
    const remember = join(mkdtempSync(join(tmpdir(), 'appdyno-cli-')), 'session.json');
    const provider: DeviceProvider = {
      list: () =>
        Promise.resolve([{ serial: d.serial, state: 'device', ready: true, model: 'Fake' }]),
      handles: () => true,
      open: () => d,
    };
    const cli = new ServerContext(DEFAULT_POLICY, [provider], { app: 'dev.app', remember });
    await expect(callerOf(cli)('report', { action: 'flight' })).rejects.toThrow(/appdyno flight/);
    d.running = false;
    await expect(call('report', { action: 'flight' })).rejects.toThrow(/not running/);
  });

  it('leaves its mark on what is measured while it runs: an encoder is at work on the device', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 20);
    const quiet = await call('perf_snapshot');
    expect(quiet.data.noise).not.toContain('mirrored');
    await call('report', { action: 'flight' });
    const during = await call('perf_snapshot');
    expect(during.data.noise).toContain('mirrored');
    await call('report', { action: 'stop' });
  });

  it('caps what it holds, whatever a flag asks for', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 100_000);
    expect((await call('report', { action: 'flight' })).text).toContain('the last 120 s');
    await call('report', { action: 'stop' });
  });

  it('holds enough to outlast a look on a busy device, whatever a flag asks for', async () => {
    const d = new FlightDevice();
    const { call } = connect(d, 3);
    expect((await call('report', { action: 'flight' })).text).toContain('the last 20 s');
    await call('report', { action: 'stop' });
  });
});
