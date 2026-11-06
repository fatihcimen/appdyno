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

  it('has the tiles for its series, in either look', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => css(light, `s${n}`))).toEqual(
      many(side('kLight'), 'tiles', 6),
    );
    expect(many(side('kDark'), 'tiles', 6)).toEqual(many(side('kLight'), 'tiles', 6));
  });
});
