import type { UiElement } from './elements.js';
import { must } from '../must.js';
import { screenElements } from './model.js';
import type { ScreenOptions } from './port.js';

/** FNV-1a of `text` in base36, always 7 characters (the 32-bit range): the long form of a ref. */
export function refHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}
/** The short form: the hash's last 4 characters (its low digits spread evenly). */
const short = (text: string) => refHash(text).slice(-4);

const ownText = (e: UiElement) => (e.label || e.text || '').trim();

/**
 * What tells element `i` apart from identical ones: the nearest ancestor's text that is unique on the
 * screen (a product card's name for its "Ekle" button), else the nearest unique text on its row, else
 * none. Never a position: a scroll moves it, the card's name stays.
 */
function contextOf(
  elements: UiElement[],
  i: number,
  unique: Set<string>,
  children: Map<number, number[]>,
): string | undefined {
  const at = (n: number) => must(elements[n], `element ${n}`);
  const self = ownText(at(i));
  const below = (n: number): number[] => (children.get(n) ?? []).flatMap((c) => [c, ...below(c)]);
  for (let p = at(i).parent; p !== undefined; p = at(p).parent) {
    // the screen's root holds every text: no context of a card
    if (at(p).parent === undefined) break;
    const texts = below(p)
      .map((n) => ownText(at(n)))
      .filter((t) => t && t !== self && unique.has(t));
    // a name rather than a price or a count: those change on the same card
    const text = texts.find((t) => !/\d/.test(t)) ?? texts[0];
    if (text) return text;
  }
  const r = at(i).rect;
  if (!r) return undefined;
  const cy = r.y + r.height / 2;
  const row = elements
    .flatMap((e) =>
      e.rect && ownText(e) && ownText(e) !== self && unique.has(ownText(e))
        ? [{ e, rect: e.rect }]
        : [],
    )
    .filter(({ rect }) => Math.abs(rect.y + rect.height / 2 - cy) <= Math.max(r.height, 20))
    .sort((a, b) => Math.abs(a.rect.x - r.x) - Math.abs(b.rect.x - r.x))[0];
  return row ? ownText(row.e) : undefined;
}

/**
 * The tree with stable refs in place of positional ones, so a ref read before an action names the same
 * element after it. A ref is `@` and 4 characters of a hash of what the element is: its role and id when
 * the id is unique on the screen (a price may change under it), else role, id and label, else role and
 * label; an element without either, or one of several identical ones, adds the text that tells it apart
 * (its card's name), so a scroll keeps the ref on the same product and a changed card is a new ref.
 * Identities that still repeat get `-2`, `-3` in tree order; two identities with the same 4 characters
 * both take the 7-character form. Elements the app's screen does not show keep no ref.
 */
export function withStableRefs(elements: UiElement[], opts: ScreenOptions): UiElement[] {
  const list = screenElements(elements, opts, true);
  const index = new Map(elements.map((e, i) => [e.ref, i]));
  const children = new Map<number, number[]>();
  elements.forEach((e, i) => {
    if (e.parent !== undefined) children.set(e.parent, [...(children.get(e.parent) ?? []), i]);
  });
  const count = <T>(xs: T[]) => {
    const m = new Map<T, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const texts = count(
    elements
      .filter((e) => e.rect)
      .map(ownText)
      .filter(Boolean),
  );
  const unique = new Set([...texts].filter(([, n]) => n === 1).map(([t]) => t));
  const idCount = count(list.flatMap((e) => (e.id ? [e.id] : [])));
  const based = list.map((e) => ({
    e,
    base:
      e.id && idCount.get(e.id) === 1
        ? `${e.role}#${e.id}`
        : e.id
          ? `${e.role}#${e.id}"${e.label}"`
          : e.label
            ? `${e.role}"${e.label}"`
            : `${e.role}@`,
  }));
  const repeated = count(based.map(({ base }) => base));
  const keyed = based.map(({ e, base }) => {
    const context =
      (repeated.get(base) ?? 0) > 1 || base.endsWith('@')
        ? contextOf(elements, must(index.get(e.ref), e.ref), unique, children)
        : undefined;
    // no context: a nameless element falls back to its path or position name
    const key =
      context !== undefined ? `${base}|${context}` : base.endsWith('@') ? `${base}${e.name}` : base;
    return { e, key, context };
  });
  const shortOwners = new Map<string, Set<string>>();
  for (const { key } of keyed)
    shortOwners.set(short(key), (shortOwners.get(short(key)) ?? new Set()).add(key));
  const seen = new Map<string, number>();
  const byOld = new Map<string, { ref: string; context?: string }>();
  for (const { e, key, context } of keyed) {
    const nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, nth);
    const id = (shortOwners.get(short(key))?.size ?? 0) > 1 ? refHash(key) : short(key);
    byOld.set(e.ref, {
      ref: `@${id}${nth > 1 ? `-${nth}` : ''}`,
      ...(context !== undefined && { context }),
    });
  }
  return elements.map(({ ref, refContext: _old, ...el }) => {
    const stable = ref ? byOld.get(ref) : undefined;
    return stable
      ? { ...el, ref: stable.ref, ...(stable.context && { refContext: stable.context }) }
      : el;
  });
}
