import { sleep as wait, type ActOptions } from '@appdyno/core';
import { Settle, type ActParams, type Tree } from '@appdyno/protocol';
import { actionable, hasAlert, sameContent, sameLayout, stickingOut } from './simtree.js';

type Node = Tree['nodes'][number];

/** One read: `askRunner`, what only the runner can tell of it is yet to be asked. */
export type Capture = { tree: Tree; busy: boolean; byRunner?: boolean; askRunner?: boolean };

/** Reads cost about 30 ms here: the settle can look far more often than the runner's 80 ms. */
const POLL_MS = 20;

export const INERT_QUIET_MS = 80;

const FIRST_REACTION_MS = 500;

/**
 * Once something has reacted, stillness for this long ends the wait. A sliding page holds the settle by
 * itself (`stickingOut`), so the window only has to outlast the gaps within a reaction: 120 ms answered with
 * the search bar a push leaves for a moment, 150 and 200 ms did not (0 of 16 answers each).
 */
const REACTED_QUIET_MS = 150;

const ALERT_REACTION_MS = 1_000;

/** A carousel on the new screen sticks out for good: a push's old page is gone well before this. */
const SLIDE_CAP_MS = 1_200;

export const ALERT_WATCH_MS = 800;

export const ALERT_APPEAR_MS = 450;

const ALERT_GONE_MS = 600;

/** Settling on the host: the runner's `Settler`, over reads that cost little. */
export async function settle<S>(o: {
  actionAt: number;
  quietMs: number;
  /** How long stillness must last while nothing has reacted yet. */
  firstMs: number;
  /** And once something has: the reaction has begun, only its end is awaited. */
  reactedMs: number;
  maxMs: number;
  pollMs: number;
  before: S | undefined;
  read: () => Promise<S>;
  same: (a: S, b: S) => boolean;
  busy: (s: S) => boolean;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ settled: boolean; reads: number; last: S; elapsedMs: number }> {
  const clock = o.clock ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = o.actionAt + o.maxMs;
  let reads = 0;
  // the layout at the last change, not the last read: a motion slower than the tolerance per read adds up to a move
  let anchor = o.before;
  let changedAt = o.actionAt;
  let reacted = false;
  for (;;) {
    const readStart = clock();
    const next = await o.read();
    reads++;
    const now = clock();
    const busy = o.busy(next);
    const held = anchor !== undefined;
    // a read shows the layout as it was when it began: stillness is proven up to its start only
    if (anchor === undefined || !o.same(next, anchor) || busy) {
      changedAt = readStart;
      reacted ||= held;
      anchor = next;
    }
    const window = reacted ? Math.min(o.quietMs, o.reactedMs) : Math.max(o.quietMs, o.firstMs);
    const settled = held && !busy && readStart - changedAt >= window;
    if (settled || now >= deadline)
      return { settled, reads, last: next, elapsedMs: now - o.actionAt };
    await sleep(Math.max(1, Math.min(o.pollMs, deadline - now)));
  }
}

/** What the settle after an action reads and keeps, of the simulator it runs on. */
export type SettleOn = {
  read: (final: boolean) => Promise<Capture>;
  remember: (t: Tree) => void;
  /** Layouts recently answered, by hash, the last the newest: what an action's `before` names. */
  recent: Map<string, Node[]>;
  width: number;
  /** Time as a settle counts it. */
  clock: () => number;
  /** Until the app has handled the touch just sent. */
  handled: () => Promise<void>;
};

/**
 * The settle and the read an action asked for. `untouched`: nothing moved after an actionable tap; `moved`: the
 * screen is another than before the action.
 */
export async function settleAfter(on: SettleOn, action: ActParams, opts: ActOptions) {
  const want = opts.read ?? 'none';
  const answer = (c: Capture | undefined) => {
    if (c) on.remember(c.tree);
    return {
      ...(want !== 'none' && c && { hash: c.tree.hash }),
      ...(want === 'tree' && c && { tree: c.tree }),
    };
  };
  if (opts.settle === false) {
    if (want === 'none') return { untouched: false, result: answer(undefined) };
    await on.handled();
    return { untouched: false, moved: false, result: answer(await on.read(true)) };
  }
  const { quietMs: asked, maxMs } = Settle.parse(opts.settle ?? {});
  const actionAt = on.clock();
  const before = opts.before ? on.recent.get(opts.before) : undefined;
  const seen = before ?? [...on.recent.values()].pop() ?? [];
  const tap = action.kind === 'tap' ? action : undefined;
  const inert = !!tap && !!before && !actionable(before, tap.x, tap.y);
  const quietMs = inert ? Math.min(asked, INERT_QUIET_MS) : asked;
  // an alert or sheet that came up during the settle is still animating in: a tap on it then is lost;
  // one going away is animating out, and the app's reaction to its button comes after that
  const hadAlert = hasAlert(seen);
  let alertSince: number | undefined = hadAlert ? 0 : undefined;
  let alertGoneAt: number | undefined;
  const stuckBefore = stickingOut(seen, on.width);
  let slideSince: number | undefined;
  const read = async (): Promise<Capture> => {
    const c = await on.read(false);
    const now = on.clock();
    if (hasAlert(c.tree.nodes)) {
      alertSince ??= now;
      alertGoneAt = undefined;
      if (now - alertSince < ALERT_APPEAR_MS) return { ...c, busy: true };
    } else {
      if (alertSince !== undefined) alertGoneAt = now;
      alertSince = undefined;
      if (alertGoneAt !== undefined && now - alertGoneAt < ALERT_GONE_MS)
        return { ...c, busy: true };
    }
    const sliding = [...stickingOut(c.tree.nodes, on.width)].some((k) => !stuckBefore.has(k));
    if (sliding) {
      slideSince ??= now;
      if (now - slideSince < SLIDE_CAP_MS) return { ...c, busy: true };
    } else slideSince = undefined;
    return c;
  };
  const rules = {
    clock: on.clock,
    quietMs,
    reactedMs: REACTED_QUIET_MS,
    pollMs: POLL_MS,
    read,
    same: (a: { tree: { nodes: Node[] } }, b: { tree: { nodes: Node[] } }) =>
      sameContent(a.tree.nodes, b.tree.nodes),
    busy: (c: { busy: boolean }) => c.busy,
  };
  const r = await settle<Capture | { tree: { nodes: Node[] }; busy: false }>({
    ...rules,
    actionAt,
    // XCTest's tap took 300-600 ms, in which the app reacted before the window began; a direct touch is
    // over in 50 ms, and an alert's button shows its effect only after about 300 ms
    firstMs: inert ? 0 : hadAlert ? ALERT_REACTION_MS : FIRST_REACTION_MS,
    maxMs,
    before: before && { tree: { nodes: before }, busy: false },
  });
  let last = r.last as Capture;
  let { settled, reads } = r;
  let ms = r.elapsedMs;
  const unchanged = !!before && sameLayout(before, last.tree.nodes) && !hasAlert(last.tree.nodes);
  // an actionable tap that changed nothing in the app may have asked the system for something: its
  // alert comes a moment later, while the app is idle
  if (tap && !inert && unchanged) {
    const idleAt = Date.now();
    while (Date.now() - idleAt < ALERT_WATCH_MS) {
      await wait(100);
      last = await read();
      if (last.byRunner || !sameLayout(before, last.tree.nodes)) break;
    }
    ms += Date.now() - idleAt;
    // a reaction that began after the settle, an alert or the app's own: it is at its first frame, so it is
    // settled in turn from there, within what is left of the action's time
    if (!sameLayout(before, last.tree.nodes)) {
      const at = on.clock();
      const again = await settle({
        ...rules,
        actionAt: at,
        firstMs: REACTED_QUIET_MS,
        maxMs: actionAt + maxMs - at,
        before: last,
      });
      last = again.last;
      settled = again.settled;
      reads += again.reads;
      ms += again.elapsedMs;
    }
  }
  const untouched = unchanged && sameLayout(before, last.tree.nodes);
  // the last look may have left to the runner what only it can tell
  if (want !== 'none' && last.askRunner) last = await on.read(true);
  return {
    untouched,
    moved: !sameContent(seen, last.tree.nodes),
    result: {
      settle: { settled, ms, reads, quietMs },
      ...answer(last),
    },
  };
}
