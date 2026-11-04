import type {
  DeviceState,
  InputEvent,
  Mirror,
  MirrorCheck,
  MirrorClock,
  MirrorSource,
  ViewerLink,
  ViewerMessage,
} from '../src/index.js';

/** A clock run by hand. */
export class FakeClock implements MirrorClock {
  private t = 1_000_000;
  private timers: { at: number; then: () => void }[] = [];

  now = () => this.t;

  after = (ms: number, then: () => void) => {
    const timer = { at: this.t + ms, then };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((x) => x !== timer);
    };
  };

  /** Moves on, running what comes due and what it set off. */
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      await flush();
      const next = this.timers
        .filter((x) => x.at <= end)
        .sort((a, b) => a.at - b.at)
        .shift();
      if (!next) break;
      this.timers = this.timers.filter((x) => x !== next);
      this.t = next.at;
      next.then();
    }
    this.t = end;
    await flush();
  }
}

export const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
};

/** A viewer that says what it is told to say, and keeps what it was sent. */
export class FakeViewer implements ViewerLink {
  sent: Record<string, unknown>[] = [];
  private listeners: ((m: ViewerMessage) => void)[] = [];
  private exits: ((tail: string) => void)[] = [];
  killed = false;

  send(message: Record<string, unknown>) {
    this.sent.push(message);
  }

  onMessage(l: (m: ViewerMessage) => void) {
    this.listeners.push(l);
  }

  onExit(l: (tail: string) => void) {
    this.exits.push(l);
  }

  kill() {
    this.killed = true;
  }

  say(op: string, rest: Record<string, unknown> = {}) {
    for (const l of this.listeners) l({ op, ...rest });
  }

  die(tail = '') {
    for (const l of this.exits) l(tail);
  }

  /** What it was sent with this op. */
  of(op: string) {
    return this.sent.filter((m) => m.op === op);
  }
}

/** A device's end, whose answers a test sets. */
export class FakeMirror implements Mirror {
  checkAnswer: MirrorCheck = { ok: true, routes: ['test'] };
  checks = 0;
  opens = 0;
  closes = 0;
  keyframes = 0;
  wakes = 0;
  openFails: Error | undefined;
  inputs: InputEvent[] = [];
  inputWait: Promise<void> | undefined;
  push: ((s: DeviceState) => void) | undefined;
  holdsThrough: DeviceState | undefined;
  noFirstFrame: Mirror['noFirstFrame'];
  source: MirrorSource = { kind: 'pixels', file: '/x', w: 1, h: 1 };
  tell: ((m: Record<string, unknown>) => void) | undefined;

  async check() {
    this.checks++;
    return this.checkAnswer;
  }

  async open(
    _o: unknown,
    _s: AbortSignal,
    tell: (m: Record<string, unknown>) => void,
  ): Promise<MirrorSource> {
    this.opens++;
    this.tell = tell;
    if (this.openFails) throw this.openFails;
    return this.source;
  }

  async keyframe() {
    this.keyframes++;
  }

  async wake() {
    this.wakes++;
  }

  async input(e: InputEvent) {
    this.inputs.push(e);
    await this.inputWait;
  }

  async close() {
    this.closes++;
  }

  watch(onChange: (s: DeviceState) => void) {
    this.push = onChange;
    return () => {
      this.push = undefined;
    };
  }
}
