import { describe, expect, it } from 'vitest';
import { readingOrder, withFamily, type ScreenElement, type UiElement } from '../src/index.js';

const rect = { x: 0, y: 0, width: 10, height: 10 };

/** A tree by its parents, each element with a ref of its place: `n0`, `n1`, and so on. */
const treeOf = (...of: (Partial<UiElement> | undefined)[]): UiElement[] =>
  of.map((e, i) => ({ type: 'View', rect, ref: `n${i}`, ...e }));

const listed = (...refs: string[]): ScreenElement[] =>
  refs.map((ref) => ({
    ref,
    role: 'button',
    label: ref,
    name: ref,
    nameKind: 'label',
    rect,
    x: 5,
    y: 5,
    flags: [],
  }));

describe('the order a screen reader goes through a tree', () => {
  it('is each element and then what it holds, whatever order the list has them in', () => {
    // as an iPhone lists them: every root's children before any of their own
    const els = treeOf(
      {},
      { parent: 0 },
      { parent: 0 },
      { parent: 1 },
      { parent: 2 },
      { parent: 1 },
    );
    expect(readingOrder(els)).toEqual([0, 1, 3, 5, 2, 4]);
  });

  it('moves an element that names another to be read before or after, with what it holds', () => {
    const els = treeOf(
      {},
      { parent: 0 },
      { parent: 0, traversalBefore: 1 },
      { parent: 2 },
      { parent: 0 },
      { parent: 0, traversalAfter: 2 },
    );
    expect(readingOrder(els)).toEqual([0, 2, 3, 5, 1, 4]);
  });

  it('leaves in place one that names itself or what it holds', () => {
    const els = treeOf({}, { parent: 0, traversalAfter: 2 }, { parent: 1 }, { traversalBefore: 3 });
    expect(readingOrder(els)).toEqual([0, 1, 2, 3]);
  });
});

describe('a list with what the tree tells of each element', () => {
  const els = treeOf(
    { pkg: 'dev.app' },
    { parent: 0, pkg: 'dev.app' },
    { parent: 1, pkg: 'dev.app', notImportant: true },
    { parent: 2, pkg: 'dev.app', screenReaderFocusable: true },
    { parent: 0, pkg: 'dev.app', traversalBefore: 1 },
  );

  it('names the nearest ancestor that is listed, past the ones the list left out', () => {
    const out = withFamily(listed('n1', 'n3', 'n4'), els);
    // n3's own parent, n2, is not listed: n1 is the nearest that is
    expect(out.map((e) => e.parent)).toEqual([undefined, 0, undefined]);
    expect(out.every((e) => e.pkg === 'dev.app')).toBe(true);
  });

  it('carries what Android says of accessibility, and no flag where it says nothing', () => {
    const [skipped, unit, plain] = withFamily(listed('n2', 'n3', 'n4'), els);
    expect(skipped).toMatchObject({ notImportant: true });
    expect(unit).toMatchObject({ screenReaderFocusable: true });
    expect(plain).not.toHaveProperty('notImportant');
    expect(plain).not.toHaveProperty('screenReaderFocusable');
  });

  it('places each among the listed in the order they are read, from 0', () => {
    const out = withFamily(listed('n1', 'n3', 'n4'), els);
    expect(Object.fromEntries(out.map((e) => [e.ref, e.order]))).toEqual({ n4: 0, n1: 1, n3: 2 });
  });

  it('gives an element the tree does not hold, as the keyboard, nothing', () => {
    const [keyboard] = withFamily(listed('@keyboard'), els);
    expect(keyboard).toEqual(listed('@keyboard')[0]);
  });
});
