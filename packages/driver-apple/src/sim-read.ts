import { must, pause } from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
import { HOME_SCREEN_APP } from './platform-screen.js';
import type { DirectSim } from './simdirect.js';
import { type Capture, nodesBusy } from './simsettle.js';
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

/** The helper's reads of the app in front, and what the runner said of each layout of repeated controls. */
export class HelperReads {
  private readonly verdicts = new Map<string, Set<string>>();

  constructor(private readonly p: ReadsPort) {}

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
   * tap reaches, so a layout with repeated controls is believed once the runner has read it alike, and that
   * verdict is kept by the layout's digest. Any other layout needs no runner, and is checked once one is up.
   */
  async read(final: boolean): Promise<Capture | undefined> {
    const r = await this.front();
    if ('refused' in r) return undefined;
    // with a runner up it reads the widget too: this read is less, and no misread to hold against the helper
    if (r.partial && this.p.runnerUp()) return undefined;
    const known = this.verdicts.get(r.tree.hash);
    if (known) return { tree: withoutCopies(r.tree, known), busy: r.busy };
    // while the runner starts, copies are answered as the helper finds them, all of them, rather than after its seconds
    if (!this.p.runnerUp() && (!r.copies || this.p.runnerStarting()))
      return { tree: r.tree, busy: r.busy };
    if (!final) return { tree: r.tree, busy: r.busy, askRunner: true };
    const runner = await this.p.runner();
    const verdict = learnCopies(r.tree, runner);
    if (!verdict || !this.p.direct.checkRead(withoutCopies(r.tree, verdict), runner))
      return { tree: runner, busy: nodesBusy(runner), byRunner: true };
    this.verdicts.delete(r.tree.hash);
    this.verdicts.set(r.tree.hash, verdict);
    if (this.verdicts.size > 64)
      this.verdicts.delete(must(this.verdicts.keys().next().value, 'a verdict'));
    return { tree: withoutCopies(r.tree, verdict), busy: r.busy };
  }
}
