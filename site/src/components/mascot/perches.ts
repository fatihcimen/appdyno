import type { Perch } from './mind.ts';

/**
 * Where on the page the dragon may stand away from its bench: the top edges of the blocks marked
 * `data-perch`, and of each only the stretch with nothing over it. A top edge is outside its
 * block's own text by construction; what stands above the block is what this looks for.
 */

/** A box on the page. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How far apart the places tried along an edge are, and how high over it, in body heights. */
const EVERY = 0.5;
const OVER = [0.2, 0.55, 0.9];
/** The shortest stretch worth standing on, in body heights. */
const ROOM = 1.5;

/**
 * The longest stretch of a block's top edge with free room over it, as a perch, or nothing when
 * no stretch is long enough. `free` says whether a point of the page has nothing on it.
 */
export function perchOn(
  block: Box,
  size: number,
  free: (x: number, y: number) => boolean,
): Perch | undefined {
  let best: [from: number, to: number] | undefined;
  let from: number | undefined;
  const end = block.left + block.width - size / 2;
  for (let x = block.left + size / 2; ; x += size * EVERY) {
    const open = x <= end && OVER.every((over) => free(x, block.top - over * size));
    if (open) from ??= x;
    else if (from !== undefined) {
      const to = x - size * EVERY;
      if (!best || to - from > best[1] - best[0]) best = [from, to];
      from = undefined;
    }
    if (x > end) break;
  }
  if (!best || best[1] - best[0] < ROOM * size) return undefined;
  return { left: best[0], right: best[1], y: block.top };
}

/** What a visitor reads or presses: the dragon stands over none of it. */
const CONTENT =
  'a, button, input, select, textarea, summary, label, [role="button"], img, svg, canvas, video, pre, code';

/** Whether a point of the page, which must be on the screen, has no text and no control on it. */
function clear(x: number, y: number) {
  const hit = document.elementFromPoint(x - scrollX, y - scrollY);
  if (!hit || hit.closest(CONTENT)) return false;
  return ![...hit.childNodes].some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
  );
}

/**
 * The perches on the screen now, for a dragon of a height: those whose edge, with the dragon on
 * it, is wholly in view, and that the pointer is not over.
 */
export function scout(size: number, pointer: { x: number; y: number } | undefined): Perch[] {
  const perches: Perch[] = [];
  for (const block of document.querySelectorAll('[data-perch]')) {
    const { left, top, width, height } = block.getBoundingClientRect();
    if (top < size * 1.3 || top > innerHeight - size * 0.3) continue;
    if (
      pointer &&
      pointer.x >= left + scrollX &&
      pointer.x <= left + scrollX + width &&
      pointer.y >= top + scrollY - size &&
      pointer.y <= top + scrollY + height
    )
      continue;
    const perch = perchOn({ left: left + scrollX, top: top + scrollY, width, height }, size, clear);
    if (perch) perches.push(perch);
  }
  return perches;
}
