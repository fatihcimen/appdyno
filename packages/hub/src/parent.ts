import { randomBytes } from 'node:crypto';
import {
  MirrorSession,
  startViewer,
  type MirrorOptions,
  type MirrorStatus,
  type ViewerStart,
  startOf,
} from '@appdyno/core';
import { windowControls, windowLook, type MovieEnd } from './controls.js';
import { windowFlow } from './flow.js';
import { followDevice } from './follow.js';
import { windowMeasures } from './measures.js';
import { pairWindows, type PairSide, type WindowPair } from './pair.js';
import { windowSends } from './window-sends.js';
import {
  answerWatches,
  FOCUS_SIGNAL,
  handoffDone,
  liveMirror,
  removeMirrorFile,
  type ServerContext,
  ToolError,
  writeMirrorFile,
} from '@appdyno/ops';

export type MirrorRun = {
  /** What the hub's sidebar calls a device, where it has one: the name its files and window go by. */
  nameOf?: (serial: string) => string | undefined;
  /** Named devices; none: the default device. */
  serials: string[];
  /** Every device, and with `watch` new ones as they come. */
  all?: boolean;
  watch?: boolean;
  /** At most this many windows, so that a rack of phones does not bury a Mac. */
  max: number;
  options: MirrorOptions;
  headless: boolean;
  /** A real window kept off every screen. */
  behind?: boolean;
  /** Where a device's window stands, when it is not a viewer of its own. */
  viewer?: (serial: string) => ViewerStart;
  /** Two devices side by side, a touch on either going to both. */
  pair?: boolean;
  noInput: boolean;
  seconds?: number;
  /** Ends the run when it settles, as its time being up would: a caller's own clock. */
  ends?: Promise<unknown>;
  /** A person asked for the keyboard with `--focus`. */
  focus: boolean;
  /** An agent opened this window: input waits for a person's click. */
  inputOnClick: boolean;
  /** From its first picture, this movie of what the stream sends. */
  record?: string;
  log: (line: string) => void;
};

const WATCH_MS = 2_000;

const describe = (serial: string, s: MirrorStatus) => {
  switch (s.state) {
    case 'waiting':
      return `${serial}: waiting ${s.need}`;
    case 'reconnecting':
      return `${serial}: reconnecting, try ${s.attempt}`;
    case 'stopped':
      return `${serial}: stopped: ${s.why}`;
    case 'live':
      return `${serial}: live${s.picture ? ` ${s.picture.w}x${s.picture.h} ${s.picture.codec}` : ''}`;
    default:
      return `${serial}: ${s.state}`;
  }
};

/** The mirrors of one invocation, each with its own viewer; one failing leaves the others alone. */
export class Parent {
  readonly sessions = new Map<string, MirrorSession>();
  readonly done = new Map<string, Promise<MirrorStatus>>();
  private readonly movies = new Map<string, Promise<(() => Promise<MovieEnd>) | undefined>>();
  private readonly sides: PairSide[] = [];
  private pair: WindowPair | undefined;
  /** What opens next stands beside what opened last. */
  pairing = false;
  stopping = false;
  failed = false;

  constructor(
    private readonly ctx: ServerContext,
    private readonly o: MirrorRun,
  ) {}

  async open(serial: string) {
    const running = liveMirror(serial);
    if (running) {
      // the second window of a device is its first one, brought forward
      if (running.pid !== process.pid) process.kill(running.pid, FOCUS_SIGNAL);
      throw new ToolError(
        `${serial} already has a window: pid ${running.pid}, which was brought forward`,
        'DEVICE_CLAIMED',
      );
    }
    const device = this.ctx.deviceFor(serial);
    if (this.o.options.wifi && !device.mirror.wifi) {
      throw new ToolError(
        `--wifi is for an iPhone: ${serial} is on the network already if its address says so`,
        'INVALID_ARGUMENT',
      );
    }
    const file = {
      pid: process.pid,
      started: startOf(process.pid),
      session: randomBytes(4).toString('hex'),
      serial,
    };
    let said = '';
    let live = false;
    const own = await device.hardware().catch(() => undefined);
    const named = this.o.nameOf?.(serial);
    const hardware = own && named ? { ...own, name: named } : own;
    const controls = windowControls(
      device,
      hardware,
      () => session,
      windowMeasures(this.ctx, device),
    );
    const flow = windowFlow(this.ctx, device, hardware, () => session, controls.measuring);
    const sends = windowSends(this.ctx, device, () => session);
    const session: MirrorSession = new MirrorSession({
      mirror: device.mirror,
      viewer: this.o.viewer?.(serial) ?? startViewer(this.o.headless, undefined, this.o.behind),
      look: {
        ...windowLook(hardware),
        ...((this.o.pair || this.pairing) && { pair: this.sides.length === 0 ? 'left' : 'right' }),
      },
      press: controls.press,
      takeInput: (e) => this.pair?.input(serial, e) ?? false,
      onWindow: (m) => {
        if (!this.pair?.control(m) && !flow.onWindow(m) && !sends.onWindow(m)) controls.onWindow(m);
      },
      onInput: flow.input,
      options: this.o.options,
      title: serial,
      noInput: this.o.noInput,
      focus: this.o.focus,
      inputOnClick: this.o.inputOnClick,
      onDone: (id) => handoffDone(serial, id),
      onChange: (status) => {
        if (this.o.record && status.state === 'live' && !this.movies.has(serial)) {
          this.o.log(`${serial}: recording to ${this.o.record}`);
          this.movies.set(
            serial,
            controls.movieTo(this.o.record).catch((e: unknown) => this.noMovie(serial, e)),
          );
        }
        // a stop is the end of its file; a status written after would look like a mirror
        if (status.state !== 'stopped') writeMirrorFile({ ...file, status });
        // what a window was told is gone with a viewer that came up again
        if (status.state === 'live' && !live) this.pair?.again(serial);
        live = status.state === 'live';
        const line = describe(serial, status);
        if (line !== said) this.o.log(line);
        said = line;
      },
    });
    this.sessions.set(serial, session);
    const watches = answerWatches(serial, session);
    const unfollow = followDevice(serial, session, () => {
      flow.follow();
      watches();
    });
    this.done.set(
      serial,
      session.stopped.then(async (status) => {
        unfollow();
        await flow.end();
        this.pair?.end(serial);
        this.pair = undefined;
        this.sides.length = 0;
        await controls.end();
        removeMirrorFile(serial);
        device.close();
        this.sessions.delete(serial);
        if (status.state === 'stopped' && !this.stopping && status.why !== WINDOW_CLOSED)
          this.failed = true;
        return status;
      }),
    );
    await session.start();
    if (!this.o.pair && !this.pairing) return;
    this.sides.push({
      serial,
      name: hardware?.name ?? hardware?.model ?? serial,
      read: controls.read,
      session,
      press: controls.press,
      journey: controls.journey,
    });
    const [one, other] = this.sides;
    if (one && other) {
      this.pair = pairWindows([one, other]);
      this.pair.begin();
    }
  }

  private noMovie(serial: string, e: unknown) {
    this.failed = true;
    this.o.log(`${serial}: no movie: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }

  private async endMovie(serial: string) {
    const stop = await this.movies.get(serial);
    const end = await stop?.().catch((e: unknown) => this.noMovie(serial, e));
    if (!end) return;
    if (!end.kept) this.failed = true;
    this.o.log(`${serial}: recorded ${end.what}${end.why ? `: ${end.why}` : ''}`);
  }

  /** One device's window, and all it holds, while the rest go on. */
  async close(serial: string, why: string) {
    await this.sessions.get(serial)?.stop(why);
    await this.done.get(serial);
  }

  /** Another process asked for a window that stands here. */
  raise = () => {
    for (const s of this.sessions.values()) s.raise();
  };

  async stopAll(why: string) {
    this.stopping = true;
    await Promise.all(
      [...this.sessions.entries()].map(async ([serial, s]) => {
        await this.endMovie(serial);
        await s.stop(why);
      }),
    );
  }
}

const WINDOW_CLOSED = 'the window was closed';

/** Runs the mirrors until their windows close, or the time asked for ends. The exit code. */
export async function runMirrors(ctx: ServerContext, o: MirrorRun): Promise<number> {
  const parent = new Parent(ctx, o);
  const onStop = () => void parent.stopAll('asked to stop');
  process.on('SIGINT', onStop);
  process.on('SIGTERM', onStop);
  process.on(FOCUS_SIGNAL, parent.raise);
  const refusals = new Map<string, string>();
  const open = (serial: string) =>
    parent.open(serial).catch((e: unknown) => {
      const why = e instanceof Error ? e.message : String(e);
      if (refusals.get(serial) !== why) o.log(`${serial}: ${why}`);
      refusals.set(serial, why);
    });
  const ready = async () =>
    (await ctx.devices()).filter((d) => d.ready && ctx.allowed(d.serial)).map((d) => d.serial);
  const serials = o.all
    ? await ready()
    : o.serials.length
      ? o.serials
      : [await ctx.defaultSerial()];
  if (serials.length === 0 && !o.watch) o.log('no device to mirror');
  for (const serial of serials.slice(0, o.max)) await open(serial);
  if (serials.length > o.max)
    o.log(`${serials.length - o.max} more devices left out: --max ${o.max}`);

  void o.ends?.then(() => parent.stopAll('time is up'));
  const timer = o.seconds
    ? setTimeout(() => void parent.stopAll('time is up'), o.seconds * 1000)
    : undefined;
  const watching = o.watch === true && o.all === true;
  // a device is new once: a window a person closed stays closed until its device has gone and come back
  const known = new Set(serials);
  const watcher = watching
    ? setInterval(() => {
        void ready()
          .then(async (now) => {
            for (const serial of known) if (!now.includes(serial)) known.delete(serial);
            for (const serial of now) {
              if (known.has(serial) || parent.sessions.has(serial)) continue;
              if (parent.sessions.size >= o.max || parent.stopping) break;
              known.add(serial);
              await open(serial);
            }
          })
          .catch(() => undefined);
      }, WATCH_MS)
    : undefined;
  try {
    // a watcher stays with no window, for the next device; anything else ends with its last one
    for (;;) {
      await Promise.all(parent.done.values());
      if (!watching || parent.stopping) break;
      await new Promise((r) => setTimeout(r, WATCH_MS));
    }
  } finally {
    clearTimeout(timer);
    clearInterval(watcher);
    process.off('SIGINT', onStop);
    process.off('SIGTERM', onStop);
    process.off(FOCUS_SIGNAL, parent.raise);
  }
  const nothingRan = serials.length === 0 ? !watching : refusals.size >= serials.length;
  return parent.failed || nothingRan ? 1 : 0;
}
