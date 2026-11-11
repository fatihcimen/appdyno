import { pause } from '../call.js';
import type { Device } from '../device.js';
import type { FrameStats } from '../frames.js';
import type { Measured } from '../measure.js';
import type { Capability } from '../measure-source.js';
import { LIVE_FIELDS, type LiveField, type LiveMetrics, type LiveSample } from './live-metrics.js';

/** The least time between two samples: a reader that takes longer sets the pace itself. */
const SECOND_MS = 1_000;
const CPU_WINDOW_MS = 500;
/** Memory moves slowly and its reader is the heaviest of them: read this often in seconds, and said as read until then. */
const MEMORY_EVERY = 5;

const NOT_EACH_SECOND = 'too slow to read each second here';
const NOT_ASKED = 'not read: each read costs the device';
const FRAME_FIELDS: LiveField[] = ['fps', 'jankyFrames', 'frozenFrames'];
const COUNT_BEGINS = 'counting begins';
const COUNTED_AGAIN = 'another measure began counting the frames again';

/** What a source keeps from turn to turn: which app, its frame counters when and as last read, and its memory. */
type Kept = {
  app?: string;
  since?: number;
  counted?: FrameStats;
  /** The newest frame read, on the device's clock: the next read's rows are those after it. */
  newestNs?: number;
  turn: number;
  memoryMb?: number;
};

/** Whatever is missing is missing for one reason, said once for each measure it takes away. */
const allAbsent = (fields: readonly LiveField[], why: string) =>
  Object.fromEntries(fields.map((f) => [f, why]));

/** One second of `app`, by the readers the device's measures already use: nothing here parses anything. */
async function sampleOf(
  device: Pick<Device, 'measure'>,
  app: string,
  kept: Kept,
  only?: readonly LiveField[],
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
    if (only && !fields.some((f) => only.includes(f)))
      return Object.assign(absent, allAbsent(fields, NOT_ASKED));
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
  // what is read only now and then has no turns to spare
  const memoryDue =
    !sameApp || kept.memoryMb === undefined || !!only || kept.turn % MEMORY_EVERY === 0;
  kept.turn += 1;
  if (!memoryDue && kept.memoryMb !== undefined) sample.memoryMb = kept.memoryMb;
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
      // the counters only grow here: a reset would cut the window a measure such as perf_scroll counts from its own
      () =>
        measure.frames(app, {
          reset: false,
          asItIs: true,
          ...(sameApp && kept.newestNs !== undefined && { after: kept.newestNs }),
        }),
      (v) => {
        const now = Date.now();
        const since = sameApp ? kept.since : undefined;
        const was = sameApp ? kept.counted : undefined;
        kept.since = now;
        kept.counted = v;
        kept.newestNs = v.frames?.newestNs ?? (sameApp ? kept.newestNs : undefined);
        // what was counted before the first read belongs to no second
        if (since === undefined || !was)
          return void Object.assign(absent, allAbsent(FRAME_FIELDS, COUNT_BEGINS));
        const drawn = v.totalFrames - was.totalFrames;
        const janky = v.jankyFrames - was.jankyFrames;
        const frozen = v.frozenFrames - was.frozenFrames;
        // a counter lower than before was reset in this second, and what came before that is lost to it
        if (drawn < 0 || janky < 0 || frozen < 0)
          return void Object.assign(absent, allAbsent(FRAME_FIELDS, COUNTED_AGAIN));
        // a Xiaomi's summary counts each frame twice and its janky ones once, where its rows since the last read are each once
        const count = v.frames?.count;
        const once = count && drawn >= 1.8 * count ? count : drawn;
        sample.fps = Math.round(once / ((now - since) / SECOND_MS));
        sample.framesDrawn = once;
        sample.jankyFrames = janky;
        sample.frozenFrames = frozen;
        if (v.frames) sample.worstFrameMs = v.frames.worstMs;
      },
    ),
  ]);
  kept.app = app;
  return Object.keys(absent).length ? { ...sample, absent } : sample;
}

/**
 * A device's numbers by its own measures, for every kind that has them: one source, and no second parser. A kind with a
 * better way of its own, such as a phone's live service, gives a `liveMetrics` of its own instead. `only`: what has to
 * be read, and how seldom, for one that runs all day and pays for each.
 */
export function measuredLive(
  device: Pick<Device, 'measure' | 'foreground'>,
  only?: readonly LiveField[],
  everyMs = SECOND_MS,
): LiveMetrics {
  return {
    start(onSample, app) {
      // set by the stop below, which the compiler does not follow into the loop
      let on = true as boolean;
      const kept: Kept = { turn: 0 };
      const running = (async () => {
        while (on) {
          const began = Date.now();
          // a read that failed says nothing of what is in front: the app last named is read on, and its figures stay
          const front = app ?? (await device.foreground().catch(() => kept.app));
          const sample = front
            ? await sampleOf(device, front, kept, only)
            : { at: began, absent: allAbsent(LIVE_FIELDS, 'waiting for the app in front') };
          // the stop may have come while it read, which the compiler does not follow
          if (on as boolean) onSample(sample);
          await pause(Math.max(0, everyMs - (Date.now() - began)));
        }
      })();
      return Promise.resolve(() => {
        on = false;
        return running;
      });
    },
  };
}
