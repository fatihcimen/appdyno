import { must } from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
import { meant, plainText, sameContent } from './simtree.js';

type Node = Tree['nodes'][number];

/** A part of the screen by its name, and a layout's nodes that are not of it. */
export type Region = { name: string; rest: (l: Node[]) => Node[] };

/** No one part under half the screen holds what differs. */
export const WHOLE: Region = { name: '', rest: (l) => l };

const kind = (n: Node) => `${n.c}#${n.id ?? ''}`;

/** A node as the layout digest has it. */
const key = (n: Node) =>
  kind(n) + (plainText(n) ? `@${n.b[1]},${n.b[3]}` : `@${n.b[0]},${n.b[1]},${n.b[2]},${n.b[3]}`);

/** The nodes that are not under the one at `holder`: a view comes before what it holds. */
function outside(l: Node[], holder: number): Node[] {
  if (holder < 0) return l;
  const under: boolean[] = [];
  return l.filter((n, i) => {
    under[i] = n.p >= 0 && n.p < i && (n.p === holder || under[n.p] === true);
    return !under[i];
  });
}

/**
 * The one part of the screen that holds every node which moved, came or went between two reads (RunnerCore's
 * `Region.between`, over what the host's settle compares); WHOLE where there is none, undefined where the screens
 * are the same. The lowest view that holds them, itself in place in both and under half the screen; where that
 * view is the screen, the strip across the screen they lie in, under half its height.
 */
export function regionBetween(a: Node[], b: Node[]): Region | undefined {
  if (sameContent(a, b)) return undefined;
  const screen = a[0];
  const differ = (l: Node[], other: Node[]) => {
    const there = new Set(other.filter(meant).map(key));
    return l.filter((n) => meant(n) && !there.has(key(n)));
  };
  const inA = differ(a, b);
  const inB = differ(b, a);
  const first = inA[0] ?? inB[0];
  if (!screen || !first) return WHOLE;
  const l = inA.length ? a : b;
  for (let up = first.p; up >= 0; up = must(l[up], 'a view').p) {
    const name = key(must(l[up], 'a view'));
    const at = (x: Node[]) => x.findIndex((n) => key(n) === name);
    const rest = (x: Node[]) => outside(x, at(x));
    const view = a[at(a)];
    if (!view || at(b) < 0 || !sameContent(rest(a), rest(b))) continue;
    const area = (n: Node) => (n.b[2] - n.b[0]) * (n.b[3] - n.b[1]);
    if (area(view) * 2 <= area(screen)) return { name, rest };
    break;
  }
  const moved = [...inA, ...inB];
  const top = Math.min(...moved.map((n) => n.b[1]));
  const bottom = Math.max(...moved.map((n) => n.b[3]));
  if ((bottom - top) * 2 > screen.b[3] - screen.b[1]) return WHOLE;
  const kinds = new Set(moved.map(kind));
  const rest = (x: Node[]) =>
    x.filter((n) => !(kinds.has(kind(n)) && n.b[1] >= top && n.b[3] <= bottom));
  if (!sameContent(rest(a), rest(b))) return WHOLE;
  return { name: `${[...kinds].sort().join(',')}|${String(top)},${String(bottom)}`, rest };
}

export const CYCLE_MS = 1_000;

export const GAP_MS = 300;

export const KEPT_MS = 30_000;

/** What an action of ours set moving, a row a swipe threw, is over within this: a settle's own cap. */
export const OWN_MS = 3_000;

/**
 * A part of the screen that keeps changing by itself, as a banner that turns: RunnerCore's `Cycling`, held to it by
 * `runner-rules.json`. Reads that differ under one part only, never GAP_MS between one's end and the next's start,
 * for CYCLE_MS make it known to cycle, and from then a change under it alone is none, for KEPT_MS after it last moved.
 */
export class Cycling {
  private moving: string | undefined;
  private since = 0;
  private movedAt = 0;
  private known: Region | undefined;
  private knownAt = 0;

  /**
   * Whether a read is the one before it to a settle: `region` is `regionBetween` of the two, the read began at
   * `readAt` and it is `now`. `byItself`: no action of ours set moving what moves now: only then can reads make a
   * part known.
   */
  same(region: Region | undefined, byItself: boolean, readAt: number, now: number): boolean {
    if (!region) return true;
    if (!region.name) {
      this.moving = undefined;
      return false;
    }
    if (region.name === this.known?.name && now - this.knownAt <= KEPT_MS) {
      this.knownAt = now;
      return true;
    }
    if (!byItself) return false;
    if (region.name !== this.moving || readAt - this.movedAt > GAP_MS) {
      this.moving = region.name;
      this.since = readAt;
    }
    this.movedAt = now;
    if (now - this.since < CYCLE_MS) return false;
    this.known = region;
    this.knownAt = now;
    return true;
  }

  /** A layout's nodes without what the part known to cycle holds. */
  rest(l: Node[], now: number): Node[] {
    return this.known && now - this.knownAt <= KEPT_MS ? this.known.rest(l) : l;
  }
}
