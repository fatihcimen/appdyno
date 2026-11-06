import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_BASE } from '../src/html.js';

/** The viewer's colours are Objective-C and a page's are CSS: this is what keeps the dashboard wearing the hub's palette. */
const palette = readFileSync(join(import.meta.dirname, '../../../mirror/Viewer/Palette.m'), 'utf8');

const side = (name: string) => {
  const from = palette.indexOf(`static const MVSide ${name} = {`);
  return palette.slice(from, palette.indexOf('\n};', from));
};
const one = (block: string, field: string) =>
  `#${/0x([0-9A-F]{6})/.exec(block.slice(block.indexOf(`.${field} = `)))![1]!.toLowerCase()}`;
const many = (block: string, field: string, count: number) =>
  [...block.slice(block.indexOf(`.${field} = `)).matchAll(/0x([0-9A-F]{6})/g)]
    .slice(0, count)
    .map((m) => `#${m[1]!.toLowerCase()}`);

const linear = (hex: string) =>
  [1, 3, 5].map((at) => {
    const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
const luminance = (hex: string) => {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
};
const oklab = (hex: string) => {
  const [r, g, b] = linear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ] as [number, number, number];
};
/** How far apart two colours look, in OKLab, by 100. */
const distance = (a: string, b: string) => {
  const [p, q] = [oklab(a), oklab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100;
};

const [light, dark] = PAGE_BASE.split('@media screen and (prefers-color-scheme:dark)') as [
  string,
  string,
];
const css = (rules: string, name: string) =>
  new RegExp(`--${name}:(#[0-9a-f]{6})`).exec(rules)?.[1];

describe('the page and the viewer', () => {
  for (const [look, block, rules] of [
    ['light', side('kLight'), light],
    ['dark', side('kDark'), dark],
  ] as const) {
    it(`wear one palette, ${look}`, () => {
      expect(css(rules, 'ink')).toBe(one(block, 'ink'));
      expect(css(rules, 'ink2')).toBe(one(block, 'quiet'));
      expect(css(rules, 'series')).toBe(one(block, 'accent'));
      expect(css(rules, 'plane')).toBe(one(block, 'ground'));
      expect(css(rules, 'good')).toBe(one(block, 'good'));
      expect(css(rules, 'warning')).toBe(one(block, 'watch'));
      expect(css(rules, 'critical')).toBe(one(block, 'bad'));
      expect([1, 2, 3, 4].map((n) => css(rules, `b${n}`))).toEqual(many(block, 'blooms', 4));
    });
  }

  for (const [look, block] of [
    ['light', side('kLight')],
    ['dark', side('kDark')],
  ] as const) {
    it(`keeps a state's colour apart from every colour that only decorates, ${look}`, () => {
      const decoration = [
        ...many(block, 'hues', 6),
        ...many(block, 'tiles', 6),
        ...['accent', 'fillFrom', 'fillTo'].map((field) => one(block, field)),
      ];
      for (const state of ['good', 'watch', 'bad'].map((field) => one(block, field)))
        for (const colour of decoration)
          expect(distance(state, colour), `${colour} beside ${state}`).toBeGreaterThanOrEqual(12);
    });

    it(`holds a white symbol on every tile and on the accent's fill, ${look}`, () => {
      for (const colour of [
        ...many(block, 'tiles', 6),
        one(block, 'fillFrom'),
        one(block, 'fillTo'),
      ])
        expect(contrast('#ffffff', colour), colour).toBeGreaterThanOrEqual(3);
    });
  }

  it('has the tiles for its series, in either look', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => css(light, `s${n}`))).toEqual(
      many(side('kLight'), 'tiles', 6),
    );
    expect(many(side('kDark'), 'tiles', 6)).toEqual(many(side('kLight'), 'tiles', 6));
  });
});
