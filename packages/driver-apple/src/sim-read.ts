import { must, pause } from '@appdyno/core';
import { DeviceError, type Tree } from '@appdyno/protocol';
import { HOME_SCREEN_APP } from './platform-screen.js';
import type { DirectSim } from './simdirect.js';
import { type Capture, nodesBusy } from './simsettle.js';
import {
  type CopiesVerdict,
  copiesId,
  copiesStale,
  copiesVerdict,
  coverKey,
  repeatedControls,
} from './simcopies.js';
import { learnCopies, withoutCopies } from './simtree.js';

/** A first boot has nothing in front for a few seconds: this is shorter than a runner's start. */
const FIRST_FRONT_MS = 10_000;
const FRONT_AGAIN_MS = 250;

/** What the helper's reads take of the simulator, each asked as it is needed. */
export type ReadsPort = {
  direct: DirectSim;
  /** The app named, if any. */
  app: () => string | undefined;
  runnerUp: () => boolean;
  runnerStarting: () => boolean;
  /** The runner's own read. */
  runner: () => Promise<Tree>;
};

/** Keeps the 64 used last. */
function keep<V>(kept: Map<string, V>, key: string, value: V) {
  kept.delete(key);
  kept.set(key, value);
  if (kept.size > 64) kept.delete(must(kept.keys().next().value, 'a key'));
}

/** The helper's reads of the app in front, and what the runner said of each repeated control's copies. */
export class HelperReads {
  /** By `copiesId`. */
  private readonly verdicts = new Map<string, CopiesVerdict>();
  /** The layouts with no copies that the runner has read alike. */
  private readonly alike = new Map<string, true>();

  constructor(private readonly p: ReadsPort) {}

  /** The runner's own read, by which it places its next touch. */
  runner() {
    return this.p.runner();
  }

  /**
   * The named app, else what is in front: a new simulator's home screen needs no runner to be read. While the helper
   * cannot say what that is the home screen is asked for, which it refuses if an app is up after all.
   */
  async front() {
    const { direct } = this.p;
    const end = Date.now() + FIRST_FRONT_MS;
    for (;;) {
      const named = this.p.app();
      const app = named ?? (await direct.front().catch(() => undefined)) ?? HOME_SCREEN_APP;
      const r = await direct.read(app).catch(() => ({ refused: 'failed' }));
      const waiting = 'refused' in r && r.refused === 'no-foreground';
      if (!waiting || this.p.app() || this.p.runnerUp() || Date.now() >= end) return r;
      await pause(FRONT_AGAIN_MS);
    }
  }

  /**
   * The helper's read of the app in front, when it can say what the runner would; for one in the queue.
   * `final`: this read is an answer, not one of a settle's looks. Only XCUI tells which copy of a control a
   * tap reaches, so repeated controls are believed once the runner has read them, and that verdict is kept as the
   * runner keeps its own: by the control, for as long as its copies stand where they did, and while they move
   * (`copiesStale`). Any other layout needs no runner, and is checked once one is up.
   */
  async read(final: boolean): Promise<Capture | undefined> {
    const r = await this.front();
    if ('refused' in r) return undefined;
    // with a runner up it reads the widget too: this read is less, and no misread to hold against the helper
    if (r.partial && this.p.runnerUp()) return undefined;
    const { nodes } = r.tree;
    const groups = repeatedControls(nodes);
    const places = (g: number[]) => g.map((i) => must(nodes[i], 'a node').b);
    const at = Date.now();
    // kept by what can change it: under a banner that turns, and of a carousel whose slides carry one id, every
    // final read went to the runner
    const hidden = new Set<number>();
    let known = groups.length > 0 || this.alike.has(r.tree.hash);
    for (const g of groups) {
      const v = this.verdicts.get(copiesId(nodes, g));
      const out = (v?.hidden ?? []).map((i) => must(g[i], 'a copy'));
      if (!v || copiesStale(v, places(g), coverKey(nodes, out), at)) known = false;
      for (const i of out) hidden.add(i);
    }
    if (known) return { tree: withoutCopies(r.tree, hidden), busy: r.busy };
    // while the runner starts, copies are answered as the helper finds them, all of them, rather than after its seconds
    if (!this.p.runnerUp() && (!r.copies || this.p.runnerStarting()))
      return { tree: r.tree, busy: r.busy };
    if (!final) return { tree: r.tree, busy: r.busy, askRunner: true };
    const runner = await this.p.runner();
    const verdict = learnCopies(r.tree, runner);
    // a runner that ran out of time before it asked of every copy is asked again
    const whole = verdict && !runner.truncated;
    // of the copies it is believed where the reads differ too, as two of a screen that moves do, a moment apart
    if (whole)
      for (const g of groups) {
        const out = g.filter((i) => verdict.has(i));
        const order = out.map((i) => g.indexOf(i));
        keep(
          this.verdicts,
          copiesId(nodes, g),
          copiesVerdict(places(g), order, coverKey(nodes, out), at),
        );
      }
    if (!verdict || !this.p.direct.checkRead(withoutCopies(r.tree, verdict), runner))
      return { tree: runner, busy: nodesBusy(runner), byRunner: true };
    if (whole && !groups.length) keep(this.alike, r.tree.hash, true);
    return { tree: withoutCopies(r.tree, verdict), busy: r.busy };
  }
}

/** A runner's refusal to start, said with why the helper, which was asked first, did not answer. */
export const afterHelper =
  (why: string) =>
  (e: unknown): never => {
    if (!(e instanceof DeviceError)) throw e;
    throw new DeviceError(
      e.code,
      `${e.message}, after the simulator's helper did not answer: ${why}`,
      e.hint,
    );
  };
