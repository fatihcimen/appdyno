import { inputOf, InputQueue } from './input-queue.js';
import { NEEDS, NeedError, type Need } from './need.js';
import type { DeviceState, InputEvent, Mirror, MirrorOptions } from './port.js';
import {
  realClock,
  wordsOf,
  type MirrorClock,
  type MirrorState,
  type MirrorStats,
  type MirrorStatus,
} from './state.js';
import type { ViewerLink, ViewerMessage, ViewerStart } from './viewer.js';

const WAITING_POLL_MS = 1_000;
/** A viewer that goes on dying is not started a third time. */
const DEATHS_WINDOW_MS = 60_000;
const MAX_DEATHS = 2;
/** Failures to open on a device that says it is there, before the session gives up. */
const MAX_ATTEMPTS = 10;
const BACKOFF_FIRST_MS = 200;
const BACKOFF_MAX_MS = 5_000;
const NO_FIRST_FRAME_MS = 15_000;
const DECODER_FAILURES = 3;
const QUIT_MS = 5_000;

export type MirrorSessionOptions = {
  mirror: Mirror;
  viewer: ViewerStart;
  options: MirrorOptions;
  title: string;
  /** The person's input is not passed on, and the viewer sends none. */
  noInput?: boolean;
  /** Bring the window to the front when it opens: a person asked for it, and no agent's call may do that. */
  activate?: boolean;
  clock?: MirrorClock;
  onChange?: (s: MirrorStatus) => void;
  /** A person answered a banner. */
  onDone?: (id: string) => void;
};

/**
 * One device's mirror: its states, retries, stats and input, written once. What a kind of device does is
 * behind `Mirror`, and what a window does is behind the viewer's messages.
 */
export class MirrorSession {
  private readonly clock: MirrorClock;
  private current: MirrorState = { state: 'connecting' };
  private since: number;
  private viewer: ViewerLink | undefined;
  /** Stands for what is being connected: a later one makes what an earlier one awaits worthless. */
  private run = 0;
  private cancelTimer: (() => void) | undefined;
  private abort = new AbortController();
  private attempt = 0;
  private deaths: number[] = [];
  private renewed = false;
  private zoom: number | undefined;
  private stats: MirrorStats | undefined;
  private picture: { w: number; h: number; codec: string } | undefined;
  private touchedAt: number | undefined;
  private note: string | undefined;
  private readonly input: InputQueue;
  private unwatch: (() => void) | undefined;
  private closedByPerson = false;
  private refusedNeed: Need | undefined;
  private asleep = false;
  private readonly marks: ((ms: number) => void)[] = [];
  private finish!: (s: MirrorStatus) => void;
  /** Resolved when the session has stopped, with why. */
  readonly stopped = new Promise<MirrorStatus>((r) => (this.finish = r));

  constructor(private readonly o: MirrorSessionOptions) {
    this.clock = o.clock ?? realClock;
    this.since = this.clock.now();
    this.input = new InputQueue((e) => o.mirror.input(e));
  }

  get status(): MirrorStatus {
    return {
      ...this.current,
      since: this.since,
      ...(this.picture && { picture: this.picture }),
      ...(this.stats && { stats: this.stats }),
      ...(this.note && { note: this.note }),
      ...(this.touchedAt && { touchedAt: this.touchedAt }),
      inputDropped: this.input.dropped,
      inputFailed: this.input.failed,
    };
  }

  private set(next: MirrorState) {
    this.current = next;
    this.since = this.clock.now();
    this.tellViewerState();
    this.o.onChange?.(this.status);
  }

  private tellViewerState() {
    this.viewer?.send({ op: 'status', state: this.current.state, ...wordsOf(this.current) });
  }

  async start() {
    this.unwatch = this.o.mirror.watch((s) => this.onDevice(s));
    await this.openViewer();
    if (this.current.state !== 'stopped') void this.connect();
  }

  /** Ends it all: the stream, then the viewer. Safe twice. */
  async stop(why: string, need?: Need) {
    if (this.current.state === 'stopped') return;
    this.run++;
    this.cancelTimer?.();
    this.abort.abort();
    this.unwatch?.();
    this.set({ state: 'stopped', why, ...(need && { need }) });
    await this.o.mirror.close().catch(() => undefined);
    const v = this.viewer;
    this.viewer = undefined;
    v?.send({ op: 'quit' });
    // a viewer wedged in a framework hears no quit; one that heard it holds nothing up
    if (v) v.onExit(this.clock.after(QUIT_MS, () => v.kill()));
    this.finish(this.status);
  }

  focus() {
    this.viewer?.send({ op: 'focus' });
  }

  /** A word for the window itself: the mark of an agent, a banner, a line of activity. */
  tell(message: Record<string, unknown>) {
    this.viewer?.send(message);
  }

  /** The time from now to the next frame to arrive; for the bench, around an input. */
  mark(): Promise<number> {
    this.viewer?.send({ op: 'mark' });
    return new Promise((r) => this.marks.push(r));
  }

  /** The same way a person's touch goes. */
  send(e: InputEvent) {
    this.input.add(e);
  }

  /** A click posted to the window itself, by its own event queue: what a mouse does, for an acceptance run. */
  poke(x: number, y: number) {
    this.viewer?.send({ op: 'poke', x, y });
  }

  private async openViewer() {
    try {
      const v = await this.o.viewer();
      this.viewer = v;
      v.onMessage((m) => {
        if (v === this.viewer) this.onViewer(m);
      });
      v.onExit((tail) => {
        if (v === this.viewer) void this.onViewerExit(tail);
      });
    } catch (e) {
      await this.stop((e as Error).message, e instanceof NeedError ? e.need : undefined);
    }
  }

  private schedule(ms: number, then: () => void) {
    this.cancelTimer?.();
    this.cancelTimer = this.clock.after(ms, then);
  }

  private async connect() {
    const run = ++this.run;
    const stale = () => run !== this.run;
    this.cancelTimer?.();
    if (this.current.state !== 'reconnecting') this.set({ state: 'connecting' });
    let check;
    try {
      check = await this.o.mirror.check();
    } catch (e) {
      if (!stale()) this.onCheckFailed(e);
      return;
    }
    if (stale()) return;
    if (!check.ok) {
      this.waitFor(check.need);
      return;
    }
    this.abort = new AbortController();
    try {
      const source = await this.o.mirror.open(this.o.options, this.abort.signal, (m) =>
        this.viewer?.send(m),
      );
      if (stale()) return;
      this.note = source.kind === 'adb' ? source.note : undefined;
      this.viewer?.send({
        op: 'attach',
        source,
        title: this.o.title,
        input: !this.o.noInput,
        activate: this.o.activate ?? false,
        ...(this.zoom && { zoom: this.zoom }),
      });
      this.armFirstFrame(run);
    } catch (e) {
      if (!stale()) this.onCheckFailed(e);
    }
  }

  /** A device's refusal: what a person can clear is waited out, what none can stops it, the rest is tried again. */
  private onCheckFailed(e: unknown) {
    const why = (e as Error).message;
    if (e instanceof NeedError) this.waitFor(e.need);
    else if ((e as { fatal?: boolean }).fatal) void this.stop(why);
    else this.reconnect(why);
  }

  private armFirstFrame(run: number) {
    const noFirst = this.o.mirror.noFirstFrame;
    this.schedule(noFirst?.ms ?? NO_FIRST_FRAME_MS, () => {
      if (run !== this.run) return;
      // still attached: a picture that comes after all makes it live
      if (noFirst) this.set({ state: 'waiting', need: noFirst.need });
      else this.renew('no picture came');
    });
  }

  /** Stops and asks again with `check` each second, until it says the way is clear. */
  private waitFor(need: Need) {
    this.run++;
    this.cancelTimer?.();
    if (this.current.state !== 'waiting' || this.current.need !== need)
      this.set({ state: 'waiting', need });
    const run = this.run;
    this.schedule(WAITING_POLL_MS, () => {
      void this.o.mirror.check().then(
        (c) => {
          if (run !== this.run) return;
          if (c.ok) void this.connect();
          else this.waitFor(c.need);
        },
        (e: unknown) => {
          if (run !== this.run) return;
          if ((e as { fatal?: boolean }).fatal) void this.stop((e as Error).message);
          else this.waitFor(need);
        },
      );
    });
  }

  private reconnect(why: string) {
    if (this.current.state === 'stopped') return;
    this.run++;
    this.attempt++;
    if (this.attempt > MAX_ATTEMPTS) {
      void this.stop(`no picture after ${MAX_ATTEMPTS} tries: ${why}`);
      return;
    }
    this.set({ state: 'reconnecting', attempt: this.attempt });
    const backoff = Math.min(BACKOFF_FIRST_MS * 2 ** (this.attempt - 1), BACKOFF_MAX_MS);
    this.schedule(backoff, () => void this.connect());
  }

  /** The stream is ended on both sides, and a new one is asked for. */
  private renew(why: string) {
    this.viewer?.send({ op: 'detach' });
    void this.o.mirror
      .close()
      .catch(() => undefined)
      .then(() => this.reconnect(why));
  }

  private onViewer(m: ViewerMessage) {
    switch (m.op) {
      case 'first':
        this.onFirst(m);
        break;
      case 'stats':
        this.stats = m as MirrorStats;
        if (Number(m.decoded) > 0) this.renewed = false;
        this.o.onChange?.(this.status);
        break;
      case 'lost':
        this.onLost(String(m.why), m.fatal === true);
        break;
      case 'needKey':
        this.onNeedKey(Number(m.consecutive ?? 0));
        break;
      case 'touch':
      case 'key':
      case 'text':
      case 'button':
        this.onInput(inputOf(m));
        break;
      case 'zoom':
        this.zoom = Number(m.scale);
        break;
      case 'done':
        this.o.onDone?.(String(m.id));
        break;
      case 'marked':
        for (const r of this.marks.splice(0)) r(Number(m.ms));
        break;
      case 'closed':
        this.closedByPerson = true;
        break;
      case 'refused':
        this.refusedNeed = m.need as Need;
        break;
      case 'sleep':
        this.onMacSleep();
        break;
      case 'wake':
        this.onMacWake();
        break;
    }
  }

  private onFirst(m: ViewerMessage) {
    this.picture = { w: Number(m.w), h: Number(m.h), codec: String(m.codec) };
    this.cancelTimer?.();
    this.attempt = 0;
    if (this.current.state !== 'live') this.set({ state: 'live' });
    else this.o.onChange?.(this.status);
  }

  private onInput(e: InputEvent) {
    this.touchedAt = this.clock.now();
    if (!this.o.noInput && this.current.state === 'live') this.input.add(e);
    else this.input.dropped++;
  }

  private onLost(why: string, fatal: boolean) {
    if (this.current.state === 'stopped') return;
    this.run++;
    this.cancelTimer?.();
    // said at once: what comes next may be an agent's whole start
    if (!fatal) this.set({ state: 'reconnecting', attempt: this.attempt + 1 });
    void this.o.mirror
      .close()
      .catch(() => undefined)
      .then(() => {
        if (fatal) void this.stop(why);
        else if (this.current.state !== 'stopped') this.afterLoss(why);
      });
  }

  /** Lost, and the device may say why: gone, off, asleep. */
  private afterLoss(why: string) {
    const run = ++this.run;
    void this.o.mirror.check().then(
      (c) => {
        if (run !== this.run) return;
        if (c.ok) this.reconnect(why);
        else this.waitFor(c.need);
      },
      (e: unknown) => {
        if (run === this.run) this.onCheckFailed(e);
      },
    );
  }

  private onNeedKey(consecutive: number) {
    void this.o.mirror.keyframe().catch(() => undefined);
    if (consecutive < DECODER_FAILURES) return;
    if (this.renewed) {
      void this.stop(`the decoder failed ${DECODER_FAILURES} times in a row, twice`);
      return;
    }
    this.renewed = true;
    this.renew('the decoder failed');
  }

  private async onViewerExit(tail: string) {
    const v = this.viewer;
    this.viewer = undefined;
    v?.kill();
    if (this.current.state === 'stopped') return;
    if (this.closedByPerson) {
      await this.stop('the window was closed');
      return;
    }
    if (this.refusedNeed) {
      await this.stop(NEEDS[this.refusedNeed].title, this.refusedNeed);
      return;
    }
    const now = this.clock.now();
    this.deaths = [...this.deaths.filter((t) => now - t < DEATHS_WINDOW_MS), now];
    if (this.deaths.length >= MAX_DEATHS) {
      await this.stop(
        `the viewer died twice in a minute: ${tail.slice(-400) || 'it said nothing'}`,
      );
      return;
    }
    // its connection ended with it, so the far end is made ready again
    this.run++;
    this.cancelTimer?.();
    await this.o.mirror.close().catch(() => undefined);
    await this.openViewer();
    if (this.viewer) void this.connect();
  }

  private onMacSleep() {
    this.asleep = true;
    this.run++;
    this.cancelTimer?.();
    this.viewer?.send({ op: 'detach' });
    void this.o.mirror.close().catch(() => undefined);
  }

  private onMacWake() {
    if (!this.asleep) return;
    this.asleep = false;
    void this.connect();
  }

  private onDevice(s: DeviceState) {
    const state = this.current.state;
    if (state === 'stopped' || this.asleep) return;
    if (s === 'ok') {
      if (state === 'waiting') void this.connect();
      return;
    }
    if (state === 'waiting' && this.current.state === 'waiting' && this.current.need === s) return;
    this.viewer?.send({ op: 'detach' });
    void this.o.mirror.close().catch(() => undefined);
    this.waitFor(s);
  }
}
