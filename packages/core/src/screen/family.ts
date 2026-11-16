import { must } from '../must.js';
import type { UiElement } from './elements.js';
import type { ScreenElement } from './model.js';

/**
 * The tree's elements in the order a screen reader goes through them, by their place in the list: each element, then
 * what it holds, as the tree nests them, and an Android element that names another to be read before or after
 * (`traversalBefore`, `traversalAfter`) moved there with what it holds. A screen reader may still go another way,
 * as VoiceOver does by where things are on the screen: this is the order the platform's own tree tells, and no more.
 */
export function readingOrder(elements: UiElement[]): number[] {
  const children = new Map<number | undefined, number[]>();
  elements.forEach((e, i) => children.set(e.parent, [...(children.get(e.parent) ?? []), i]));
  const under = (i: number): number[] => [i, ...(children.get(i) ?? []).flatMap(under)];
  let order = (children.get(undefined) ?? []).flatMap(under);
  elements.forEach((e, i) => {
    const before = e.traversalBefore;
    const beside = before ?? e.traversalAfter;
    if (beside === undefined) return;
    // one that names itself, or what it holds, has nowhere to move to
    const moved = new Set(under(i));
    if (moved.has(beside)) return;
    const rest = order.filter((n) => !moved.has(n));
    // after an element is after all it holds
    const at =
      before !== undefined
        ? rest.indexOf(before)
        : rest.indexOf(
            must(
              under(beside).findLast((n) => !moved.has(n)),
              'the element itself',
            ),
          ) + 1;
    if (at < 0) return;
    order = [...rest.slice(0, at), ...order.filter((n) => moved.has(n)), ...rest.slice(at)];
  });
  return order;
}

/**
 * The list with what the tree tells of each element, for a caller that walks it: `parent`, its nearest ancestor that
 * is listed too, as the list leaves out what a person neither reads nor taps; `pkg`, the app of its window;
 * `notImportant` and `screenReaderFocusable`, where Android says so; and `order`, its place among the listed in
 * `readingOrder`. An element the tree does not hold, as the keyboard listed whole, gets none.
 */
export function withFamily(list: ScreenElement[], elements: UiElement[]): ScreenElement[] {
  const inTree = new Map(elements.map((e, i) => [e.ref, i] as const));
  const listed = new Map<number, number>();
  list.forEach((e, n) => {
    const i = inTree.get(e.ref);
    if (i !== undefined) listed.set(i, n);
  });
  const rank = new Map(
    readingOrder(elements)
      .filter((i) => listed.has(i))
      .map((i, place) => [i, place] as const),
  );
  return list.map((e) => {
    const i = inTree.get(e.ref);
    const el = i === undefined ? undefined : elements[i];
    if (i === undefined || !el) return e;
    let up = el.parent;
    while (up !== undefined && !listed.has(up)) up = elements[up]?.parent;
    const parent = up === undefined ? undefined : listed.get(up);
    return {
      ...e,
      ...(parent !== undefined && { parent }),
      ...(el.pkg && { pkg: el.pkg }),
      ...(el.notImportant && { notImportant: true }),
      ...(el.screenReaderFocusable && { screenReaderFocusable: true }),
      order: must(rank.get(i), 'its place'),
    };
  });
}
