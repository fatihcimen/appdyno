import { describe, expect, it } from 'vitest';
import {
  byRef,
  comparedWith,
  landing,
  oneOf,
  refName,
  touchPoint,
  withShownWords,
  type ScreenElement,
} from '../src/screen/index.js';

const el = (
  ref: string,
  label: string,
  [x, y, width, height]: [number, number, number, number],
  over: Partial<ScreenElement> = {},
): ScreenElement => ({
  ref,
  role: 'button',
  label,
  name: label,
  nameKind: 'label',
  rect: { x, y, width, height },
  x: Math.round(x + width / 2),
  y: Math.round(y + height / 2),
  flags: ['clickable'],
  ...over,
});

describe('the one element of several matches', () => {
  const row = el('@row', 'Wi-Fi', [0, 100, 400, 60]);
  const text = el('@text', 'Wi-Fi', [20, 110, 100, 40], { role: 'text', flags: [] });

  it('is the control that holds its own text of the same words', () => {
    expect(oneOf([row, text])).toBe(row);
    expect(oneOf([text, row])).toBe(row);
  });

  it('is the control whose own text stands a point out of it, as frames rounded apart do', () => {
    // the keyboard's first-use sheet on an iOS 26.5 simulator, as it was read
    const button = el('@button', 'Continue', [60, 818, 282, 21]);
    const label = el('@label', 'Continue', [165, 817, 73, 22], { role: 'text', flags: [] });
    expect(oneOf([button, label])).toBe(button);
    expect(oneOf([label, button])).toBe(button);
    // one that stands further out is another thing of the same words
    const apart = el('@apart', 'Continue', [165, 810, 73, 22], { role: 'text', flags: [] });
    expect(oneOf([button, apart])).toBeUndefined();
  });

  it('is the one a touch acts on of two that take the same box, as a web link and its text', () => {
    const words = el('@words', 'Nika riots', [10, 10, 80, 20], { flags: ['web'] });
    const link = el('@link', 'Nika riots', [10, 10, 80, 20], { flags: ['web', 'clickable'] });
    expect(oneOf([words, link])).toBe(link);
    expect(oneOf([link, words])).toBe(link);
  });

  it('is none of two that stand apart, and the one an index names', () => {
    const other = el('@other', 'Wi-Fi', [0, 300, 400, 60]);
    expect(oneOf([row, other])).toBeUndefined();
    expect(oneOf([row, other], 1)).toBe(other);
    expect(oneOf([row, other], 2)).toBeUndefined();
    expect(oneOf<typeof row>([])).toBeUndefined();
  });
});

describe('where a touch on an element goes', () => {
  it('is its middle where nothing smaller has it', () => {
    const save = el('@save', 'Save', [0, 0, 200, 60]);
    expect(touchPoint(save, [save])).toEqual({ point: { x: 100, y: 30 } });
  });

  it('is clear of a smaller control of other words at its middle, along its long side', () => {
    const player = el('@player', 'Now playing', [0, 800, 400, 80]);
    const pause = el('@pause', 'Pause', [170, 810, 60, 60]);
    expect(touchPoint(player, [player, pause])).toEqual({
      point: { x: 100, y: 840 },
      why: 'clear',
      other: pause,
    });
    const tall = el('@tall', 'Now playing', [0, 0, 80, 400]);
    const middle = el('@middle', 'Pause', [10, 170, 60, 60]);
    expect(touchPoint(tall, [tall, middle]).point).toEqual({ x: 40, y: 100 });
  });

  it('stays at the middle where no point is clear, and says whose it is', () => {
    const bar = el('@bar', 'Player', [0, 0, 400, 80]);
    const wide = el('@wide', 'Pause', [0, 10, 400, 30]);
    expect(touchPoint(bar, [bar, wide])).toEqual({
      point: { x: 200, y: 40 },
      why: 'covered',
      other: wide,
    });
  });

  it('is the own switch of a switch row, whose middle is its label', () => {
    const row = el('@row', 'Dark mode', [0, 0, 400, 60], { role: 'switch' });
    const own = el('@own', '', [320, 10, 60, 40], { role: 'switch' });
    expect(touchPoint(row, [row, own])).toEqual({
      point: { x: 350, y: 30 },
      why: 'own',
      other: own,
    });
  });

  it('is the own switch that stands out of its row, as an iOS 26 Settings row holds it', () => {
    const row = el('@row', 'Increase Contrast', [36, 541, 330, 28], { role: 'switch' });
    const words = el('@words', 'Increase Contrast', [36, 544, 135, 21]);
    const own = el('@own', '0', [305, 541, 63, 28], { role: 'switch' });
    expect(touchPoint(row, [row, words, own])).toEqual({
      point: { x: 337, y: 555 },
      why: 'own',
      other: own,
    });
    // the cell around them is touched on that switch too, the innermost of the two it holds
    const cell = el('@cell', 'Increase Contrast 0', [20, 528, 362, 53], { role: 'cell' });
    expect(touchPoint(cell, [cell, row, words, own])).toEqual({
      point: { x: 337, y: 555 },
      why: 'own',
      other: own,
    });
    // a cell of two switches that stand apart has no one switch of its own
    const left = el('@left', '0', [40, 541, 63, 28], { role: 'switch' });
    expect(touchPoint(cell, [cell, left, own]).why).toBeUndefined();
    // the switch of the next row is not this row's
    const next = el('@next', '0', [305, 657, 63, 28], { role: 'switch' });
    expect(touchPoint(row, [row, next]).why).toBeUndefined();
  });

  it('is the middle of a control whose smaller one says words of its own', () => {
    const card = el('@card', 'Order 42 Details', [0, 0, 400, 80]);
    const inner = el('@inner', 'Details', [170, 10, 60, 60]);
    expect(touchPoint(card, [card, inner])).toEqual({ point: { x: 200, y: 40 } });
    const cut = el('@cut', 'Order 42…', [0, 0, 400, 80], { whole: 'Order 42 Details' });
    expect(touchPoint(cut, [cut, inner]).why).toBeUndefined();
  });

  it('is the middle of what is not a listed control: plain words, a web element, one not of the list', () => {
    const pause = el('@pause', 'Pause', [170, 10, 60, 60]);
    const words = el('@words', 'Now playing', [0, 0, 400, 80], { flags: [] });
    expect(touchPoint(words, [words, pause]).why).toBeUndefined();
    const web = el('@web', 'Now playing', [0, 0, 400, 80], { flags: ['web', 'clickable'] });
    expect(touchPoint(web, [web, pause]).why).toBeUndefined();
    const player = el('@player', 'Now playing', [0, 0, 400, 80]);
    expect(touchPoint({ ...player }, [player, pause]).why).toBeUndefined();
  });

  it("is the end of a wrapped web link's first line", () => {
    const web = (label: string, box: [number, number, number, number]) =>
      el(`@${label}`, label, box, { role: 'text', flags: ['web', 'clickable'] });
    const page = [
      web('built during', [162, 1776, 630, 50]),
      web('Justinian I', [788, 1776, 189, 50]),
    ];
    const link = web('Hagia Sophia', [43, 1712, 903, 115]);
    expect(landing(link, [...page, link])).toEqual({ x: 934, y: 1737 });
    expect(touchPoint(link, [...page, link])).toEqual({ point: { x: 934, y: 1737 } });
  });
});

describe('the element of a ref', () => {
  const save = el('@save', 'Save', [0, 0, 200, 60]);
  const screen = {
    list: [save],
    elements: [
      {
        type: 'android.widget.FrameLayout',
        ref: '@box',
        rect: { x: 0, y: 100, width: 300, height: 201 },
      },
      { type: 'Other', ref: '@nowhere' },
    ],
  };

  it('is the listed one, else one the list leaves out, at its middle and with no words', () => {
    expect(byRef(screen, '@save')).toBe(save);
    expect(byRef(screen, '@box')).toMatchObject({
      ref: '@box',
      label: '',
      x: 150,
      y: 201,
      flags: [],
    });
    expect(byRef(screen, '@nowhere')).toBeUndefined();
    expect(byRef(screen, '@gone')).toBeUndefined();
  });
});

describe("an element's name at a touch", () => {
  it('is its ref and its words', () => {
    expect(refName('@a1', 'Play "now"')).toBe('@a1 "Play \\"now\\""');
  });

  it('says the words it was shown with where they are not its words now', () => {
    expect(withShownWords('@a1 "Close 720p60"', '@a1', 'Play 02:37')).toBe(
      '@a1 "Close 720p60" (shown as "Play 02:37")',
    );
  });

  it('is left as it is with the same words, with a note after them, and with nothing shown', () => {
    expect(withShownWords('@a1 "Play"', '@a1', 'Play')).toBe('@a1 "Play"');
    expect(
      withShownWords('@a1 "Play" at 10,20, clear of @b "Pause" at its middle', '@a1', 'Play'),
    ).toBe('@a1 "Play" at 10,20, clear of @b "Pause" at its middle');
    expect(withShownWords('@a1 "Play"', '@a1', undefined)).toBe('@a1 "Play"');
    // words that only begin the same are other words
    expect(withShownWords('@a1 "Player"', '@a1', 'Play')).toBe('@a1 "Player" (shown as "Play")');
  });
});

describe('the read a touch is compared with', () => {
  it('is the one its selector was found on, where the touch names a read at all', () => {
    expect(comparedWith({ before: 'old', read: 'tree' }, 'new')).toEqual({
      before: 'new',
      read: 'tree',
    });
    expect(comparedWith({ before: 'old' }, 'new', 'new')).toEqual({ before: 'new' });
  });

  it('stays the one before the call for a ref or a point, for targets of two reads, and with none named', () => {
    const opts = { before: 'old' };
    expect(comparedWith(opts, undefined)).toBe(opts);
    expect(comparedWith(opts)).toBe(opts);
    expect(comparedWith(opts, 'new', 'newer')).toBe(opts);
    expect(comparedWith(opts, 'new', undefined)).toBe(opts);
    expect(comparedWith({}, 'new')).toEqual({});
  });
});
