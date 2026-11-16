import { must } from '@appdyno/core';
import { NODE_FLAGS, type Tree } from '@appdyno/protocol';
import { TOLERANCE, shown } from './simtree.js';

type Node = Tree['nodes'][number];

/** How long a control's copies stand at a new place before they are asked of again (RunnerCore's `copiesStillMs`). */
export const COPIES_STILL_MS = 300;

/**
 * The controls found more than once in the app's window, by index, in the screen's order (RunnerCore's
 * `repeatedControls`): a control drawn twice comes in 2 or 3; an id repeated more is a list's rows.
 */
export function repeatedControls(nodes: Node[]): number[][] {
  const groups = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    if (n.w !== 0 || (n.f & NODE_FLAGS.visible) === 0 || n.id === undefined) return;
    const key = `${n.c}#${n.id}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  return [...groups.values()].filter((g) => g.length === 2 || g.length === 3);
}

/** What a group of copies is known by: the control and how many of it there are (RunnerCore's `copiesId`). */
export function copiesId(nodes: Node[], copies: number[]): string {
  const first = must(nodes[must(copies[0], 'a copy')], 'a node');
  return `${first.c}#${first.id ?? ''}#${String(copies.length)}`;
}

/** The same boxes in the same order, each edge within the layout's tolerance (RunnerCore's `samePlaces`). */
export const samePlaces = (a: number[][], b: number[][]) =>
  a.length === b.length &&
  a.every((box, i) => {
    const match = must(b[i], 'a box');
    return (
      box.length === match.length &&
      box.every((edge, j) => Math.abs(edge - must(match[j], 'an edge')) <= TOLERANCE)
    );
  });

/**
 * What lies over the copies found out of reach, `hidden` by index: every other shown node that meets one, by type and
 * id and no place (RunnerCore's `coverKey`). A cover that leaves changes it; what moves over a copy in reach does not.
 */
export function coverKey(nodes: Node[], hidden: number[]): string {
  const boxes = hidden.map((i) => must(nodes[i], 'a node').b);
  const over = (n: Node) =>
    boxes.some((b) => n.b[0] < b[2] && b[0] < n.b[2] && n.b[1] < b[3] && b[1] < n.b[3]);
  return nodes
    .filter((n, i) => !hidden.includes(i) && shown(n) && over(n))
    .map((n) => `${n.c}#${n.id ?? ''}`)
    .join(';');
}

/**
 * What was said of one control's copies (RunnerCore's `CopiesVerdict`): where they stood then, which of them, in the
 * screen's order, a tap does not reach, what lay over those, and where the last read had them, since when.
 */
export type CopiesVerdict = {
  places: number[][];
  hidden: number[];
  cover: string;
  seen: number[][];
  since: number;
};

export const copiesVerdict = (
  places: number[][],
  hidden: number[],
  cover: string,
  at: number,
): CopiesVerdict => ({ places, hidden, cover, seen: places, since: at });

/**
 * Whether to ask again, for a read at `at` ms with the copies at `places` under `cover`. Not while they stand as
 * asked. Copies that moved, or lost their cover, are asked of once they stand still: where a read `COPIES_STILL_MS`
 * earlier had them, or as a settle found the screen (`still`). Until then the verdict holds by their order: a carousel
 * that never stops had a new place at every read, and was asked of at each.
 */
export function copiesStale(
  v: CopiesVerdict,
  places: number[][],
  cover: string,
  at: number,
  still = false,
): boolean {
  if (!samePlaces(places, v.seen)) {
    v.seen = places;
    v.since = at;
  }
  if (samePlaces(places, v.places) && cover === v.cover) return false;
  return still || at - v.since >= COPIES_STILL_MS;
}
