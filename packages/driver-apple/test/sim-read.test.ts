import { describe, expect, it } from 'vitest';
import { must } from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
import { HelperReads, type ReadsPort } from '../src/sim-read.js';
import type { DirectSim } from '../src/simdirect.js';
import type { RawAx } from '../src/simtree.js';
import { app, tree } from './sim-trees.js';

const copy = (y: number) => ({ a: 9, i: 'close', f: [0, y, 40, 40] }) as RawAx;

/** A helper read of two copies of a control, and a runner that hides the second, cut short or not. */
function reads(cut: boolean[]) {
  const helper = tree(app(copy(0), copy(100)));
  let asked = 0;
  const port: ReadsPort = {
    direct: {
      front: () => Promise.resolve('dev.app'),
      read: () => Promise.resolve(helper),
      checkRead: () => true,
    } as unknown as DirectSim,
    app: () => 'dev.app',
    runnerUp: () => true,
    runnerStarting: () => false,
    runner: () => {
      const t: Tree = structuredClone(helper.tree);
      must(t.nodes[2], 'a node').f &= ~1;
      return Promise.resolve({ ...t, truncated: cut[asked++] ?? false });
    },
  };
  return { reads: new HelperReads(port), asked: () => asked };
}

describe('a final read of copies, by the helper', () => {
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
});
