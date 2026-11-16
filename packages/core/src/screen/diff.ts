import { cutAt, shownLabel, type ScreenElement } from './model.js';

/** What JSON leaves as it is and a reader may still take for the end of a line: C1 controls, the line and paragraph separators. */
const ENDS_A_LINE = /[\u007f-\u009f\u2028\u2029]/g;
const ANY_CONTROL = /[\p{Cc}\u2028\u2029]/u;

/**
 * What an app wrote, in quotes on one line. An app's words are its own, and an answer is read by a model: a label with
 * a line break in it would else stand as a line of the answer, an element or a result the app made up.
 */
export const quoted = (s: string) =>
  JSON.stringify(s).replace(
    ENDS_A_LINE,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );

/** An app's words where a line has them unquoted, as what tells two rows apart: quoted if they could end the line. */
export const onLine = (s: string) => (ANY_CONTROL.test(s) ? quoted(s) : s);

/** An id or a role an app gave, bare where it is a name and nothing else (a secret hidden in it aside), else quoted. */
export const asName = (s: string) => (/^[\w.:/#$•-]+$/.test(s) ? s : quoted(s));

/** As much of what a field holds as a line says. */
const MAX_VALUE = 60;

/** One element as the screen view shows it: ref, role, "label", ="what a named field holds", id=<id> without a label, x,y, flags. */
export function elementLine(e: ScreenElement, clean: (s: string) => string = (s) => s): string {
  return [
    e.ref,
    asName(e.role),
    quoted(shownLabel(e, clean)),
    // hidden of secrets while whole, then cut, as a label is
    ...(e.value ? [`=${quoted(cutAt(clean(e.value), MAX_VALUE))}`] : []),
    ...(!e.label && e.id ? [`id=${asName(clean(e.id))}`] : []),
    `${e.x},${e.y}`,
    ...e.flags,
    ...(e.refContext ? [`— ${onLine(clean(e.refContext))}`] : []),
  ].join(' ');
}

export const screenHeader = (n: number) => `${n} elements: ref role "label" x,y flags`;

export const renderScreen = (list: ScreenElement[], clean?: (s: string) => string) =>
  [screenHeader(list.length), ...list.map((e) => elementLine(e, clean))].join('\n');

/**
 * Two reads are the same settled screen: the same elements (role, id) in the same places. Texts are left
 * out: a countdown or a carousel caption keeps ticking on a screen that has settled.
 */
export const screenStructure = (list: ScreenElement[]) =>
  list.map((e) => `${e.role}|${e.id ?? ''}|${e.x},${e.y}`).join('\n');

/** Focus comes and goes with taps and keys: a focus-only change is no screen change. */
const meaningful = (flags: string[]) => flags.filter((f) => f !== 'focused').join();

/** Moves smaller than this (tap units) are no change: rounding, a scroll indicator. */
const MOVED = 8;

export type ScreenDiff = {
  added: ScreenElement[];
  removed: ScreenElement[];
  changed: { now: ScreenElement; was: ScreenElement }[];
};

/** What the second read shows that the first did not (by ref): added, removed and changed elements. */
export function diffScreens(prev: ScreenElement[], next: ScreenElement[]): ScreenDiff {
  const before = new Map(prev.map((e) => [e.ref, e]));
  const after = new Set(next.map((e) => e.ref));
  const added: ScreenElement[] = [];
  const changed: ScreenDiff['changed'] = [];
  for (const e of next) {
    const was = before.get(e.ref);
    if (!was) added.push(e);
    else if (
      was.label !== e.label ||
      was.value !== e.value ||
      meaningful(was.flags) !== meaningful(e.flags) ||
      Math.abs(was.x - e.x) >= MOVED ||
      Math.abs(was.y - e.y) >= MOVED
    )
      changed.push({ now: e, was });
  }
  // a text whose ref is its label (no id) and that changed in place is a change, not a new element
  const removed = prev.filter((e) => !after.has(e.ref));
  const near = (a: ScreenElement, b: ScreenElement) =>
    a.role === b.role && Math.abs(a.x - b.x) < MOVED && Math.abs(a.y - b.y) < MOVED;
  for (const e of [...added]) {
    const was = removed.find((r) => near(r, e));
    if (!was) continue;
    added.splice(added.indexOf(e), 1);
    removed.splice(removed.indexOf(was), 1);
    changed.push({ now: e, was });
  }
  return { added, removed, changed };
}

/** How diffText starts when nothing changed. */
export const UNCHANGED = 'screen unchanged';

/**
 * The diff as text, or undefined when it would not be shorter than the whole screen (another screen, a
 * scroll that moved everything): the caller sends the full view then.
 */
export function diffText(
  d: ScreenDiff,
  total: number,
  clean: (s: string) => string = (s) => s,
): string | undefined {
  const n = d.added.length + d.removed.length + d.changed.length;
  if (n === 0) return `${UNCHANGED} (${total} elements)`;
  if (n >= Math.max(4, total * 0.6)) return undefined;
  return [
    `screen changed: +${d.added.length} -${d.removed.length} ~${d.changed.length} (${total} elements; ref role "label" x,y flags)`,
    ...d.added.map((e) => `+ ${elementLine(e, clean)}`),
    ...d.removed.map((e) => `- ${e.ref} ${quoted(shownLabel(e, clean))}`),
    ...d.changed.map(
      ({ now, was }) =>
        `~ ${elementLine(now, clean)}${was.label !== now.label ? ` (was ${quoted(shownLabel(was, clean))})` : ''}`,
    ),
  ].join('\n');
}
