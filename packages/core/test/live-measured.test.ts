import { describe, expect, it, vi } from 'vitest';
import { Cannot, measuredLive, type Device, type LiveSample } from '../src/index.js';

const reading = <T>(value: T) => Promise.resolve({ value, raw: '', at: '' });

function device(over: Record<string, unknown> = {}) {
  return {
    foreground: vi.fn(async () => 'dev.app'),
    measure: {
      slowReads: [],
      cpu: vi.fn(() => reading({ percent: 12.5, windowMs: 500 })),
      memory: vi.fn(() => reading({ kb: 204_800, kind: 'pss' })),
      network: vi.fn(() => reading({ windowMs: 500, rxBytes: 6_250, txBytes: 625 })),
      frames: vi.fn(() =>
        reading({ totalFrames: 58, jankyFrames: 2, frozenFrames: 0, frames: { worstMs: 41 } }),
      ),
      ...over,
    },
  } as unknown as Pick<Device, 'measure' | 'foreground'>;
}

/** The first samples of a source, which is then stopped. */
async function samples(d: Pick<Device, 'measure' | 'foreground'>, count: number, app?: string) {
  const seen: LiveSample[] = [];
  let stop = () => {};
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
  (await samples(d, 1, app))[0]!;

describe("a device's numbers each second", () => {
  it('come from the measures it already has', async () => {
    const sample = (await samples(device(), 2))[1]!;
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

  it('count no frames at first: what came before the first reset belongs to no second', async () => {
    const sample = await first(device());
    expect(sample).not.toHaveProperty('fps');
    expect(sample.absent?.fps).toBe('counting begins');
  });

  it('count frames over the time since the last count, however long the reading took', async () => {
    const slow = () =>
      new Promise((r) => setTimeout(r, 1_500)).then(() => ({
        value: { kb: 1024, kind: 'pss' },
        raw: '',
        at: '',
      }));
    const frames = () => reading({ totalFrames: 150, jankyFrames: 0, frozenFrames: 0 });
    const sample = (await samples(device({ memory: slow, frames }), 2))[1]!;
    // 150 frames in the second and a half the memory read holds a turn for, and not in a second
    expect(sample.fps).toBeGreaterThan(90);
    expect(sample.fps).toBeLessThan(110);
  });

  it('start counting again for an app newly in front', async () => {
    const d = device();
    vi.mocked(d.foreground).mockResolvedValueOnce('dev.app').mockResolvedValue('dev.other');
    const [, second] = await samples(d, 2);
    expect(second).not.toHaveProperty('fps');
    expect(second!.absent?.fps).toBe('counting begins');
  });

  it('read memory every few turns, its reader being the heaviest, and say it as read', async () => {
    const d = device();
    const seen = await samples(d, 3);
    expect(d.measure.memory).toHaveBeenCalledOnce();
    expect(seen.map((s) => s.memoryMb)).toEqual([200, 200, 200]);
  });

  it('read memory at once for an app newly in front', async () => {
    const d = device();
    vi.mocked(d.foreground).mockResolvedValueOnce('dev.app').mockResolvedValue('dev.other');
    await samples(d, 2);
    expect(d.measure.memory).toHaveBeenCalledTimes(2);
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
    expect(d.measure.cpu).not.toHaveBeenCalled();
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
});
