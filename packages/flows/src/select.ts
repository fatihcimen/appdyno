import { must, selectIn, type Screen, type ScreenElement } from '@appdyno/core';
import type { FlowSelector } from './format.js';

/** The roles both platforms give a control alike; the others (`tappable`, a class name) may not match on another. */
const PORTABLE_ROLE = /^(button|link|switch|checkbox|radio|textField|slider|tab)$/;
/** Android's own views' ids (`android:id/button1` is whichever button a dialog has first): not the app's name for anything. */
const FRAMEWORK_ID = 'android:id/';
/** At most this share of the screen: a tap at any point of it does what a tap at its centre does. */
const POINT_AREA = 0.25;

export type Chosen = { selector: FlowSelector; ambiguous?: number };

/**
 * The selector that names `e` on this screen, judged by the matching replay will use: its id, else its
 * role and text, else its text, whichever alone finds `e`. Else the first of them with `e`'s index, and
 * how many it had to choose from. A field's own text is never its name: it changes as it is typed in.
 */
export function bestSelector(screen: Pick<Screen, 'list' | 'elements'>, e: ScreenElement): Chosen {
  const el = screen.elements.find((x) => x.ref === e.ref);
  const id = e.id && !(el?.identifier ?? '').startsWith(FRAMEWORK_ID) ? e.id : undefined;
  const volatile = e.role === 'textField' && !!el?.text;
  const text = e.label && !volatile ? e.label : undefined;
  const candidates: FlowSelector[] = [
    ...(id ? [{ id }] : []),
    ...(text && PORTABLE_ROLE.test(e.role) ? [{ role: e.role, text }] : []),
    ...(text ? [{ text }] : []),
  ];
  const hits = (c: FlowSelector) => selectIn(screen.list, c);
  const unique = candidates.find((c) => hits(c).length === 1 && hits(c)[0]?.ref === e.ref);
  if (unique) return { selector: unique };
  const within = must(
    [...candidates, { role: e.role }].find((c) => hits(c).some((x) => x.ref === e.ref)),
    `${e.ref} on the screen it was chosen from`,
  );
  const among = hits(within);
  return {
    selector: { ...within, index: among.findIndex((x) => x.ref === e.ref) },
    ambiguous: among.length,
  };
}

const area = (e: ScreenElement) => e.rect.width * e.rect.height;

/** The smallest element holding a point. */
export const elementUnder = (list: ScreenElement[], p: { x: number; y: number }) =>
  list
    .filter(
      (e) =>
        p.x >= e.rect.x &&
        p.x <= e.rect.x + e.rect.width &&
        p.y >= e.rect.y &&
        p.y <= e.rect.y + e.rect.height,
    )
    .sort((a, b) => area(a) - area(b))[0];

/**
 * The element a point is on, when a tap at its centre would do the same: the smallest one holding it,
 * not a slider (where on it is the point) and not a large area (a pad, a canvas, a map).
 */
export function elementAt(
  list: ScreenElement[],
  p: { x: number; y: number },
  size: { w: number; h: number },
): ScreenElement | undefined {
  const under = elementUnder(list, p);
  if (!under || under.role === 'slider' || area(under) > POINT_AREA * size.w * size.h)
    return undefined;
  return under;
}
