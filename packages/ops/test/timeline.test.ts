import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  must,
  type DeviceProvider,
  type LiveMetrics,
  type MeasureSource,
  type ScreenRecorder,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import type { Timeline } from '@appdyno/perf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeVideo } from '@appdyno/testing/fake-video.js';
import { ServerContext } from '../src/context.js';
import { captures } from '../src/network.js';
import { filming } from '../src/record.js';
import { openReports } from '../src/report-state.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { callerOf } from '@appdyno/testing/calls.js';

const pageOf = (file: string) =>
  JSON.parse(
    must(
      /id="timeline">([\s\S]*?)<\/script>/.exec(readFileSync(file, 'utf8'))?.[1],
      'its timeline',
    ),
  ) as Timeline;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const refused = (): Promise<never> => Promise.reject(new Error('it will not start'));

/** A device with a recorder that writes a real file, and the frames of a stretch that ends when asked. */
class TimedDevice extends FakeDevice {
  ended = 0;
  override recorder: ScreenRecorder = {
    extension: 'mp4',
    start: (file) => Promise.resolve({ file }),
    stop: (h) => {
      writeFileSync(String(h.file), fakeVideo([Buffer.from('a frame')]));
      this.ended++;
      return Promise.resolve({ files: [String(h.file)] });
    },
  };
  readonly liveMetrics: LiveMetrics = {
    start: (onSample) => {
      const now = Date.now();
      onSample({ at: now, app: 'dev.app', memoryMb: 120, networkInKbps: 8, networkOutKbps: 1 });
      return Promise.resolve(() => undefined);
    },
  };
  /** When its one frame was drawn, by this Mac's clock: a test puts it inside the stretch. */
  drawnAt = 0;
  frameMarks: MeasureSource['frameMarks'] = async (_app, _seconds, during) => {
    await during();
    const at = this.drawnAt + this.clockAheadMs;
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

function connect(
  device: FakeDevice = new TimedDevice(),
  defaults: ConstructorParameters<typeof ServerContext>[2] = {},
) {
  const provider: DeviceProvider = {
    list: () =>
      Promise.resolve([{ serial: device.serial, state: 'device', ready: true, model: 'Fake' }]),
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext(DEFAULT_POLICY, [provider], {
    app: 'dev.app',
    ...defaults,
    storage: { measurements: mkdtempSync(join(tmpdir(), 'appdyno-measure-')), ...defaults.storage },
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
    // well inside: a measured offset is a little off, and the page goes by it
    await pause(20);
    device.drawnAt = Date.now();
    await pause(20);
    const r = await call('report', { action: 'stop' });
    expect(r.data).toMatchObject({ timeline: join(dir, 'timeline.html') });
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
    const page = pageOf(must(r.data.timeline, 'the timeline'));
    expect(page.clock.offsetMs).toBeGreaterThan(4_900);
    expect(page.frames.marks[0]?.ms).toBe(900);
    expect(page.touches.marks).toHaveLength(1);
    expect(page.memory.marks[0]?.mb).toBe(120);
    // a step is the Mac's, and now stands on the device's clock with the rest
    expect(page.steps.marks[0]?.name).toBe('tap');
    expect(page.steps.marks[0]?.at).toBeGreaterThanOrEqual(page.from - 50);
    expect(page.steps.marks[0]?.at).toBeLessThanOrEqual(page.to + 50);
  });

  it.each([
    ['its numbers', (d: TimedDevice) => (d.liveMetrics.start = refused)],
    ['the process of the app', (d: TimedDevice) => (d.appPid = refused)],
  ])('leaves nothing running when %s will not start', async (_, spoil) => {
    const device = new TimedDevice();
    let traces = 0;
    const { frameMarks } = device;
    device.frameMarks = async (app, seconds, during) => {
      traces++;
      const ended = await frameMarks(app, seconds, during);
      traces--;
      return ended;
    };
    spoil(device);
    const { call } = connect(device);
    await expect(call('report', { action: 'timeline', dir })).rejects.toThrow('it will not start');
    expect(filming.read(device.serial)).toBeUndefined();
    expect(traces).toBe(0);
  });

  it('stops reading a device at the end of what it can hold, if no one says stop', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const device = new TimedDevice();
      let ended = 0;
      device.liveMetrics.start = () =>
        Promise.resolve(() => {
          ended++;
        });
      const { call } = connect(device);
      await call('report', { action: 'timeline', dir });
      await vi.advanceTimersByTimeAsync(179_000);
      expect(ended).toBe(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(ended).toBe(1);
      await call('report', { action: 'stop' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries the video inside the page, and says how large it came to', async () => {
    const { call } = connect();
    await call('report', { action: 'timeline', dir });
    const r = await call('report', { action: 'stop' });
    expect(r.text).toContain('video inside it');
    expect(r.data.timelineBytes).toBeGreaterThan(1_000);
    expect(readFileSync(must(r.data.timeline, 'the timeline'), 'utf8')).toContain(
      'id="video-bytes"',
    );
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
    const page = pageOf(must(r.data.timeline, 'the timeline'));
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
    const timed = must(
      logs.mock.calls.map(([q]) => q).find((q) => q.timed),
      'the timed read',
    );
    expect(timed.since).toBeGreaterThan(before + 6_900);
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
    expect(logs.mock.calls.map(([q]) => q).find((q) => q.timed)?.pid).toBe('4242');
  });

  it('is finished by the end of a session, as anything else it left', async () => {
    const device = new TimedDevice();
    const { call, ctx } = connect(device);
    await call('report', { action: 'timeline', dir });
    expect(await ctx.end()).toEqual([]);
    expect(device.ended).toBe(1);
    expect(openReports.read(device.serial)).toBeUndefined();
    // the recording's own end must not come first and take the video from it
    const html = readFileSync(join(dir, 'timeline.html'), 'utf8');
    expect(html).toContain('id="video-bytes"');
    expect(pageOf(join(dir, 'timeline.html')).video).toBeDefined();
  });

  it('stops once, however many ask', async () => {
    const device = new TimedDevice();
    const { call, ctx } = connect(device);
    await call('report', { action: 'timeline', dir });
    const running = must((await ctx.session()).timeline, 'the timeline');
    await Promise.all([running.finish(), running.finish()]);
    expect(device.ended).toBe(1);
    await call('report', { action: 'stop' });
    expect(device.ended).toBe(1);
  });

  describe('a request in the file', () => {
    const withCapture = async (defaults: ConstructorParameters<typeof ServerContext>[2] = {}) => {
      const device = new TimedDevice();
      const { call } = connect(device, defaults);
      await call('report', { action: 'timeline', dir });
      captures.write(device.serial, { via: 'probe', since: Date.now(), handle: {} });
      (device as { network?: unknown }).network = {
        read: () =>
          Promise.resolve({
            entries: [
              {
                at: new Date().toISOString(),
                method: 'GET',
                url: 'https://api.example.com/items?page=2&token=abc123',
                ms: 12,
              },
            ],
          }),
      };
      const r = await call('report', { action: 'stop' });
      captures.remove(device.serial);
      return pageOf(must(r.data.timeline, 'the timeline')).network;
    };

    it('keeps its name and times, and no query, as nobody asked', async () => {
      const network = await withCapture();
      expect(network.marks[0]).toMatchObject({ name: 'GET api.example.com/items', ms: 12 });
      expect(JSON.stringify(network)).not.toMatch(/page=2|abc123/);
      expect(network.note).toBe('method, host and path, no query');
    });

    it('keeps the query only where a person turned that on, and hides a credential even then', async () => {
      const network = await withCapture({ fullUrls: true });
      expect(network.marks[0]?.name).toContain('page=2');
      expect(JSON.stringify(network)).not.toContain('abc123');
      expect(network.note).toBe('whole URLs, as asked');
    });
  });

  it('refuses a command line, which ends before there is anything to read', async () => {
    const remember = join(mkdtempSync(join(tmpdir(), 'appdyno-cli-')), 'session.json');
    const { call } = connect(new TimedDevice(), { storage: { remember } });
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
