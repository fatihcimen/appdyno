import { toTree, type RawAx } from '../src/simtree.js';

export const SCREEN = { w: 402, h: 874 };

export const cell = (label: string, y: number, extra: Partial<RawAx> = {}): RawAx => ({
  a: 75,
  l: label,
  f: [16, y, 370, 52],
  t: '8589934592',
  ...extra,
});

export const app = (...k: RawAx[]): RawAx => ({
  a: 1,
  l: 'Settings',
  f: [0, 0, 402, 874],
  t: '0',
  k,
});

export const tree = (raw: RawAx) => {
  const r = toTree(raw, 'a.b', SCREEN, 5);
  if ('refused' in r) throw new Error(r.refused);
  return r;
};
