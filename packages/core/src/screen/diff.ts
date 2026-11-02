import type { UiElement } from './elements.js';
import { fold } from './fold.js';
import type { Platform, ScreenElement } from './model.js';

/** One element as the screen view shows it: ref, role, "label", id=<id> without a label, x,y, flags. */
export function elementLine(e: ScreenElement, clean: (s: string) => string = (s) => s): string {
  return [
    e.ref,
    e.role,
    JSON.stringify(clean(e.label)),
    ...(!e.label && e.id ? [`id=${clean(e.id)}`] : []),
    `${e.x},${e.y}`,
    ...e.flags,
    ...(e.refContext ? [`— ${clean(e.refContext)}`] : []),
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
    ...d.removed.map((e) => `- ${e.ref} ${JSON.stringify(clean(e.label))}`),
    ...d.changed.map(
      ({ now, was }) =>
        `~ ${elementLine(now, clean)}${was.label !== now.label ? ` (was ${JSON.stringify(clean(was.label))})` : ''}`,
    ),
  ].join('\n');
}

export type AlertAction = 'allow' | 'deny';

/**
 * The words of a system prompt's allow and deny buttons (the device's language), matched on the label
 * as `fold` gives it. English by default; a caller testing in another language passes its own. Without
 * a match the button is picked by its place in the prompt (see alertButton).
 */
export type AlertWords = { allow: RegExp; deny: RegExp };
export const ALERT_WORDS: AlertWords = {
  allow:
    /^(allow|allow while using( the)? app|allow once|allow full access|while using the app|only this time)$/,
  deny: /^(don[’']t allow|ask app not to track)$/,
};
const PERMISSION_PACKAGES = /^com\.(google\.)?android\.permissioncontroller$/;
const ANDROID_ALLOW = /:id\/permission_allow(_foreground_only|_one_time)?_button$/;
const ANDROID_DENY = /:id\/permission_deny(_and_dont_ask_again)?_button$/;
/** The home screen app, whose alerts are the system's (permission prompts), never the app's own. */
const IOS_SYSTEM = 'com.apple.springboard';

/**
 * The button of a system permission prompt for `action`: on Android a permission controller's allow or
 * deny button (by id, any language); on iOS a button of an Alert of the home screen app (never an app's
 * own dialog), by `words`, else by its place: of two buttons deny is the first and allow the last; of
 * three or more (location, photos: once / while using / don't) allow is the second and deny the last.
 * Undefined when no such prompt is up.
 */
// shortcut: ids of the stock permission controller; add an OEM's when a device shows another
export function alertButton(
  elements: UiElement[],
  platform: Platform,
  action: AlertAction,
  words: AlertWords = ALERT_WORDS,
): { label: string; x: number; y: number } | undefined {
  const text = (e: UiElement) => (e.label || e.text || e.name || '').trim();
  const at = (e: UiElement | undefined) =>
    e?.rect && {
      label: text(e),
      x: Math.round(e.rect.x + e.rect.width / 2),
      y: Math.round(e.rect.y + e.rect.height / 2),
    };
  if (platform === 'android')
    return at(
      elements.find((e) => {
        const id = e.identifier ?? '';
        const pkg = /^([\w.]+):id\//.exec(id)?.[1] ?? '';
        return (
          !!e.rect &&
          PERMISSION_PACKAGES.test(pkg) &&
          (action === 'allow' ? ANDROID_ALLOW : ANDROID_DENY).test(id)
        );
      }),
    );
  const isUnder = (i: number, p: number): boolean => {
    for (let q = elements[i]!.parent; q !== undefined; q = elements[q]!.parent)
      if (q === p) return true;
    return false;
  };
  const alert = elements.findIndex((e) => /alert$/i.test(e.type) && e.pkg === IOS_SYSTEM);
  if (alert < 0) return undefined;
  const buttons = elements.filter(
    (e, i) => /button$/i.test(e.type) && !!e.rect && isUnder(i, alert),
  );
  const re = action === 'allow' ? words.allow : words.deny;
  const byWord = buttons.find((b) => re.test(fold(text(b))));
  if (byWord) return at(byWord);
  if (buttons.length < 2) return undefined;
  // allow is the second button either way; deny the first of two, the last of more
  return at(action === 'allow' ? buttons[1] : buttons.length === 2 ? buttons[0] : buttons.at(-1));
}
