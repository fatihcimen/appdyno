import { randomBytes } from 'node:crypto';
import {
  MirrorSession,
  startViewer,
  type MirrorOptions,
  type MirrorStatus,
  startOf,
} from '@appdyno/core';
import type { ServerContext } from '../context.js';
import { ToolError } from '../tool.js';
import { windowControls, windowLook } from './controls.js';
import { windowFlow } from './flow.js';
import { followDevice } from './follow.js';
import { handoffDone } from './handoff.js';
import { windowMeasures } from './measures.js';
import { pairWindows, type PairSide, type WindowPair } from './pair.js';
import { FOCUS_SIGNAL, liveMirror, removeMirrorFile, writeMirrorFile } from './state.js';

export type MirrorRun = {
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
  private readonly recording = new Map<string, string>();
  private readonly sides: PairSide[] = [];
  private pair: WindowPair | undefined;
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
    const file = {
      pid: process.pid,
      started: startOf(process.pid),
      session: randomBytes(4).toString('hex'),
      serial,
    };
    let said = '';
    let live = false;
    const hardware = await device.hardware().catch(() => undefined);
    const controls = windowControls(
      device,
      hardware,
      () => session,
      windowMeasures(this.ctx, device),
    );
    const flow = windowFlow(this.ctx, device, hardware, () => session, controls.measuring);
    const session: MirrorSession = new MirrorSession({
      mirror: device.mirror,
      viewer: startViewer(this.o.headless, undefined, this.o.behind),
      look: {
        ...windowLook(hardware),
        ...(this.o.pair && { pair: this.sides.length === 0 ? 'left' : 'right' }),
      },
      press: controls.press,
      takeInput: (e) => this.pair?.input(serial, e) ?? false,
      onWindow: (m) => {
        if (!this.pair?.control(m) && !flow.onWindow(m)) controls.onWindow(m);
      },
      onInput: flow.input,
      options: this.o.options,
      title: serial,
      noInput: this.o.noInput,
      focus: this.o.focus,
      inputOnClick: this.o.inputOnClick,
      onDone: (id) => handoffDone(serial, id),
      onChange: (status) => {
        if (this.o.record && status.state === 'live' && !this.recording.has(serial)) {
          this.recording.set(serial, this.o.record);
          session.recording.start(this.o.record);
          this.o.log(`${serial}: recording to ${this.o.record}`);
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
    const unfollow = followDevice(serial, session, flow.follow);
    this.done.set(
      serial,
      session.stopped.then(async (status) => {
        unfollow();
        await flow.end();
        this.pair?.end(serial);
        this.pair = undefined;
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
    if (!this.o.pair) return;
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

  async stopAll(why: string) {
    this.stopping = true;
    await Promise.all(
      [...this.sessions.entries()].map(async ([serial, s]) => {
        if (this.recording.has(serial)) {
          const r = await s.recording.stop();
          this.o.log(
            `${serial}: recorded ${r.frames} frames${r.seconds ? ` in ${r.seconds.toFixed(1)} s` : ''}${r.why ? `: ${r.why}` : ''}`,
          );
        }
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
  const onFocus = () => {
    for (const s of parent.sessions.values()) s.raise();
  };
  process.on('SIGINT', onStop);
  process.on('SIGTERM', onStop);
  process.on(FOCUS_SIGNAL, onFocus);
  const refusals = new Map<string, string>();
  const open = (serial: string) =>
    parent.open(serial).catch((e: Error) => {
      if (refusals.get(serial) !== e.message) o.log(`${serial}: ${e.message}`);
      refusals.set(serial, e.message);
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
    process.off(FOCUS_SIGNAL, onFocus);
  }
  const nothingRan = serials.length === 0 ? !watching : refusals.size >= serials.length;
  return parent.failed || nothingRan ? 1 : 0;
}
