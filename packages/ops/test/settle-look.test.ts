import { androidScreen } from '@appdyno/driver-android';
import type { Device } from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { Session } from '../src/session.js';

/** One screen of the app: `layout` is its digest, `words` its text, which the digest leaves out. */
const tree = (layout: string, words = 'Hello'): Tree => ({
  windows: [
    { type: 1, pkg: 'dev.app', layer: 1, b: [0, 0, 1080, 2400], active: true, focused: true },
  ],
  nodes: [
    { p: -1, w: 0, c: 'android.widget.FrameLayout', b: [0, 0, 1080, 2400], f: 17 },
    { p: 0, w: 0, c: 'android.widget.TextView', t: words, b: [0, 100, 1080, 200], f: 17 },
  ],
  truncated: false,
  elapsedMs: 1,
  hash: layout,
});

/** A device whose screen at each moment since it was made is `at(ms)`, each read taking `readMs`. */
function device(at: (ms: number) => Tree, readMs = 10) {
  const start = Date.now();
  const calls = { reads: 0, waits: 0 };
  const d = {
    platform: 'android',
    platformScreen: androidScreen,
    tree: async () => {
      calls.reads++;
      const t = at(Date.now() - start);
      await new Promise((r) => setTimeout(r, readMs));
      return t;
    },
    // the agent's wait, which the settle does not use: a simulator's is the runner's, slower than its reads
    waitChange: () => {
      calls.waits++;
      return Promise.resolve(undefined);
    },
  };
  return { session: new Session(d as unknown as Device, 'dev.app'), calls };
}

describe('a screen settling after a launch or a link', () => {
  it('is settled once its layout held for the window, by reads with no fixed wait between two', async () => {
    const { session, calls } = device(() => tree('A'));
    const start = Date.now();
    const r = await session.settle(200, 3_000);
    expect([r.settled, r.screen.hash]).toEqual([true, 'A']);
    expect(Date.now() - start).toBeGreaterThanOrEqual(200);
    expect(Date.now() - start).toBeLessThan(1_000);
    expect(calls).toMatchObject({ waits: 0 });
    expect(calls.reads).toBeGreaterThan(2);
  });

  it("counts a slow read's own time towards the window, which it proves up to where it began", async () => {
    // a phone's runner: 250 ms a read, so two reads prove the window where a read, 200 ms and a read did
    const { session, calls } = device(() => tree('A'), 250);
    const start = Date.now();
    const r = await session.settle(200, 3_000);
    expect(r.settled).toBe(true);
    expect(calls.reads).toBe(2);
    // under what a read, a 200 ms pause and two reads more take: 713 ms on a GitHub runner for these two
    expect(Date.now() - start).toBeLessThan(950);
  });

  it('counts the window from the last change of layout', async () => {
    const { session } = device((ms) => tree(ms < 400 ? `moving ${Math.floor(ms / 50)}` : 'B'));
    const start = Date.now();
    const r = await session.settle(200, 3_000);
    expect([r.settled, r.screen.hash]).toEqual([true, 'B']);
    expect(Date.now() - start).toBeGreaterThanOrEqual(600);
  });

  it("is settled while only its words change, as an action's settle is", async () => {
    const { session } = device((ms) => tree('A', `tick ${Math.floor(ms / 30)}`));
    expect((await session.settle(200, 3_000)).settled).toBe(true);
  });

  it('is not settled while its layout keeps moving, and says so at the cap', async () => {
    const { session } = device((ms) => tree(`moving ${Math.floor(ms / 50)}`));
    const start = Date.now();
    const r = await session.settle(200, 800);
    expect(r.settled).toBe(false);
    expect(Date.now() - start).toBeGreaterThanOrEqual(800);
  });
});
