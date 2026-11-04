import { pause } from '../call.js';
import type { Device } from '../device.js';
import type { Capability, Measured } from '../measure.js';
import { LIVE_FIELDS, type LiveField, type LiveMetrics, type LiveSample } from './live-metrics.js';

/** The least time between two samples: a reader that takes longer sets the pace itself. */
const SECOND_MS = 1_000;
const CPU_WINDOW_MS = 500;
/** Memory moves slowly and its reader is the heaviest of them: read this often in seconds, and said as read until then. */
const MEMORY_EVERY = 5;

const NOT_EACH_SECOND = 'too slow to read each second here';
const FRAME_FIELDS: LiveField[] = ['fps', 'jankyFrames', 'frozenFrames'];
const COUNT_BEGINS = 'counting begins';

/** What a source keeps from turn to turn: which app, since when its frames are counted, and its memory as last read. */
type Kept = { app?: string; since?: number; turn: number; memoryMb?: number };

/** Whatever is missing is missing for one reason, said once for each measure it takes away. */
const allAbsent = (fields: readonly LiveField[], why: string) =>
  Object.fromEntries(fields.map((f) => [f, why]));

/** One second of `app`, by the readers the device's measures already use: nothing here parses anything. */
async function sampleOf(
  device: Pick<Device, 'measure'>,
  app: string,
  kept: Kept,
): Promise<LiveSample> {
  const { measure } = device;
  const sample: LiveSample = { at: Date.now(), app };
  const absent: LiveSample['absent'] = {
    ...allAbsent(['threads'], 'not read each second'),
  };
  const read = async <T>(
    fields: LiveField[],
    reader: Capability,
    get: () => Promise<Measured<T>>,
    use: (v: T) => void,
  ) => {
    if (measure.slowReads.includes(reader))
      return Object.assign(absent, allAbsent(fields, NOT_EACH_SECOND));
    try {
      use((await get()).value);
    } catch (e) {
      Object.assign(absent, allAbsent(fields, (e as Error).message));
    }
    return undefined;
  };
  const sameApp = kept.app === app;
  const memoryDue = !sameApp || kept.memoryMb === undefined || kept.turn % MEMORY_EVERY === 0;
  kept.turn += 1;
  if (!memoryDue) sample.memoryMb = kept.memoryMb!;
  await Promise.all([
    read(
      ['cpuPercent'],
      'cpu',
      () => measure.cpu(app, CPU_WINDOW_MS),
      (v) => (sample.cpuPercent = v.percent),
    ),
    memoryDue &&
      read(
        ['memoryMb'],
        'memory',
        () => measure.memory(app),
        (v) => (sample.memoryMb = kept.memoryMb = Math.round(v.kb / 1024)),
      ),
    read(
      ['networkInKbps', 'networkOutKbps'],
      'network',
      () => measure.network(app, CPU_WINDOW_MS),
      (v) => {
        // bits a millisecond are kilobits a second
        sample.networkInKbps = Math.round((v.rxBytes * 8) / v.windowMs);
        sample.networkOutKbps = Math.round((v.txBytes * 8) / v.windowMs);
      },
    ),
    read(
      FRAME_FIELDS,
      'frames',
      () => measure.frames(app, { reset: true }),
      (v) => {
        const now = Date.now();
        const since = sameApp ? kept.since : undefined;
        kept.since = now;
        // what was counted before the first reset belongs to no second
        if (since === undefined)
          return void Object.assign(absent, allAbsent(FRAME_FIELDS, COUNT_BEGINS));
        sample.fps = Math.round(v.totalFrames / ((now - since) / SECOND_MS));
        sample.framesDrawn = v.totalFrames;
        sample.jankyFrames = v.jankyFrames;
        sample.frozenFrames = v.frozenFrames;
        if (v.frames) sample.worstFrameMs = v.frames.worstMs;
      },
    ),
  ]);
  kept.app = app;
  return Object.keys(absent).length ? { ...sample, absent } : sample;
}

/**
 * A device's numbers by its own measures, for every kind that has them: one source, and no second parser. A kind with a
 * better way of its own, such as a phone's live service, gives a `liveMetrics` of its own instead.
 */
export function measuredLive(device: Pick<Device, 'measure' | 'foreground'>): LiveMetrics {
  return {
    async start(onSample, app) {
      let on = true;
      const kept: Kept = { turn: 0 };
      void (async () => {
        while (on) {
          const began = Date.now();
          const front = app ?? (await device.foreground().catch(() => undefined));
          const sample = front
            ? await sampleOf(device, front, kept)
            : { at: began, absent: allAbsent(LIVE_FIELDS, 'waiting for the app in front') };
          if (on) onSample(sample);
          await pause(Math.max(0, SECOND_MS - (Date.now() - began)));
        }
      })();
      return () => {
        on = false;
      };
    },
  };
}
