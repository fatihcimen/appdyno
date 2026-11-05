import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceProvider, LiveMetrics, MeasureSource, ScreenRecorder } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import type { Timeline } from '@appdyno/perf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeVideo } from '../../core/test/fake-video.js';
import { ServerContext } from '../src/context.js';
import { filming } from '../src/record.js';
import { openReports } from '../src/report-state.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import { FakeDevice } from './fake-device.js';
import { callerOf } from './helpers.js';

const pageOf = (file: string) =>
  JSON.parse(
    /id="timeline">([\s\S]*?)<\/script>/.exec(readFileSync(file, 'utf8'))![1]!,
  ) as Timeline;

/** A device with a recorder that writes a real file, and the frames of a stretch that ends when asked. */
class TimedDevice extends FakeDevice {
  ended = 0;
  override recorder: ScreenRecorder = {
    extension: 'mp4',
    start: async (file) => ({ file }),
    stop: async (h) => {
      writeFileSync(String(h.file), fakeVideo([Buffer.from('a frame')]));
      this.ended++;
      return { files: [String(h.file)] };
    },
  };
  readonly liveMetrics: LiveMetrics = {
    start: async (onSample) => {
      const now = Date.now();
      onSample({ at: now, app: 'dev.app', memoryMb: 120, networkInKbps: 8, networkOutKbps: 1 });
      return () => undefined;
    },
  };
  frameMarks: MeasureSource['frameMarks'] = async (_app, _seconds, during) => {
    await during();
    const at = Date.now() + this.clockAheadMs;
    return {
      value: { frames: [{ at, ms: 900, late: true }], input: [{ at, ms: 40 }] },
      raw: '',
      at: new Date().toISOString(),
    };
  };
  override get measure() {
    return { ...super.measure, frameMarks: this.frameMarks };
  }
}

function connect(device: FakeDevice = new TimedDevice(), defaults = {}) {
  const provider: DeviceProvider = {
    list: async () => [{ serial: device.serial, state: 'device', ready: true, model: 'Fake' }],
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext(DEFAULT_POLICY, [provider], {
    app: 'dev.app',
    measurements: mkdtempSync(join(tmpdir(), 'appdyno-measure-')),
    ...defaults,
  });
  return { ctx, call: callerOf(ctx), device };
}

describe('report timeline', () => {
  let dir: string;
  beforeEach(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-state-')));
    dir = join(mkdtempSync(join(tmpdir(), 'appdyno-report-')), 'session');
  });

  it('writes one page beside the report, with its rows on the clock', async () => {
    const device = new TimedDevice();
    device.clockAheadMs = 5_000;
    const { call } = connect(device);
    await call('report', { action: 'timeline', dir });
    await call('tap', { x: 1, y: 1 });
    const r = await call('report', { action: 'stop' });
    expect(r.data).toMatchObject({ timeline: join(dir, 'timeline.html') });
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
    const page = pageOf(r.data.timeline as string);
    expect(page.clock.offsetMs).toBeGreaterThan(4_900);
    expect(page.frames.marks[0]!.ms).toBe(900);
    expect(page.touches.marks).toHaveLength(1);
    expect(page.memory.marks[0]!.mb).toBe(120);
    // a step is the Mac's, and now stands on the device's clock with the rest
    expect(page.steps.marks[0]!.name).toBe('tap');
    expect(page.steps.marks[0]!.at).toBeGreaterThanOrEqual(page.from - 50);
    expect(page.steps.marks[0]!.at).toBeLessThanOrEqual(page.to + 50);
  });

  it('carries the video inside the page, and says how large it came to', async () => {
    const { call } = connect();
    await call('report', { action: 'timeline', dir });
    const r = await call('report', { action: 'stop' });
    expect(r.text).toContain('video inside it');
    expect(r.data.timelineBytes).toBeGreaterThan(1_000);
    expect(readFileSync(r.data.timeline as string, 'utf8')).toContain('id="video-bytes"');
  });

  it('fills an empty row with its reason, and takes nothing else with it', async () => {
    const device = new TimedDevice();
    device.recorder = {
      ...device.recorder,
      start: () => Promise.reject(new DeviceError('UNSUPPORTED', 'this phone records nothing')),
    };
    device.frameMarks = () =>
      Promise.reject(new DeviceError('UNSUPPORTED', 'no frames on a clock here'));
    device.logNote = 'no log on this device';
    const { call } = connect(device);
    await call('report', { action: 'timeline', dir });
    const r = await call('report', { action: 'stop' });
    expect(r.text).toContain('no video: this phone records nothing');
    const page = pageOf(r.data.timeline as string);
    expect(page.noVideo).toBe('this phone records nothing');
    expect(page.frames.absent).toBe('no frames on a clock here');
    expect(page.logs.absent).toBe('no log on this device');
    expect(page.memory.marks).toHaveLength(1);
  });

  it('asks a device for its lines timed, from the start of the stretch by its own clock', async () => {
    const device = new TimedDevice();
    device.clockAheadMs = 7_000;
    const logs = vi.spyOn(device, 'logs');
    const { call } = connect(device);
    const before = Date.now();
    await call('report', { action: 'timeline', dir });
    await call('report', { action: 'stop' });
    const timed = logs.mock.calls.map(([q]) => q).find((q) => q.timed)!;
    expect(timed.since!).toBeGreaterThan(before + 6_900);
  });

  it('reads the log of a process by its id, for one that has ended since', async () => {
    const device = new TimedDevice();
    device.pid = '4242';
    device.appPid = device.fakePid;
    const logs = vi.spyOn(device, 'logs');
    const { call } = connect(device);
    await call('report', { action: 'timeline', dir });
    device.pid = undefined;
    await call('report', { action: 'stop' });
    expect(logs.mock.calls.map(([q]) => q).find((q) => q.timed)!.pid).toBe('4242');
  });

  it('is finished by the end of a session, as anything else it left', async () => {
    const device = new TimedDevice();
    const { call, ctx } = connect(device);
    await call('report', { action: 'timeline', dir });
    expect(await ctx.end()).toEqual([]);
    expect(existsSync(join(dir, 'timeline.html'))).toBe(true);
    expect(device.ended).toBe(1);
    expect(openReports.read(device.serial)).toBeUndefined();
  });

  it('stops once, however many ask', async () => {
    const device = new TimedDevice();
    const { call, ctx } = connect(device);
    await call('report', { action: 'timeline', dir });
    const running = (await ctx.session()).timeline!;
    await Promise.all([running.finish(), running.finish()]);
    expect(device.ended).toBe(1);
    await call('report', { action: 'stop' });
    expect(device.ended).toBe(1);
  });

  it('refuses a command line, which ends before there is anything to read', async () => {
    const remember = join(mkdtempSync(join(tmpdir(), 'appdyno-cli-')), 'session.json');
    const { call } = connect(new TimedDevice(), { remember });
    await expect(call('report', { action: 'timeline', dir })).rejects.toThrow(/appdyno timeline/);
  });

  it('refuses with no app to be about', async () => {
    const { call } = connect(new TimedDevice(), { app: undefined });
    await expect(call('report', { action: 'timeline', dir })).rejects.toThrow(/select an app/);
  });

  it('refuses over a recording it would have to stop', async () => {
    const device = new TimedDevice();
    const { call } = connect(device);
    await call('screen');
    filming.write(device.serial, {
      handle: {},
      since: new Date().toISOString(),
      file: join(dir, 'x.mp4'),
    });
    await expect(call('report', { action: 'timeline', dir })).rejects.toThrow(
      /a recording has run/,
    );
  });

  it('leaves no report open when it could not start', async () => {
    const device = new TimedDevice();
    device.wallClock = () => Promise.reject(new DeviceError('DEVICE_GONE', 'it went away'));
    const { call } = connect(device);
    await expect(call('report', { action: 'timeline', dir })).rejects.toThrow('it went away');
    expect(openReports.read(device.serial)).toBeUndefined();
  });

  it('takes no picture after a step: the video has them, and a picture would be in its frames', async () => {
    const device = new TimedDevice();
    const shots = vi.spyOn(device, 'screenshot');
    const { call } = connect(device);
    await call('report', { action: 'timeline', dir });
    await call('tap', { x: 1, y: 1 });
    await call('report', { action: 'stop' });
    expect(shots).not.toHaveBeenCalled();
  });
});
