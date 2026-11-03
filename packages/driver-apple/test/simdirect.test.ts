import { describe, expect, it, vi } from 'vitest';
import type { Tree } from '@appdyno/protocol';
import { directChecks } from '../src/provider.js';
import { DirectSim } from '../src/simdirect.js';
import { settle, settleAfter, type SettleOn } from '../src/simsettle.js';
import {
  actionable,
  layoutHash,
  learnCopies,
  onKeyboard,
  sameContent,
  sameLayout,
  sameTree,
  stickingOut,
  toTree,
  withoutCopies,
  type RawAx,
} from '../src/simtree.js';
import { touchEvents } from '../src/simtouch.js';
import type { HelperProcess } from '../src/simhelper.js';

const SCREEN = { w: 402, h: 874 };
const cell = (label: string, y: number, extra: Partial<RawAx> = {}): RawAx => ({
  a: 75,
  l: label,
  f: [16, y, 370, 52],
  t: '8589934592',
  ...extra,
});
const app = (...k: RawAx[]): RawAx => ({ a: 1, l: 'Settings', f: [0, 0, 402, 874], t: '0', k });
const tree = (raw: RawAx) => {
  const r = toTree(raw, 'a.b', SCREEN, 5);
  if ('refused' in r) throw new Error(r.refused);
  return r;
};

describe('the helper read in the runner shape', () => {
  it('builds the nodes breadth first, as the runner does', () => {
    const { tree: t } = tree(
      app({ a: 0, f: [0, 0, 402, 874], k: [cell('Deep', 100)] }, cell('Near', 50)),
    );
    expect(t.nodes.map((n) => [n.c, n.p])).toEqual([
      ['Application', -1],
      ['Other', 0],
      ['Cell', 0],
      ['Cell', 1],
    ]);
    expect(t.nodes[0]!.d).toBeUndefined();
    expect(t.windows[0]).toMatchObject({ pkg: 'a.b', b: [0, 0, 402, 874] });
    expect(t.hash).toBe(layoutHash(t.nodes));
  });

  it('gives each node the flags of its type, traits and place', () => {
    const { tree: t } = tree(
      app(
        cell('Off', 0, { t: String(1n << 8n) }),
        { a: 45, f: [0, 0, 100, 30], t: String(1n << 21n), v: 'Search', h: 'Search' },
        { a: 40, f: [0, 40, 50, 30], v: 1, t: String(1n << 3n) },
        { a: 75, l: 'Below', f: [0, 900, 100, 30] },
      ),
    );
    const [, off, field, sw, below] = t.nodes;
    expect(off!.f & 16).toBe(0);
    expect(field!.f & 8).toBe(8);
    expect(field!.f & 128).toBe(128);
    expect(field!.t).toBeUndefined();
    expect(field!.h).toBe('Search');
    expect(sw!.f & (1024 | 32 | 64)).toBe(1024 | 32 | 64);
    expect(below!.f & 1).toBe(0);
  });

  it('leaves out the bars of a scroll view, told by their shape', () => {
    const { tree: t } = tree(
      app({ a: 32, f: [0, 0, 402, 874], k: [{ a: 0, f: [396, 0, 6, 800] }, cell('Row', 10)] }),
    );
    expect(t.nodes[2]!.f & 1).toBe(0);
    expect(t.nodes[3]!.f & 1).toBe(1);
  });

  it('leaves out a toolbar as large as the screen', () => {
    const { tree: t } = tree(app({ a: 24, l: 'Toolbar', f: [0, 0, 402, 874] }));
    expect(t.nodes[1]!.f & 1).toBe(0);
    const { tree: bar } = tree(app({ a: 24, l: 'Toolbar', f: [0, 800, 402, 74] }));
    expect(bar.nodes[1]!.f & 1).toBe(1);
  });

  it('says busy for a progress indicator on screen', () => {
    expect(tree(app({ a: 36, f: [0, 0, 20, 20] })).busy).toBe(true);
    expect(tree(app(cell('Row', 0))).busy).toBe(false);
  });

  it('refuses content of another process on screen, not off it', () => {
    expect(toTree(app({ a: 0, r: 1, f: [0, 0, 402, 874] }), 'a.b', SCREEN, 0)).toEqual({
      refused: 'remote-content',
    });
    expect('tree' in toTree(app({ a: 0, r: 1, f: [0, 0, 0, 0] }), 'a.b', SCREEN, 0)).toBe(true);
  });

  it('refuses an alert: XCUI makes an Alert of it and leaves out what it covers', () => {
    expect(
      toTree(
        app({ a: 3, e: '_UIAlertControllerPhoneTVMacView', f: [41, 375, 320, 152] }),
        'a.b',
        SCREEN,
        0,
      ),
    ).toEqual({ refused: 'alert' });
  });

  it('marks repeated controls; the runner verdict hides the copy out of reach, by its place', () => {
    const copy = (y: number) => ({ a: 9, i: 'close', f: [0, y, 40, 40] }) as RawAx;
    const raw = app(copy(0), copy(100));
    const r = tree(raw);
    expect(r.copies).toBe(true);
    const runner = structuredClone(r.tree) as Tree;
    runner.nodes[2]!.f &= ~1;
    const hidden = learnCopies(r.tree, runner)!;
    const without = withoutCopies(r.tree, hidden);
    expect(without.nodes[2]!.f & 1).toBe(0);
    expect(without.nodes[1]!.f & 1).toBe(1);
    expect(without.hash).toBe(layoutHash(runner.nodes));
    expect(learnCopies(tree(app(copy(0))).tree, runner)).toBeUndefined();
  });

  it('has nothing for the runner to tell of a control twice at one place, or of a list’s rows', () => {
    const copy = (y: number) => ({ a: 9, i: 'close', f: [0, y, 40, 40] }) as RawAx;
    expect(tree(app(copy(0), copy(0))).copies).toBe(false);
    expect(tree(app(copy(0), copy(50), copy(100), copy(150))).copies).toBe(false);
  });

  it('computes the digest the runner computes', () => {
    // FNV-1a 64 of nothing shown
    expect(layoutHash([])).toBe('cbf29ce484222325');
  });
});

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
      read: async () => {
        now += 10;
        return states[Math.min(i++, states.length - 1)]!;
      },
      same: (a, b) => a === b,
      busy: (s) => s === 'busy',
      clock: () => now,
      sleep: async (ms) => {
        now += ms;
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
});

describe('the digitizer events', () => {
  it('holds a tap for a moment and normalizes by the screen', () => {
    expect(touchEvents({ kind: 'tap', x: 201, y: 437 }, SCREEN)).toEqual([
      { p: 0, x: 0.5, y: 0.5, at: 0 },
      { p: 2, x: 0.5, y: 0.5, at: 50 },
    ]);
  });

  it('holds a long press for its duration', () => {
    const e = touchEvents({ kind: 'longPress', x: 0, y: 0, durationMs: 800 }, SCREEN)!;
    expect(e.map((x) => [x.p, x.at])).toEqual([
      [0, 0],
      [2, 800],
    ]);
  });

  it('draws a swipe along its line, start, moves, end', () => {
    const e = touchEvents(
      { kind: 'swipe', from: { x: 0, y: 0 }, to: { x: 402, y: 0 }, durationMs: 160 },
      SCREEN,
    )!;
    expect(e[0]!.p).toBe(0);
    expect(e[e.length - 1]).toEqual({ p: 2, x: 1, y: 0, at: 160 });
    expect(e.slice(1, -1).every((x) => x.p === 1)).toBe(true);
    expect(e[5]!.x).toBeCloseTo(0.5);
  });

  it('moves two fingers at once, and refuses more', () => {
    const finger = (x0: number, x1: number) => [
      { x: x0, y: 100, t: 0 },
      { x: x1, y: 100, t: 100 },
    ];
    const e = touchEvents(
      { kind: 'gesture', pointers: [finger(100, 0), finger(200, 402)] },
      SCREEN,
    )!;
    expect(e[e.length - 1]).toMatchObject({ p: 2, x: 0, x2: 1 });
    expect(
      touchEvents(
        { kind: 'gesture', pointers: [finger(0, 1), finger(0, 1), finger(0, 1)] },
        SCREEN,
      ),
    ).toBeUndefined();
  });
});

describe('an action with no settle', () => {
  it('reads what it was asked to only after the app has handled the touch', async () => {
    const order: string[] = [];
    const t = tree(app(cell('A', 0))).tree;
    const on: SettleOn = {
      read: async () => {
        order.push('read');
        return { tree: t, busy: false };
      },
      remember: () => undefined,
      recent: new Map(),
      width: 402,
      clock: Date.now,
      handled: async () => {
        order.push('handled');
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
    read: async () => ({ tree: now, busy: false }),
    remember: () => undefined,
    recent: new Map([[was.hash, was.nodes]]),
    width: 402,
    clock: Date.now,
    handled: async () => undefined,
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

describe('the helpers prove themselves', () => {
  const helper = (answer: (q: Record<string, unknown>) => Record<string, unknown>) =>
    ({
      closed: false,
      call: vi.fn(async (q: Record<string, unknown>) => answer(q)),
      close: vi.fn(),
    }) as unknown as HelperProcess;
  const ax = () =>
    helper((q) =>
      q.op === 'read'
        ? { ok: true, tree: app(cell('A', 0)), screen: [402, 874], touchesEnded: 2, ms: 3 }
        : { ok: true },
    );

  it('keeps away from a read until asked, and off when told', async () => {
    const off = new DirectSim('u', { ax: async () => ax(), hid: async () => ax() }, 'off');
    expect(await off.read('a.b')).toEqual({ refused: 'APPDYNO_SIM_DIRECT=off' });
    expect(await off.send({ kind: 'tap', x: 1, y: 1 })).toBe(false);
  });

  it('says hello from the helper, in portrait only, and knows the screen from it', async () => {
    const answer = (size: number[]) =>
      helper((q) =>
        q.op === 'hello'
          ? { ok: true, osVersion: '26.5', model: 'iPhone18,1', scale: 3, screen: size }
          : { ok: true },
      );
    const d = new DirectSim('u', { ax: async () => answer([402, 874]), hid: async () => ax() });
    expect(d.screenKnown).toBe(false);
    expect(await d.hello()).toMatchObject({
      platform: 'ios',
      osVersion: '26.5',
      model: 'iPhone18,1',
      screen: { w: 402, h: 874, density: 3, rotation: 0 },
    });
    expect(d.screenKnown).toBe(true);
    const wide = new DirectSim('u', { ax: async () => answer([874, 402]), hid: async () => ax() });
    expect(await wide.hello()).toBeUndefined();
    const off = new DirectSim('u', { ax: async () => ax(), hid: async () => ax() }, 'off');
    expect(await off.hello()).toBeUndefined();
  });

  it('asks the app when its animations are over, and tells what that took', async () => {
    const asked: unknown[] = [];
    const answer = helper((q) => {
      asked.push(q);
      return { ok: true, ms: 473, over: 1 };
    });
    const d = new DirectSim('u', { ax: async () => answer, hid: async () => ax() });
    expect(await d.animationsOver()).toBe(473);
    expect(asked).toMatchObject([{ op: 'animations', within: 1 }]);
    const refused = helper(() => ({ ok: false, refused: 'no-report' }));
    const none = new DirectSim('u', { ax: async () => refused, hid: async () => ax() });
    expect(await none.animationsOver()).toBeUndefined();
    vi.stubEnv('APPDYNO_ANIMATION_WAIT', '0');
    expect(await d.animationsOver()).toBeUndefined();
    expect(asked).toHaveLength(1);
    vi.unstubAllEnvs();
  });

  it('after a touch, asks for the app to have handled it before anything counts as still', async () => {
    const asked: Record<string, unknown>[] = [];
    const answer = helper((q) => {
      asked.push(q);
      return { ok: true, touchesEnded: q.op === 'arm' ? 4 : 6, ms: 300, screen: [402, 874] };
    });
    const hid = helper(() => ({ ok: true }));
    const d = new DirectSim('u', { ax: async () => answer, hid: async () => hid });
    await d.hello();
    await d.touchHandled();
    expect(asked.map((q) => q.op)).toEqual(['hello']);
    await d.arm();
    expect(await d.send({ kind: 'tap', x: 1, y: 1 })).toBe(true);
    await d.touchHandled();
    expect(asked.at(-1)).toMatchObject({ op: 'touched', touches: 6 });
    // handled now: nothing to ask, and the next wait has nothing to wait for first
    await d.touchHandled();
    expect(asked.filter((q) => q.op === 'touched')).toHaveLength(1);
    await d.animationsOver();
    expect(asked.at(-1)).toMatchObject({ op: 'animations', touches: 6 });
  });

  it('leaves the simulator as it found it, unless a runner stays and needs it so', async () => {
    const asked: unknown[] = [];
    const answer = () =>
      helper((q) => {
        asked.push(q.op);
        return { ok: true, screen: [402, 874], osVersion: '26.5', model: 'x', scale: 3 };
      });
    const gone = new DirectSim('u', { ax: async () => answer(), hid: async () => ax() });
    await gone.hello();
    gone.close();
    await vi.waitFor(() => expect(asked).toEqual(['hello', 'leave']));
    asked.length = 0;
    const stays = new DirectSim('u', { ax: async () => answer(), hid: async () => ax() });
    await stays.hello();
    stays.close(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(asked).toEqual(['hello']);
  });

  it('believes a read that says what the runner says, and not one that does not', async () => {
    const d = new DirectSim('u', { ax: async () => ax(), hid: async () => ax() }, undefined);
    const r = await d.read('a.b');
    if ('refused' in r) throw new Error(r.refused);
    expect(d.screenKnown).toBe(true);
    const other = tree(app(cell('B', 200))).tree;
    expect(d.checkRead(r.tree, other)).toBe(false);
    expect(d.checkRead(r.tree, structuredClone(r.tree))).toBe(true);
    expect(d.touchesEnded).toBe(2);
    // once believed, a screen it reads differently goes to the runner, the helper stays on
    for (let i = 0; i < 4; i++) expect(d.checkRead(r.tree, other)).toBe(false);
    expect('tree' in (await d.read('a.b'))).toBe(true);
  });

  it('gives up after three reads that never agreed', async () => {
    const d = new DirectSim('u', { ax: async () => ax(), hid: async () => ax() }, undefined);
    const r = await d.read('a.b');
    if ('refused' in r) throw new Error(r.refused);
    const other = tree(app(cell('B', 200))).tree;
    for (let i = 0; i < 3; i++) d.checkRead(r.tree, other);
    expect('refused' in (await d.read('a.b'))).toBe(true);
    expect(d.status().read).toMatch(/differed/);
  });

  it('forgives a clock on screen when it compares', () => {
    const rows = (t: string) =>
      app(
        cell('A', 0),
        cell('B', 60),
        cell('C', 120),
        cell('D', 180),
        cell('E', 240),
        cell(t, 300),
      );
    expect(sameTree(tree(rows('12:00')).tree, tree(rows('12:01')).tree)).toBe(true);
  });

  it('sends a touch once the screen is known, and leaves input to the runner after a lost one', async () => {
    const hid = helper(() => ({ ok: true }));
    const d = new DirectSim('u', { ax: async () => ax(), hid: async () => hid }, undefined);
    expect(await d.send({ kind: 'tap', x: 1, y: 1 })).toBe(false);
    await d.read('a.b');
    expect(await d.send({ kind: 'tap', x: 1, y: 1 })).toBe(true);
    expect(hid.call).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'touch' }),
      expect.any(Number),
    );
    expect(await d.send({ kind: 'key', key: 'enter' })).toBe(true);
    expect(hid.call).toHaveBeenCalledWith({ op: 'key', page: 7, usage: 0x28 }, expect.any(Number));
    expect(await d.send({ kind: 'key', key: 'back' })).toBe(false);
    d.touchLost();
    expect(await d.send({ kind: 'tap', x: 1, y: 1 })).toBe(false);
    expect(d.status().input).toMatch(/did not reach the app/);
  });

  it('leaves input to the runner when the app cannot report touches, not when one app says no', async () => {
    const refusing = (refused: string) =>
      helper((q) =>
        q.op === 'read'
          ? { ok: true, tree: app(cell('A', 0)), screen: [402, 874], touchesEnded: 0 }
          : { ok: false, refused },
      );
    const blind = new DirectSim(
      'u',
      { ax: async () => refusing('the observer did not start'), hid: async () => ax() },
      undefined,
    );
    await blind.read('a.b');
    expect(await blind.arm()).toBe(false);
    expect(await blind.send({ kind: 'tap', x: 1, y: 1 })).toBe(false);
    const other = new DirectSim(
      'u',
      { ax: async () => refusing('no-report'), hid: async () => ax() },
      undefined,
    );
    await other.read('a.b');
    expect(await other.arm()).toBe(false);
    expect(await other.send({ kind: 'tap', x: 1, y: 1 })).toBe(true);
  });

  it('knows a point on the keyboard', () => {
    const n = tree(app({ a: 19, f: [0, 500, 402, 374] }, cell('Row', 0))).tree.nodes;
    expect(onKeyboard(n, 10, 600)).toBe(true);
    expect(onKeyboard(n, 10, 10)).toBe(false);
  });

  it('leaves input to the runner when the daemon stops answering', async () => {
    const hid = helper(() => ({ ok: false, error: 'dtuhidd did not answer' }));
    const d = new DirectSim('u', { ax: async () => ax(), hid: async () => hid }, undefined);
    await d.read('a.b');
    expect(await d.send({ kind: 'tap', x: 1, y: 1 })).toBe(false);
    expect(await d.send({ kind: 'tap', x: 1, y: 1 })).toBe(false);
    expect(hid.call).toHaveBeenCalledTimes(1);
  });

  it('turns both off in landscape: only portrait is verified', async () => {
    const d = new DirectSim('u', { ax: async () => ax(), hid: async () => ax() }, undefined);
    d.setRotation(1);
    expect(await d.read('a.b')).toEqual({ refused: 'no-target' });
    await expect(d.send({ kind: 'tap', x: 1, y: 1 })).resolves.toBe(false);
  });

  it('is reported by the doctor, a failure as a warning', async () => {
    const good = new DirectSim('u', { ax: async () => ax(), hid: async () => ax() }, undefined);
    expect((await directChecks('u', good)).every((c) => c.ok)).toBe(true);
    const bad = new DirectSim(
      'u',
      {
        ax: async () => helper(() => ({ ok: false, refused: 'the snapshot call is missing' })),
        hid: async () => {
          throw new Error('no CoreSimulator');
        },
      },
      undefined,
    );
    const checks = await directChecks('u', bad);
    expect(checks.every((c) => !c.ok && c.warn)).toBe(true);
    expect(checks[0]!.detail).toContain('no CoreSimulator');
  });
});
