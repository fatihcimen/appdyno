import { mkdirSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FROZEN_FRAME_MS,
  measuredLive,
  measureClock,
  safeName,
  sleep,
  stateDir,
  tracesDir,
  type ClockReading,
  type FrameMarks,
  type LiveField,
  type LiveSample,
} from '@appdyno/core';
import type { ServerContext } from '../context.js';
import { filming } from '../record.js';
import type { Session } from '../session.js';
import { ToolError } from '../tool.js';
import { stallsIn } from './gather.js';
import { VideoRing } from './ring.js';
import { recordFrames, writePage, type FrameRecording } from './sources.js';

export const DEFAULT_FLIGHT_SECONDS = 30;
export const MAX_FLIGHT_SECONDS = 120;
/** A look queues behind what the device is doing: 22 s apart on a loaded emulator, and what it keeps has to outlast that. */
export const MIN_FLIGHT_SECONDS = 20;
/** What is read: what says a stall and what is worth keeping. A stream's numbers are read as they come. */
const WATCHED: readonly LiveField[] = ['fps', 'memoryMb'];
/**
 * How often it looks. Each look cost a Xiaomi about 5 points of its CPU at once a second, and nothing is lost by looking
 * less: the ring holds the moment, a frozen frame stays counted until it is read, and a log and a crash report stay.
 */
const LOOK_MS = 5_000;
/** A trace that outlives this process ends by itself by then, and one is started before that, so none has a hole. */
const FRAMES_SECONDS = 600;
const FRAMES_RENEWED_MS = 480_000;
/** What comes after a stall is part of it: the screen coming back. */
const AFTER_MS = 2_000;
const CRASH_WAIT_MS = 4_000;
const POLL_MS = 500;
/** Each is a few MB, and a stall that repeats is one to look at. */
const MAX_SAVES = 20;

/** A stretch no one kept leaves nothing of its trace on this Mac. */
const dropTrace = async (marks: FrameMarks | { why: string }) => {
  if ('tracePath' in marks && marks.tracePath) await rm(marks.tracePath, { force: true });
};

const flightFolder = (serial: string) => join(stateDir(), 'flight', safeName(serial));

/** What a dead process left of a ring on this Mac. */
export const dropFlightFolder = (serial: string) =>
  rmSync(flightFolder(serial), { recursive: true, force: true });

export type RunningFlight = {
  seconds: number;
  saved: string[];
  /** Keeps what it holds now, as a stall would. */
  save(): Promise<string | undefined>;
  /** Ends every source and leaves nothing of what was held. */
  stop(): Promise<void>;
};

type Armed = {
  frames: FrameRecording;
  ring: VideoRing | undefined;
  noVideo: string | undefined;
  endLive: () => void;
  timers: NodeJS.Timeout[];
  /** The next trace coming up, which only then replaces `frames`. */
  renewing: Promise<unknown>;
  first: ClockReading;
  /** When it began to watch, on the device's clock. */
  since: number;
  /** When it last looked, on this Mac. */
  lookedAt: number;
  pid: string | undefined;
  samples: LiveSample[];
};

/** Whether a second's reading says the screen stood still, in words for a person. */
const stallOf = (s: LiveSample) => {
  const worst = s.worstFrameMs ?? 0;
  return worst >= FROZEN_FRAME_MS
    ? `a stall of ${Math.round(worst)} ms`
    : (s.frozenFrames ?? 0) > 0
      ? 'a frozen frame'
      : undefined;
};

/**
 * A timeline with no end: it holds the last `seconds` of a device and keeps them when the app crashes or stalls, by the
 * signals the measures read. Opt-in: nothing of it runs until a person asks, and it ends with its session. Its video
 * goes round in segments on this Mac, its frames in the device's own ring, and each ends by itself if this process dies.
 */
export async function startFlight(
  ctx: ServerContext,
  s: Session,
  app: string,
  seconds: number,
  dir: string | undefined,
): Promise<RunningFlight> {
  const { device } = s;
  const { serial, recorder, measure } = device;
  const running = filming.read(serial);
  if (running)
    throw new ToolError(
      `a recording has run on ${serial} since ${running.since}: stop it first, as the flight recorder makes its own`,
      'INVALID_ARGUMENT',
    );
  if (!(await device.appRunning(app)))
    throw new ToolError(`${app} is not running: launch it first`, 'APP_NOT_RUNNING');
  const folder = flightFolder(serial);
  const clear = () => {
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true, mode: 0o700 });
  };
  clear();
  const to = dir ?? tracesDir();
  mkdirSync(to, { recursive: true });
  const segmentSeconds = Math.ceil(seconds / 2);
  const saved: string[] = [];
  let armed: Armed | undefined;
  let busy = false;
  /** What holds the sources now: a stop that came in the middle of a save would find nothing armed, and leave it all on. */
  let working: Promise<unknown> = Promise.resolve();
  let over = false;
  let lastSave = 0;
  let logsReadTo = 0;

  /** The ring's trace is about to end: the next one is up before it does, and what disarms waits for that. */
  const renewFrames = (a: Armed) => {
    const old = a.frames;
    const renewing = recordFrames(device, app, FRAMES_SECONDS, seconds).then(async (next) => {
      a.frames = next;
      await dropTrace(await old.finish());
    });
    a.renewing = renewing.catch(() => undefined);
    return renewing;
  };

  const arm = async (): Promise<Armed> => {
    const first = await measureClock(() => device.wallClock());
    if (measure.framesByProbe) await measure.attachProbe(app);
    const frames = await recordFrames(device, app, FRAMES_SECONDS, seconds);
    let noVideo = recorder.oneAtATime
      ? 'this device gives one recording at a time, so no ring of them is kept'
      : undefined;
    let ring: VideoRing | undefined;
    if (!recorder.oneAtATime) {
      ring = new VideoRing(recorder, folder, segmentSeconds, first.offsetMs);
      ring.onHandle = (handle, file) =>
        filming.write(serial, { handle, since: new Date().toISOString(), file, owner: s.owner });
      await ring.rotate().catch((e: unknown) => {
        noVideo = e instanceof Error ? e.message : String(e);
        ring = undefined;
      });
    }
    const a: Armed = {
      frames,
      ring,
      noVideo,
      first,
      since: Date.now() + first.offsetMs,
      lookedAt: 0,
      endLive: () => undefined,
      timers: [],
      renewing: Promise.resolve(),
      pid: undefined,
      samples: [],
    };
    armed = a;
    try {
      a.pid = await device.appPid?.(app);
      a.timers.push(
        setInterval(() => void renewFrames(a).catch(() => undefined), FRAMES_RENEWED_MS),
      );
      const turning = ring;
      if (turning)
        a.timers.push(
          setInterval(() => void turning.rotate().catch(() => undefined), segmentSeconds * 1_000),
        );
      logsReadTo = Date.now() + first.offsetMs;
      a.endLive = await (device.liveMetrics ?? measuredLive(device, WATCHED, LOOK_MS)).start(
        (sample) => void watch(a, sample),
        app,
      );
      return a;
    } catch (e) {
      // a flight that did not start has no stop: what is up by now would turn for ever
      await disarm(undefined);
      throw e;
    }
  };

  /** Ends what is armed, and writes a page of it if there is a reason to. */
  const disarm = async (why: string | undefined) => {
    const a = armed;
    if (!a) return undefined;
    armed = undefined;
    a.timers.forEach(clearInterval);
    a.endLive();
    const end = Date.now() + a.first.offsetMs;
    await a.renewing;
    const marks = await a.frames.finish();
    if (!why) {
      await dropTrace(marks);
      await a.ring?.drop();
      filming.remove(serial);
      return undefined;
    }
    const video = await a.ring?.seal(join(folder, `whole.${recorder.extension}`));
    filming.remove(serial);
    const last = await measureClock(() => device.wallClock()).catch(() => a.first);
    const stamp = new Date().toISOString().replace(/\W/g, '');
    const page = await writePage(ctx, s, {
      app,
      ...(a.pid && { pid: a.pid }),
      reason: why,
      // no further back than it was watching: what came before that is not what it saw
      from: Math.max(end - seconds * 1_000, a.since),
      to: end,
      clocks: { first: a.first, last },
      frames: marks,
      ...(video && { video }),
      ...(!video && { noVideo: a.noVideo ?? 'the screen could not be kept' }),
      samples: a.samples,
      steps: folder,
      dir: to,
      name: `${safeName(app)}-flight-${stamp}.timeline.html`,
      ...(video && { videoFile: video.file }),
    });
    clear();
    saved.push(page.file);
    lastSave = Date.now();
    return page.file;
  };

  /** One at a time, whoever asks: what holds `busy` has the sources in its hands. */
  const alone = async <T>(work: () => Promise<T>) => {
    if (busy || over) return undefined;
    busy = true;
    const running = work();
    working = running.catch(() => undefined);
    try {
      return await running;
    } finally {
      busy = false;
    }
  };

  const keep = async (why: string) => {
    try {
      return await disarm(why);
    } finally {
      if (!over) await arm();
    }
  };

  /** What its log says of a stop no frame shows, since the last time it looked. */
  const stallInLog = async (a: Armed) => {
    if (!measure.logTellsStalls) return undefined;
    const since = logsReadTo;
    logsReadTo = Date.now() + a.first.offsetMs;
    const logs = await device
      .logs({ app, level: 'info', since, maxLines: 200, timed: true, ...(a.pid && { pid: a.pid }) })
      .catch(() => undefined);
    const stopped = logs && stallsIn(logs, []).some((x) => x.ms >= FROZEN_FRAME_MS);
    return stopped ? 'a stall of its main thread' : undefined;
  };

  /** A process gone with a report of why is a crash: one a person closed has none, and nothing is kept. */
  const crashOf = async (since: number) => {
    const end = Date.now() + CRASH_WAIT_MS;
    for (;;) {
      const c = await device.crashes({ app, since, limit: 1 }).catch(() => undefined);
      if (c?.reports[0]) return c.reports[0].reason;
      if (Date.now() >= end) return undefined;
      await sleep(POLL_MS);
    }
  };

  /** After a crash it waits for the app, at no cost but a look each second. */
  const comeBack = async () => {
    while (!over && !(await device.appRunning(app).catch(() => false))) await sleep(POLL_MS * 2);
    if (!over) await arm();
  };

  /** By its process where a device has that to say: Android restarts a crashed app within the second, and it runs. */
  const stillThere = async (a: Armed) =>
    device.appPid ? (await device.appPid(app)) === a.pid : device.appRunning(app);

  const watch = async (a: Armed, sample: LiveSample) => {
    a.samples.push(sample);
    while (a.samples.length > seconds + 2) a.samples.shift();
    // a stream's numbers come each second whatever is asked: what they cost to look at is ours to spare
    if (Date.now() - a.lookedAt < LOOK_MS && !stallOf(sample)) return;
    a.lookedAt = Date.now();
    await alone(async () => {
      if (a !== armed) return;
      if (!(await stillThere(a))) {
        const crash = await crashOf(Date.now() + a.first.offsetMs - (seconds + 5) * 1_000);
        await disarm(crash && `a crash: ${crash}`);
        await comeBack();
        return;
      }
      if (saved.length >= MAX_SAVES || Date.now() - lastSave < seconds * 1_000) return;
      const stall = stallOf(sample) ?? (await stallInLog(a));
      if (!stall) return;
      await sleep(AFTER_MS);
      await keep(stall);
    }).catch(() => undefined); // what a person turned on goes on: a save that failed loses that one
  };

  await arm();
  return {
    seconds,
    saved,
    save: () => alone(() => keep('a person asked')).then((page) => page ?? undefined),
    stop: async () => {
      over = true;
      await working;
      await disarm(undefined);
      rmSync(folder, { recursive: true, force: true });
    },
  };
}
