import type { Tree } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { frontChanged, frontOf } from '../src/index.js';

type Window = Tree['windows'][number];

const app = (pkg: string): Window => ({
  type: 1,
  pkg,
  layer: 0,
  b: [0, 0, 390, 844],
  active: true,
  focused: true,
});
const system: Window = { ...app('com.apple.springboard'), type: 3, layer: 1, active: false };

/** A read as an iPhone gives it: its windows, and whether an alert of the app's is up, shown or hidden. */
const read = (windows: Window[], alert?: 'Alert' | 'Sheet', visible = true): Tree => {
  const nodes: Tree['nodes'] = [{ p: -1, w: 0, c: 'Application', b: [0, 0, 390, 844], f: 1 }];
  if (alert) nodes.push({ p: 0, w: 0, c: alert, b: [40, 300, 350, 500], f: visible ? 1 : 0 });
  return { windows, nodes, truncated: false, elapsedMs: 1, hash: 'h' };
};

const changed = (then: Tree, now: Tree) => frontChanged(frontOf(then), frontOf(now));

describe('what is in front on two reads', () => {
  const shop = read([app('dev.shop')]);

  it('is the same while the app, the system and its alerts stand as they did', () => {
    expect(changed(shop, read([app('dev.shop')]))).toBe(false);
    expect(changed(read([app('dev.shop')], 'Alert'), read([app('dev.shop')], 'Alert'))).toBe(false);
    // an alert in the tree that is not shown is no alert
    expect(changed(shop, read([app('dev.shop')], 'Alert', false))).toBe(false);
  });

  it('is another once another app is in front', () => {
    expect(changed(shop, read([app('com.apple.mobilesafari')]))).toBe(true);
  });

  it('is another once a window of the system came over the app, or went', () => {
    expect(changed(shop, read([app('dev.shop'), system]))).toBe(true);
    expect(changed(read([app('dev.shop'), system]), shop)).toBe(true);
  });

  it('is another once an alert or a sheet of the app came up, or went away', () => {
    expect(changed(shop, read([app('dev.shop')], 'Alert'))).toBe(true);
    expect(changed(shop, read([app('dev.shop')], 'Sheet'))).toBe(true);
    expect(changed(read([app('dev.shop')], 'Alert'), shop)).toBe(true);
  });

  it('says nothing of the app where a read names none', () => {
    expect(changed(read([]), shop)).toBe(false);
    expect(changed(shop, read([]))).toBe(false);
  });
});
