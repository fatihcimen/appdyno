import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  Cannot,
  measuredLive,
  type Device,
  type LiveField,
  type LiveSample,
} from '../src/index.js';
import { must } from '../src/must.js';

const reading = <T>(value: T) => Promise.resolve({ value, raw: '', at: '' });

/** The fake's readers, as the mocks they are. */
const mocks = (d: Pick<Device, 'measure'>) =>
  d.measure as unknown as Record<'cpu' | 'memory' | 'network' | 'frames', Mock>;

/** A device's frame counters, which only grow until something resets them: `each` more frames at every read. */
const counters = (each: { totalFrames: number; jankyFrames: number; frozenFrames: number }) => {
  let read = 0;
  return () => {
    read++;
    return reading({
      totalFrames: 1_000 + each.totalFrames * read,
      jankyFrames: 40 + each.jankyFrames * read,
      frozenFrames: 3 + each.frozenFrames * read,
      frames: { worstMs: 41 },
    });
  };
};

function device(over: Record<string, unknown> = {}) {
  return {
    foreground: vi.fn(() => Promise.resolve('dev.app')),
    measure: {
      slowReads: [],
      cpu: vi.fn(() => reading({ percent: 12.5, windowMs: 500 })),
      memory: vi.fn(() => reading({ kb: 204_800, kind: 'pss' })),
      network: vi.fn(() => reading({ windowMs: 500, rxBytes: 6_250, txBytes: 625 })),
      frames: vi.fn(counters({ totalFrames: 58, jankyFrames: 2, frozenFrames: 0 })),
      ...over,
    },
  } as unknown as Pick<Device, 'measure' | 'foreground'>;
}

/** The first samples of a source, which is then stopped. */
async function samples(d: Pick<Device, 'measure' | 'foreground'>, count: number, app?: string) {
  const seen: LiveSample[] = [];
  let stop: () => void = () => undefined;
  await new Promise<void>((done) => {
    void measuredLive(d)
      .start((sample) => {
        seen.push(sample);
        if (seen.length === count) done();
      }, app)
      .then((s) => (stop = s));
  });
  stop();
  return seen;
}

const first = async (d: Pick<Device, 'measure' | 'foreground'>, app?: string) =>
  must((await samples(d, 1, app))[0], 'a sample');

describe('what one that runs all day reads', () => {
  const firstOf = (d: Pick<Device, 'measure' | 'foreground'>, fields: readonly LiveField[]) =>
    new Promise<LiveSample>((done) => {
      let stop: () => void = () => undefined;
      void measuredLive(d, fields)
        .start((sample) => {
          stop();
          done(sample);
        })
        .then((s) => (stop = s));
    });

  it('is what it asks for, and nothing that costs the device more', async () => {
    const d = device();
    const s = await firstOf(d, ['memoryMb', 'fps']);
    expect(s.memoryMb).toBe(200);
    expect(mocks(d).cpu).not.toHaveBeenCalled();
    expect(mocks(d).network).not.toHaveBeenCalled();
    expect(mocks(d).frames).toHaveBeenCalled();
    expect(s.absent?.cpuPercent).toContain('not read');
  });

  it('takes the screen as it is, and resets no counter a measure of its own counts from', async () => {
    const d = device();
    await firstOf(d, ['fps']);
    expect(mocks(d).frames).toHaveBeenCalledWith('dev.app', {
      reset: false,
      asItIs: true,
    });
  });
});

describe("a device's numbers each second", () => {
  it('come from the measures it already has', async () => {
    const sample = must((await samples(device(), 2))[1], 'a second sample');
    expect(sample).toMatchObject({
      app: 'dev.app',
      cpuPercent: 12.5,
      memoryMb: 200,
      framesDrawn: 58,
      jankyFrames: 2,
      frozenFrames: 0,
      worstFrameMs: 41,
      networkInKbps: 100,
      networkOutKbps: 10,
    });
    expect(sample.fps).toBeGreaterThan(0);
  });

  it('count no frames at first: what came before the first read belongs to no second', async () => {
    const sample = await first(device());
    expect(sample).not.toHaveProperty('fps');
    expect(sample.absent?.fps).toBe('counting begins');
  });

  it('count what came between two reads, and say a second whose counters another measure reset', async () => {
    const reads = [
      { totalFrames: 1_000, jankyFrames: 40, frozenFrames: 3 },
      { totalFrames: 1_060, jankyFrames: 70, frozenFrames: 4 },
      // perf_scroll began its own window here
      { totalFrames: 12, jankyFrames: 11, frozenFrames: 0 },
      { totalFrames: 72, jankyFrames: 70, frozenFrames: 0 },
    ];
    let newestNs = 0;
    const frames = vi.fn(() =>
      reading({ ...must(reads.shift(), 'a read'), frames: { worstMs: 41, newestNs: ++newestNs } }),
    );
    const [, second, third, fourth] = await samples(device({ frames }), 4);
    // the rows a device keeps outlive a second: each read takes those after the newest of the one before
    expect(frames.mock.calls.map((c: unknown[]) => (c[1] as { after?: number }).after)).toEqual([
      undefined,
      1,
      2,
      3,
    ]);
    expect(second).toMatchObject({ framesDrawn: 60, jankyFrames: 30, frozenFrames: 1 });
    expect(third).not.toHaveProperty('fps');
    expect(third?.absent?.fps).toBe('another measure began counting the frames again');
    expect(fourth).toMatchObject({ framesDrawn: 60, jankyFrames: 59, frozenFrames: 0 });
  });

  it('count frames over the time since the last count, however long the reading took', async () => {
    const slow = () =>
      new Promise((r) => setTimeout(r, 1_500)).then(() => ({
        value: { kb: 1024, kind: 'pss' },
        raw: '',
        at: '',
      }));
    const frames = counters({ totalFrames: 150, jankyFrames: 0, frozenFrames: 0 });
    const sample = must((await samples(device({ memory: slow, frames }), 2))[1], 'a second sample');
    // 150 frames in the second and a half the memory read holds a turn for, and not in a second
    expect(sample.fps).toBeGreaterThan(90);
    expect(sample.fps).toBeLessThan(110);
  });

  it('start counting again for an app newly in front', async () => {
    const d = device();
    vi.mocked(d.foreground).mockResolvedValueOnce('dev.app').mockResolvedValue('dev.other');
    const [, second] = await samples(d, 2);
    expect(second).not.toHaveProperty('fps');
    expect(second?.absent?.fps).toBe('counting begins');
  });

  it('read memory every few turns, its reader being the heaviest, and say it as read', async () => {
    const d = device();
    const seen = await samples(d, 3);
    expect(mocks(d).memory).toHaveBeenCalledOnce();
    expect(seen.map((s) => s.memoryMb)).toEqual([200, 200, 200]);
  });

  it('read memory at once for an app newly in front', async () => {
    const d = device();
    vi.mocked(d.foreground).mockResolvedValueOnce('dev.app').mockResolvedValue('dev.other');
    await samples(d, 2);
    expect(mocks(d).memory).toHaveBeenCalledTimes(2);
  });

  it('keep a refusal as its reason, and never as a 0', async () => {
    const sample = await first(
      device({ cpu: () => Promise.reject(new Cannot('CPU on this device')) }),
    );
    expect(sample).not.toHaveProperty('cpuPercent');
    expect(sample.absent?.cpuPercent).toBe('cannot measure CPU on this device');
    expect(sample.memoryMb).toBe(200);
  });

  it('take a whole measure out with its reader', async () => {
    const sample = await first(device({ frames: () => Promise.reject(new Error('no probe')) }));
    for (const field of ['fps', 'jankyFrames', 'frozenFrames'] as const) {
      expect(sample).not.toHaveProperty(field);
      expect(sample.absent?.[field]).toBe('no probe');
    }
  });

  it('do not read what is too slow to read each second', async () => {
    const memory = vi.fn();
    const sample = await first(device({ slowReads: ['memory'], memory }));
    expect(memory).not.toHaveBeenCalled();
    expect(sample.absent?.memoryMb).toContain('too slow');
  });

  it('say so when nothing is in front, and ask no measure', async () => {
    const d = device();
    vi.mocked(d.foreground).mockResolvedValue(undefined);
    const sample = await first(d);
    expect(sample.absent?.fps).toBe('waiting for the app in front');
    expect(mocks(d).cpu).not.toHaveBeenCalled();
  });

  it('go on through a read of what is in front that failed, rather than go blank', async () => {
    const d = device();
    vi.mocked(d.foreground)
      .mockResolvedValueOnce('dev.app')
      .mockRejectedValueOnce(new Error('timed out'))
      .mockResolvedValue('dev.app');
    const [, second] = await samples(d, 2);
    expect(second).toMatchObject({ app: 'dev.app', cpuPercent: 12.5, memoryMb: 200 });
    expect(must(second, 'a second sample').absent?.cpuPercent).toBeUndefined();
  });

  it('wait when that read fails with no app known yet: there is nothing to go on with', async () => {
    const d = device();
    vi.mocked(d.foreground).mockRejectedValue(new Error('timed out'));
    const sample = await first(d);
    expect(sample.absent?.fps).toBe('waiting for the app in front');
    expect(mocks(d).cpu).not.toHaveBeenCalled();
  });

  it('are about the app asked for, when one is', async () => {
    const d = device();
    expect((await first(d, 'other.app')).app).toBe('other.app');
    expect(d.foreground).not.toHaveBeenCalled();
  });

  it('stop, and say nothing after', async () => {
    const seen: LiveSample[] = [];
    const stop = await measuredLive(device()).start((s) => seen.push(s));
    stop();
    stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.length).toBeLessThanOrEqual(1);
  });

  it('stop only once the reading under way has ended, as it goes on asking the device', async () => {
    let answer: () => void = () => undefined;
    let ended = false;
    const d = device();
    d.measure.cpu = vi.fn(
      () => new Promise((r) => (answer = () => r({ value: { percent: 1 } }))),
    ) as never;
    const stop = await measuredLive(d, ['cpuPercent'], 1).start(() => undefined);
    await vi.waitFor(() => expect(mocks(d).cpu).toHaveBeenCalled());
    const stopped = Promise.resolve(stop()).then(() => (ended = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(ended).toBe(false);
    answer();
    await stopped;
    expect(ended).toBe(true);
  });
});
