import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { must } from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
import { HelperReads, type ReadsPort } from '../src/sim-read.js';
import type { DirectSim } from '../src/simdirect.js';
import type { RawAx } from '../src/simtree.js';
import { app, tree } from './sim-trees.js';

const copy = (y: number, x = 0) => ({ a: 9, i: 'close', f: [x, y, 40, 40] }) as RawAx;

/**
 * Helper reads of two copies of a control, `screen` the one now on, and a runner that hides the second, cut short or
 * not. `alike`: the two reads compare as one screen, which those of a screen that moves do not.
 */
function reads(cut: boolean[] = [], alike = true) {
  const on = { screen: app(copy(0), copy(100)) };
  let asked = 0;
  const port: ReadsPort = {
    direct: {
      front: () => Promise.resolve('dev.app'),
      read: () => Promise.resolve(tree(on.screen)),
      checkRead: () => alike,
    } as unknown as DirectSim,
    app: () => 'dev.app',
    runnerUp: () => true,
    runnerStarting: () => false,
    runner: () => {
      const t: Tree = structuredClone(tree(on.screen).tree);
      must(t.nodes[2], 'a node').f &= ~1;
      return Promise.resolve({ ...t, truncated: cut[asked++] ?? false });
    },
  };
  const helper = new HelperReads(port);
  /** Whether the second copy is shown in a final read. */
  const second = async () => (must((await helper.read(true))?.tree.nodes[2], 'a node').f & 1) !== 0;
  return { reads: helper, asked: () => asked, on, second };
}

describe('a final read of copies, by the helper', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: 0 }));
  afterEach(() => vi.useRealTimers());

  it('keeps the runner’s verdict, and asks it no more', async () => {
    const r = reads([false]);
    for (const _ of [1, 2, 3]) await r.reads.read(true);
    expect(r.asked()).toBe(1);
  });

  it('keeps no verdict from a runner read cut short, and asks again until one is whole', async () => {
    const r = reads([true, true, false]);
    const first = await r.reads.read(true);
    expect(must(first?.tree.nodes[2], 'a node').f & 1).toBe(0);
    for (const _ of [1, 2, 3]) await r.reads.read(true);
    expect(r.asked()).toBe(3);
  });

  it('asks the runner once of copies that never stand still, whose two reads never compare alike', async () => {
    const r = reads([], false);
    for (let i = 0; i < 20; i++) {
      r.on.screen = app(copy(0, i * 7), copy(100, i * 7));
      vi.advanceTimersByTime(150);
      expect(await r.second()).toBe(false);
    }
    expect(r.asked()).toBe(1);
  });

  it('asks again of copies come to rest at another place, and of one something came over', async () => {
    const r = reads();
    expect(await r.second()).toBe(false);
    r.on.screen = app(copy(200), copy(300));
    vi.advanceTimersByTime(100);
    // on their way, for all the helper knows: the verdict holds by their order
    expect(await r.second()).toBe(false);
    expect(r.asked()).toBe(1);
    vi.advanceTimersByTime(300);
    await r.reads.read(true);
    expect(r.asked()).toBe(2);
    await r.reads.read(true);
    expect(r.asked()).toBe(2);
    r.on.screen = app(copy(200), copy(300), {
      a: 0,
      i: 'sheet',
      l: 'Sheet',
      f: [0, 290, 300, 200],
    });
    vi.advanceTimersByTime(300);
    await r.reads.read(true);
    expect(r.asked()).toBe(3);
  });
});
