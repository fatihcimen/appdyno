import { assert, describe, expect, it } from 'vitest';
import { must } from '@appdyno/core';
import {
  copiesKey,
  layoutHash,
  learnCopies,
  toTree,
  withoutCopies,
  type RawAx,
} from '../src/simtree.js';
import { DirectSim } from '../src/simdirect.js';
import type { HelperProcess } from '../src/simhelper.js';
import { touchEvents } from '../src/simtouch.js';
import { SCREEN, cell, app, tree } from './sim-trees.js';

describe('a link\'s "Open in …?" over an app in landscape', () => {
  // as the read helper gave it on an iPad turned left: the alert's window and frames upright, the screen turned
  const alert = {
    a: 3,
    e: '_UIAlertControllerPhoneTVMacView',
    f: [359.5, 430, 126, 320],
    k: [
      { a: 48, l: 'Open in “appdyno fixture”?', f: [437, 460, 20, 260] },
      { a: 9, l: 'Cancel', f: [375, 446, 48, 140] },
      { a: 9, l: 'Open', f: [375, 594, 48, 140] },
    ],
  };
  const answers: Record<string, unknown> = {
    read: { ok: true, tree: { a: 1, f: [0, 0, 820, 1180], k: [alert] }, screen: [1180, 820] },
    orientation: { ok: true, orientation: 3 },
  };
  const helper = {
    closed: false,
    call: (q: { op: string }) => Promise.resolve(answers[q.op] ?? { ok: true }),
    close: () => undefined,
  } as unknown as HelperProcess;

  it('gives its buttons where the turned screen shows them, and reads no app turned', async () => {
    const d = new DirectSim('u', {
      ax: () => Promise.resolve(helper),
      hid: () => Promise.resolve(helper),
    });
    // where the runner lists them and the picture has them: 516,421 and 664,421
    expect(await d.read('com.apple.springboard')).toEqual({
      refused: 'landscape',
      prompt: {
        words: ['Open in “appdyno fixture”?'],
        buttons: [
          { label: 'Cancel', x: 516, y: 421 },
          { label: 'Open', x: 664, y: 421 },
        ],
      },
    });
    expect(await d.read('dev.appdyno.fixture')).toEqual({ refused: 'landscape' });
  });
});

describe('another process on the home screen', () => {
  const HOME = 'com.apple.springboard';
  const widget = { a: 83, f: [26, 90, 164, 164], t: '8589934592', r: true, e: 'AXRemoteElement' };
  const whole = { ...widget, f: [0, 0, 402, 874] };

  it('reads past a widget, and says the read is partial', () => {
    const r = toTree(app(widget, cell('Safari', 700)), HOME, SCREEN, 5);
    expect(r).toMatchObject({ partial: true });
  });

  it("takes a widget and its app's icon for two things to tap, not copies of one", () => {
    const icon = (y: number): RawAx => ({ ...cell('Maps', y), i: 'Maps' });
    const r = toTree(app(icon(100), icon(300)), HOME, SCREEN, 5);
    expect(r).toMatchObject({ copies: false });
    expect(toTree(app(icon(100), icon(300)), 'dev.app', SCREEN, 5)).toMatchObject({ copies: true });
  });

  it('leaves to the runner what fills the screen, as Spotlight does', () => {
    expect(toTree(app(whole), HOME, SCREEN, 5)).toEqual({ refused: 'remote-content' });
  });

  it('leaves to the runner what another process shows in an app, as a web view does', () => {
    expect(toTree(app(widget), 'dev.app', SCREEN, 5)).toEqual({ refused: 'remote-content' });
  });
});

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
    const [root] = t.nodes;
    assert(root);
    expect(root.d).toBeUndefined();
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
    assert(off && field && sw && below);
    expect(off.f & 16).toBe(0);
    expect(field.f & 8).toBe(8);
    expect(field.f & 128).toBe(128);
    expect(field.t).toBeUndefined();
    expect(field.h).toBe('Search');
    expect(sw.f & (1024 | 32 | 64)).toBe(1024 | 32 | 64);
    expect(below.f & 1).toBe(0);
  });

  it('leaves out the bars of a scroll view, told by their shape', () => {
    const { tree: t } = tree(
      app({ a: 32, f: [0, 0, 402, 874], k: [{ a: 0, f: [396, 0, 6, 800] }, cell('Row', 10)] }),
    );
    expect(must(t.nodes[2], 'a node').f & 1).toBe(0);
    expect(must(t.nodes[3], 'a node').f & 1).toBe(1);
  });

  it('leaves out a toolbar as large as the screen', () => {
    const { tree: t } = tree(app({ a: 24, l: 'Toolbar', f: [0, 0, 402, 874] }));
    expect(must(t.nodes[1], 'a node').f & 1).toBe(0);
    const { tree: bar } = tree(app({ a: 24, l: 'Toolbar', f: [0, 800, 402, 74] }));
    expect(must(bar.nodes[1], 'a node').f & 1).toBe(1);
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
    ).toEqual({ refused: 'alert', prompt: { words: [], buttons: [] } });
  });

  it("gives with the refusal the alert's words and its buttons at their centres, which a link's prompt needs", () => {
    const alert = {
      a: 3,
      e: '_UIAlertControllerPhoneTVMacView',
      f: [41, 375, 320, 152],
      k: [
        { a: 48, l: 'Open in “appdyno fixture”?', f: [57, 400, 288, 20] },
        { a: 9, l: 'Cancel', f: [57, 450, 140, 48] },
        { a: 9, l: 'Open', f: [205, 450, 140, 48] },
      ],
    };
    expect(toTree(app(alert as RawAx), 'com.apple.springboard', SCREEN, 0)).toEqual({
      refused: 'alert',
      prompt: {
        words: ['Open in “appdyno fixture”?'],
        buttons: [
          { label: 'Cancel', x: 127, y: 474 },
          { label: 'Open', x: 275, y: 474 },
        ],
      },
    });
  });

  it('marks repeated controls; the runner verdict hides the copy out of reach, by its place', () => {
    const copy = (y: number) => ({ a: 9, i: 'close', f: [0, y, 40, 40] }) as RawAx;
    const raw = app(copy(0), copy(100));
    const r = tree(raw);
    expect(r.copies).toBe(true);
    const runner = structuredClone(r.tree);
    must(runner.nodes[2], 'a node').f &= ~1;
    const hidden = learnCopies(r.tree, runner);
    assert(hidden);
    const without = withoutCopies(r.tree, hidden);
    expect(must(without.nodes[2], 'a node').f & 1).toBe(0);
    expect(must(without.nodes[1], 'a node').f & 1).toBe(1);
    expect(without.hash).toBe(layoutHash(runner.nodes));
    expect(learnCopies(tree(app(copy(0))).tree, runner)).toBeUndefined();
  });

  it('keeps a verdict by the copies and what is over them, not by a banner turning elsewhere', () => {
    const copy = (y: number) => ({ a: 9, i: 'close', f: [0, y, 40, 40] }) as RawAx;
    const banner = (x: number) =>
      ({ a: 9, i: 'banner', l: 'Sale', f: [x, 400, 300, 100] }) as RawAx;
    const sheet = { a: 0, i: 'sheet', l: 'Sheet', f: [0, 90, 300, 200] } as RawAx;
    const at = (...k: RawAx[]) => tree(app(copy(0), copy(100), ...k)).tree;
    expect(at(banner(0)).hash).not.toBe(at(banner(-120)).hash);
    expect(copiesKey(at(banner(0)))).toBe(copiesKey(at(banner(-120))));
    expect(copiesKey(at(banner(0)))).not.toBe(copiesKey(at(banner(0), sheet)));
    expect(copiesKey(tree(app(copy(0), copy(120))).tree)).not.toBe(copiesKey(at()));
  });

  it('has nothing for the runner to tell of a control twice at one place, or of a list’s rows', () => {
    const copy = (y: number) => ({ a: 9, i: 'close', f: [0, y, 40, 40] }) as RawAx;
    expect(tree(app(copy(0), copy(0))).copies).toBe(false);
    expect(tree(app(copy(0), copy(50), copy(100), copy(150))).copies).toBe(false);
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
    const e = touchEvents({ kind: 'longPress', x: 0, y: 0, durationMs: 800 }, SCREEN);
    assert(e);
    expect(e.map((x) => [x.p, x.at])).toEqual([
      [0, 0],
      [2, 800],
    ]);
  });

  it('draws a swipe along its line, start, moves, end', () => {
    const e = touchEvents(
      { kind: 'swipe', from: { x: 0, y: 0 }, to: { x: 402, y: 0 }, durationMs: 160 },
      SCREEN,
    );
    assert(e);
    expect(e[0]?.p).toBe(0);
    expect(e[e.length - 1]).toEqual({ p: 2, x: 1, y: 0, at: 160 });
    expect(e.slice(1, -1).every((x) => x.p === 1)).toBe(true);
    expect(e[5]?.x).toBeCloseTo(0.5);
  });

  it('moves two fingers at once, and refuses more', () => {
    const finger = (x0: number, x1: number) => [
      { x: x0, y: 100, t: 0 },
      { x: x1, y: 100, t: 100 },
    ];
    const e = touchEvents(
      { kind: 'gesture', pointers: [finger(100, 0), finger(200, 402)] },
      SCREEN,
    );
    assert(e);
    expect(e[e.length - 1]).toMatchObject({ p: 2, x: 0, x2: 1 });
    expect(
      touchEvents(
        { kind: 'gesture', pointers: [finger(0, 1), finger(0, 1), finger(0, 1)] },
        SCREEN,
      ),
    ).toBeUndefined();
  });
});
