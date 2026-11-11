import { describe, expect, it } from 'vitest';
import { must } from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
import { settle, settleAfter, type SettleOn } from '../src/simsettle.js';
import { actionable, sameContent, sameLayout, stickingOut, type RawAx } from '../src/simtree.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { cell, app, tree } from './sim-trees.js';

describe('the settle compare', () => {
  const nodes = (raw: RawAx) => tree(raw).tree.nodes;

  it('ignores nameless system views and order, not moves or new content', () => {
    const a = nodes(app(cell('A', 0), cell('B', 60)));
    const withGlass = nodes(app(cell('A', 0), { a: 0, f: [0, 0, 402, 874] }, cell('B', 60)));
    expect(sameLayout(a, withGlass)).toBe(false);
    expect(sameContent(a, withGlass)).toBe(true);
    const swapped = nodes(app(cell('B', 60), cell('A', 0)));
    expect(sameContent(a, swapped)).toBe(true);
    expect(sameContent(a, nodes(app(cell('A', 0), cell('B', 70))))).toBe(false);
    expect(sameContent(a, nodes(app(cell('A', 0))))).toBe(false);
  });

  it('names what sticks out over the side of the screen', () => {
    const n = nodes(
      app(
        { a: 48, l: 'Old title', f: [-105, 78, 149, 26] },
        { a: 48, l: 'New title', f: [170, 74, 62, 20] },
        { a: 0, f: [-120, 0, 402, 874] },
      ),
    );
    expect([...stickingOut(n, 402)]).toEqual(['StaticText#@-105,78,44,104']);
  });

  it('knows an inert point from one that can react', () => {
    const n = nodes(app(cell('A', 0), { a: 48, l: 'Text', f: [0, 200, 100, 20] }));
    expect(actionable(n, 20, 10)).toBe(true);
    expect(actionable(n, 20, 210)).toBe(false);
    expect(actionable(undefined, 0, 0)).toBe(true);
  });

  const run = (states: string[], quietMs = 100) => {
    let now = 1000;
    let i = 0;
    return settle<string>({
      actionAt: 1000,
      quietMs,
      firstMs: 200,
      reactedMs: 60,
      maxMs: 500,
      pollMs: 20,
      before: 'x',
      read: () => {
        now += 10;
        return Promise.resolve(must(states[Math.min(i++, states.length - 1)], 'a state'));
      },
      same: (a, b) => a === b,
      busy: (s) => s === 'busy',
      clock: () => now,
      sleep: (ms) => {
        now += ms;
        return Promise.resolve();
      },
    });
  };

  it('ends once the screen has been still for the window, from the last change', async () => {
    const r = await run(['x', 'y', 'y', 'y', 'y', 'y', 'y', 'y', 'y']);
    expect(r.settled).toBe(true);
    expect(r.last).toBe('y');
    expect(r.elapsedMs).toBeGreaterThanOrEqual(60);
  });

  it('waits longer for a first reaction than for the end of one', async () => {
    const still = await run(['x']);
    expect(still.settled).toBe(true);
    expect(still.elapsedMs).toBeGreaterThanOrEqual(200);
    const reacted = await run(['y', 'y', 'y', 'y', 'y', 'y', 'y', 'y', 'y']);
    expect(reacted.elapsedMs).toBeLessThan(200);
  });

  it('says not settled at the cap: a screen that keeps changing or stays busy', async () => {
    const r = await run(['busy']);
    expect(r.settled).toBe(false);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(500);
  });

  it('takes a creep under the tolerance per read for a move, until it stops', async () => {
    // a list's slow tail or a sheet easing in: 3 pt a read, where two layouts 4 pt apart are the same
    const creep = (to: number) => {
      let now = 0;
      let at = 0;
      return settle<number>({
        actionAt: 0,
        quietMs: 100,
        firstMs: 100,
        reactedMs: 100,
        maxMs: 1_000,
        pollMs: 20,
        before: 0,
        read: () => {
          now += 10;
          at = Math.min(at + 3, to);
          return Promise.resolve(at);
        },
        same: (a, b) => Math.abs(a - b) <= 4,
        busy: () => false,
        clock: () => now,
        sleep: (ms) => {
          now += ms;
          return Promise.resolve();
        },
      });
    };
    expect((await creep(Infinity)).settled).toBe(false);
    expect(await creep(60)).toMatchObject({ settled: true, last: 60 });
  });
});

describe('an action with no settle', () => {
  it('reads what it was asked to only after the app has handled the touch', async () => {
    const order: string[] = [];
    const t = tree(app(cell('A', 0))).tree;
    const on: SettleOn = {
      read: () => {
        order.push('read');
        return Promise.resolve({ tree: t, busy: false });
      },
      remember: () => undefined,
      recent: new Map(),
      width: 402,
      clock: Date.now,
      handled: () => {
        order.push('handled');
        return Promise.resolve();
      },
    };
    const tap = { kind: 'tap', x: 1, y: 1 } as const;
    await settleAfter(on, tap, { settle: false, read: 'none' });
    expect(order).toEqual([]);
    const r = await settleAfter(on, tap, { settle: false, read: 'tree' });
    expect(order).toEqual(['handled', 'read']);
    expect(r.result).toMatchObject({ hash: t.hash, tree: t });
  });
});

describe('what a settle says of the screen', () => {
  const on = (now: Tree, was: Tree): SettleOn => ({
    read: () => Promise.resolve({ tree: now, busy: false }),
    remember: () => undefined,
    recent: new Map([[was.hash, was.nodes]]),
    width: 402,
    clock: Date.now,
    handled: () => Promise.resolve(undefined),
  });
  const a = tree(app(cell('A', 0))).tree;
  const b = tree(app(cell('B', 200))).tree;
  const settled = (t: Tree) =>
    settleAfter(
      on(t, a),
      { kind: 'swipe', from: { x: 1, y: 1 }, to: { x: 1, y: 50 }, durationMs: 50 },
      { settle: { quietMs: 10, maxMs: 100 }, before: a.hash },
    );

  it('calls another screen moved, and the same one not', async () => {
    expect((await settled(b)).moved).toBe(true);
    expect((await settled(a)).moved).toBe(false);
  });
});

describe('a reaction that begins after the settle', () => {
  const a = tree(app(cell('A', 0))).tree;
  /** A screen still for 650 ms after the tap, then one that moves on each read, or comes once and stays. */
  const late = (moves: boolean) => {
    let start = 0;
    let n = 0;
    const on: SettleOn = {
      read: () => {
        const at = Date.now() - start;
        if (at > 650) n = moves ? n + 1 : 1;
        return Promise.resolve({
          tree: at > 650 ? tree(app(cell('A', 0), cell('B', 100 + n * 10))).tree : a,
          busy: false,
        });
      },
      remember: () => undefined,
      recent: new Map([[a.hash, a.nodes]]),
      width: 402,
      clock: Date.now,
      handled: () => Promise.resolve(undefined),
    };
    start = Date.now();
    return settleAfter(
      on,
      { kind: 'tap', x: 20, y: 10 },
      {
        settle: { quietMs: 200, maxMs: 1_400 },
        before: a.hash,
        read: 'hash',
      },
    );
  };

  it(
    'is settled in turn, not answered at its first frame',
    fakeTimed(async () => {
      const settleOf = (r: { result: object }) =>
        (r.result as { settle: { settled: boolean; ms: number } }).settle;
      expect(settleOf(await late(true)).settled).toBe(false);
      const once = await late(false);
      expect(settleOf(once).settled).toBe(true);
      expect(settleOf(once).ms).toBeGreaterThanOrEqual(800);
      expect(once.moved).toBe(true);
    }),
  );
});
