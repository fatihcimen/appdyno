import {
  failedAfterSending,
  must,
  sleep,
  throwIfCancelled,
  TRANSITION_MS,
  type ActOptions,
} from '@appdyno/core';
import {
  KEY_USAGES,
  NODE_FLAGS as F,
  type ActParams,
  type ActResult,
  type Tree,
} from '@appdyno/protocol';
import { pasteboardKey, refuseWhereSynced } from './sim-clipboard.js';
import type { HelperReads } from './sim-read.js';
import { typeByKeys } from './sim-keys.js';
import type { DirectSim } from './simdirect.js';
import { Cycling, OWN_MS } from './simcycling.js';
import { type Capture, settleAfter } from './simsettle.js';
import { firstPoint, hidKey } from './simtouch.js';
import { onKeyboard } from './simtree.js';

type Node = Tree['nodes'][number];

/** How long a touch that changed nothing has to be reported, before the runner does it again. */
const LATE_TOUCH_MS = 4_000;

/** What the helper's touches take of the simulator, each asked as it is needed. */
export type ActsPort = {
  direct: DirectSim;
  reads: HelperReads;
  /** Whether touches and keys go by the helper. */
  helperInput: () => boolean;
  /** A read for one in the queue: the helper's, else the runner's (a system alert, a web page). */
  read: (final: boolean) => Promise<Capture>;
  /** The action again, by the runner. */
  byRunner: (action: ActParams, opts: ActOptions) => Promise<ActResult>;
  /** The screen's width in points, as the hello said it. */
  width: () => number;
};

/** Touches and keys by the helper, each settled against the layouts last answered; one the app never got goes by the runner. */
export class HelperActs {
  /** Layouts recently answered, by hash: what an action's `before` names. */
  readonly recent = new Map<string, Node[]>();

  /** When the transition the last touch started has ended. */
  transitionEnds = 0;

  /** What calls have waited for the runner to come up: no settle running meanwhile counts it. */
  startingMs = 0;

  private readonly cycling = new Cycling();

  /** When the last action's settle began. */
  private settledAt = 0;

  constructor(private readonly p: ActsPort) {}

  /** Whether a field has the focus in the layout last answered. */
  private intoField() {
    const nodes = [...this.recent.values()].pop() ?? [];
    return nodes.some((n) => (n.f & F.focused) !== 0 && (n.f & F.editable) !== 0);
  }

  remember(t: Tree) {
    this.recent.delete(t.hash);
    this.recent.set(t.hash, t.nodes);
    if (this.recent.size > 8) this.recent.delete(must(this.recent.keys().next().value, 'a read'));
    return t;
  }

  /** What a settle after an action reads and remembers, on the clock that leaves out waits for the runner. */
  settleOn() {
    const rested = Date.now() - this.settledAt > OWN_MS;
    this.settledAt = Date.now();
    return {
      cycling: this.cycling,
      rested,
      read: (final: boolean) => this.p.read(final),
      remember: (t: Tree) => this.remember(t),
      recent: this.recent,
      width: this.p.width(),
      clock: () => Date.now() - this.startingMs,
      handled: () => this.p.direct.touchHandled().catch(() => undefined),
    };
  }

  /**
   * A US keyboard's text by the helper's keys (`typeByKeys`) and the settle after them, in the device's queue: what
   * `typeByKeys` answers where the runner is to type it.
   */
  async keys(
    text: string,
    opts: Parameters<typeof typeByKeys>[1] & ActOptions,
    keyboardOpen: (t: Tree) => boolean,
  ) {
    const { direct, reads } = this.p;
    const r = await typeByKeys(text, opts, {
      read: () => reads.front().then((x) => ('refused' in x ? undefined : x.tree)),
      send: (a) => direct.send(a),
      keyboardOpen,
    });
    const key = { kind: 'key', key: 'a' } as const; // the settle tells touches apart, and keys are none
    if (!r || typeof r === 'string') return r;
    return { ...r, ...(await settleAfter(this.settleOn(), key, opts)).result };
  }

  /** One action, in the device's queue. */
  async act(action: ActParams, opts: ActOptions): Promise<ActResult> {
    const { direct, reads } = this.p;
    const helperInput = this.p.helperInput();
    // the helper looks at no signal: a stroke of a call stopped meanwhile, as its app died, goes no further than this
    throwIfCancelled('the action');
    // before a key goes by either, the runner too: a copy would reach the Mac's clipboard, a paste bring it into a field
    const asks = pasteboardKey(action);
    if (asks) await refuseWhereSynced(asks);
    // a keyboard's key into a field goes by the runner, which reads it back from the field (`verified`); with none
    // focused the helper's goes, and says so
    const typing = action.kind === 'key' && hidKey(action.key)?.page === KEY_USAGES.enter.page;
    if (typing && this.intoField()) return this.p.byRunner(action, opts);
    if (helperInput && !direct.screenKnown) await reads.read(true);
    const touch = action.kind !== 'key';
    const at = touch ? firstPoint(action) : undefined;
    const armed = helperInput && !!at && (await direct.arm().catch(() => false));
    const waited =
      at && helperInput ? await direct.animationsOver().catch(() => undefined) : undefined;
    if (at) await sleep(Math.max(0, this.transitionEnds - Date.now()));
    const touchesBefore = direct.touchesEnded;
    const touchedAt = Date.now();
    // a stop that came in the waits above holds the stroke too
    throwIfCancelled('the action');
    if (!(await direct.send(action))) return this.p.byRunner(action, opts);
    const settled = () => settleAfter(this.settleOn(), action, opts).catch(failedAfterSending);
    let out = await settled();
    // nothing moved and the app has not seen the touch finish: it never got it, or a loaded Mac has it far behind
    const reports = armed && !onKeyboard([...this.recent.values()].pop() ?? [], at.x, at.y);
    if (reports && out.untouched && touchesBefore === direct.touchesEnded) {
      await direct.touchHandled(LATE_TOUCH_MS).catch(() => undefined);
      if (touchesBefore === direct.touchesEnded) {
        direct.touchLost();
        return this.p.byRunner(action, opts);
      }
      out = await settled();
    }
    this.transitionEnds = out.moved ? touchedAt + TRANSITION_MS : 0;
    return {
      ...out.result,
      ...(waited !== undefined && { animationWaitMs: waited }),
      ...(typing && { noFocus: true }),
    };
  }
}
