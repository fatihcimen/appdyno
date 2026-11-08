import { must, type InputEvent, type Screen } from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followScreen } from '../src/screen-follow.js';

const screen = (hash: string) => ({ hash }) as Screen;
const down: InputEvent = { kind: 'touch', p: 0, x: 0.5, y: 0.5 };
const up: InputEvent = { kind: 'touch', p: 2, x: 0.5, y: 0.5 };

/** A device whose reads end when the test says, each with the screen it was given. */
function setup(may = () => true) {
  const reads: { end: (s: Screen) => void; fail: (e: Error) => void }[] = [];
  const failures: Error[] = [];
  const follow = followScreen({
    read: () => new Promise((end, fail) => reads.push({ end, fail })),
    may,
    failed: (e) => failures.push(e),
  });
  return { follow, reads, failures };
}

describe('a screen followed beside a window', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());
  const passes = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  it('reads nothing until something wants it, and stops when nothing does', async () => {
    const { follow, reads } = setup();
    await passes(1_000);
    expect(reads).toHaveLength(0);
    follow.want(true);
    await passes(0);
    expect(reads).toHaveLength(1);
    follow.want(false);
    must(reads[0], 'a read').end(screen('a'));
    await passes(1_000);
    expect(reads).toHaveLength(1);
  });

  it('answers what a person saw at once, with a read of the device under way', async () => {
    const { follow, reads } = setup();
    follow.want(true);
    await passes(0);
    must(reads[0], 'a read').end(screen('a'));
    await passes(200);
    expect(reads).toHaveLength(2);
    // nothing here waits for the read that has just started
    const seen = follow.seen();
    expect(await Promise.race([seen, Promise.resolve('waited')])).not.toBe('waited');
    expect(await seen).toEqual(screen('a'));
  });

  it('starts no read while a finger is down, or as it lifts', async () => {
    const { follow, reads } = setup();
    follow.want(true);
    await passes(0);
    must(reads[0], 'a read').end(screen('a'));
    await passes(0);
    follow.touched(down);
    await passes(1_000);
    expect(reads).toHaveLength(1);
    follow.touched(up);
    await passes(50);
    expect(reads).toHaveLength(1);
    await passes(150);
    expect(reads).toHaveLength(2);
  });

  it('gives a slow device as long to rest as a read took it', async () => {
    const { follow, reads } = setup();
    follow.want(true);
    await passes(0);
    await passes(1_000);
    must(reads[0], 'a read').end(screen('a'));
    await passes(900);
    expect(reads).toHaveLength(1);
    await passes(150);
    expect(reads).toHaveLength(2);
  });

  it('takes the read under way for a touch that came before anything was read since the last', async () => {
    const { follow, reads } = setup();
    follow.want(true);
    await passes(0);
    must(reads[0], 'a read').end(screen('before'));
    await passes(200);
    expect(reads).toHaveLength(2);
    follow.touched(up);
    await passes(10);
    const seen = follow.seen();
    must(reads[1], 'a read').end(screen('during'));
    expect(await seen).toEqual(screen('during'));
  });

  it("keeps to the screen before a second click that came too soon for the first's to be read", async () => {
    const { follow, reads } = setup();
    follow.want(true);
    await passes(0);
    must(reads[0], 'a read').end(screen('before'));
    await passes(0);
    follow.touched(down);
    follow.touched(up);
    await passes(50);
    expect(reads).toHaveLength(1);
    expect(await follow.seen()).toEqual(screen('before'));
  });

  it('stands by the last screen when a read fails, and says so', async () => {
    const { follow, reads, failures } = setup();
    follow.want(true);
    await passes(0);
    must(reads[0], 'a read').end(screen('a'));
    await passes(200);
    follow.touched(up);
    await passes(10);
    const seen = follow.seen();
    must(reads[1], 'a read').fail(new Error('gone'));
    expect(await seen).toEqual(screen('a'));
    expect(failures).toHaveLength(1);
  });

  it('holds its reads while it may not: a read wakes a dark screen', async () => {
    let live = false;
    const { follow, reads } = setup(() => live);
    follow.want(true);
    await passes(1_000);
    expect(reads).toHaveLength(0);
    live = true;
    await passes(100);
    expect(reads).toHaveLength(1);
  });
});
