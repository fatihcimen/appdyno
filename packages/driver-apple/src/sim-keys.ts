import { must, sleep, throwIfCancelled } from '@appdyno/core';
import { NODE_FLAGS as F, type ActParams, type Tree } from '@appdyno/protocol';
import { usageOf } from './simtouch.js';

type Node = Tree['nodes'][number];
type Point = { x: number; y: number };

/** What typing by keys asks of a simulator: the helper's read of the app in front, its touch and its keys. */
export type Keyboard = {
  read: () => Promise<Tree | undefined>;
  send: (a: ActParams) => Promise<boolean>;
  keyboardOpen: (t: Tree) => boolean;
};

/** Letters and digits only: a field that formats what is typed shows "(599) 999-9900" for "5999999900". */
const lettersAndDigits = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '');

/** Whether a field holds the text typed into it, by the runner's rule (RunnerCore's `holdsText`). */
export function holdsText(now: string, before: string, text: string, replace: boolean) {
  if (replace ? now === text : now === before + text || now.includes(text)) return true;
  const held = lettersAndDigits(now);
  const typed = lettersAndDigits(text);
  return replace
    ? held === typed
    : held === lettersAndDigits(before) + typed || held.includes(typed);
}

/** Whether a US keyboard has every character of the text. */
// eslint-disable-next-line @typescript-eslint/no-misused-spread -- a key types one code point
export const typesByKeys = (text: string) => [...text].every((c) => usageOf(c));

const inside = (n: Node, p: Point) =>
  n.b[0] <= p.x && p.x <= n.b[2] && n.b[1] <= p.y && p.y <= n.b[3];
const editable = (n: Node) => (n.f & F.editable) !== 0 && (n.f & F.visible) !== 0;
const focused = (n: Node | undefined) => !!n && (n.f & F.focused) !== 0;

/** The field at a point, else the one with the focus. */
const fieldOf = (t: Tree | undefined, at?: Point) =>
  t?.nodes.find((n) => editable(n) && (at ? inside(n, at) : focused(n)));

/**
 * A new simulator's first keyboard shows its slide-to-type introduction in the keyboard's place, until a person taps
 * Continue: keys typed then go into the field.
 */
const INTRODUCED = 'UIContinuousPathIntroductionView';
const keysTaken = (k: Keyboard, t: Tree) =>
  k.keyboardOpen(t) || t.nodes.some((n) => n.id === INTRODUCED);

/** One field wherever it stands, by what it is and not by its place or what it holds. */
const sameField = (a: Node, b: Node) => a.c === b.c && a.id === b.id && a.h === b.h && a.d === b.d;

type Find = (t: Tree | undefined) => Node | undefined;

/** Between keys: with none, the fixture's field that formats what is typed lost one of ten, once in three. */
const KEY_GAP_MS = 20;
const SLOW_KEY_GAP_MS = 70;
const FOCUS_MS = 5_000;
const ECHO_MS = 1_500;
const STILL_MS = 500;
/** What is taken back key by key, a read and up to the echo wait each: more is left `verified: false`, as it is cheap. */
const TAKE_BACK_MAX = 40;

async function press(k: Keyboard, text: string, gapMs: number) {
  for (const c of text) {
    // a text of a call stopped meanwhile goes no further onto whatever came to the front
    throwIfCancelled('the text');
    const { shift } = must(usageOf(c), 'a key');
    if (!(await k.send({ kind: 'key', key: c, ...(shift && { modifiers: ['shift'] }) })))
      throw new Error('the input helper took no key');
    await sleep(gapMs);
  }
}

/** All of the field's text selected and deleted at once, as one by one would move a formatting field's cursor. */
async function clear(k: Keyboard) {
  throwIfCancelled('the text');
  await k.send({ kind: 'key', key: 'a', modifiers: ['command'] });
  await k.send({ kind: 'key', key: 'delete' });
}

/**
 * Whether the field holds the text once its keys are handled, within the echo wait. `givesUp`: one whose text has held
 * still for half a second will not. Undefined: the field is gone.
 */
async function echoed(k: Keyboard, find: Find, holds: (s: string) => boolean, givesUp: boolean) {
  const end = Date.now() + ECHO_MS;
  let last: string | undefined;
  let still = Date.now();
  for (;;) {
    const field = find(await k.read());
    if (!field) return undefined;
    const now = field.t ?? '';
    if (holds(now)) return true;
    if (now !== last) [last, still] = [now, Date.now()];
    if (Date.now() >= end || (givesUp && Date.now() - still >= STILL_MS)) return false;
    await sleep(50);
  }
}

/**
 * Text typed by the simulator's keyboard keys, as a person's hardware keyboard types it, into the field at `at` (touched
 * first unless it has the focus) or the one with the focus, and read back. Undefined, with nothing typed: no field
 * there took the focus, or a secure one, which cannot be read back, for the runner to type. `retype`: the field still
 * held other text after a second try, as keys make on a simulator whose keyboard layout is not US, and was cleared for
 * the runner, which types the text as it is in its place: the field held nothing before, or was to be replaced.
 * `append`: a field that held text, which the keys added other text to, has that taken back for the runner to type.
 */
export async function typeByKeys(
  text: string,
  opts: { at?: Point; replace?: boolean; submit?: boolean },
  k: Keyboard,
) {
  const start = Date.now();
  const { at, replace = false } = opts;
  let t = await k.read();
  let field = fieldOf(t, at);
  if (!field || (field.f & F.password) !== 0) return undefined;
  const touched = field;
  // at the point while it stands there, else by its focus: the keyboard that comes up may lift a form and bring another
  // field under the point, as a password field on a phone on its side, which the keys then went into
  const find: Find = (now) =>
    [fieldOf(now, at), fieldOf(now)].find((n) => n && sameField(n, touched));
  if (!focused(field)) {
    if (!at || !(await k.send({ kind: 'tap', ...at }))) return undefined;
    // the keys wait for that field to have the focus, and its keyboard to be up
    while (!focused(field) || !t || !keysTaken(k, t)) {
      if (Date.now() - start > FOCUS_MS) return undefined;
      await sleep(50);
      t = await k.read();
      field = find(t);
    }
  }
  const focusMs = Date.now() - start;
  const before = field?.t ?? '';
  const holds = (now: string) => holdsText(now, before, text, replace);
  // a field that formats what is typed drops a key that comes while it rewrites itself: where what it must hold is
  // known, it is typed again, slower
  const known = replace || !before;
  if (replace) await clear(k);
  await press(k, text, KEY_GAP_MS);
  let verified = await echoed(k, find, holds, known);
  if (verified === false && known) {
    await clear(k);
    await press(k, text, SLOW_KEY_GAP_MS);
    verified = await echoed(k, find, holds, false);
    if (verified === false) {
      await clear(k);
      return 'retype' as const;
    }
  }
  if (verified === false && !known && (await takeBack(k, find, before))) return 'append' as const;
  // other text than asked for is not submitted, which a search or a form would act on
  const submitted = opts.submit && verified !== false;
  throwIfCancelled('the text');
  if (submitted) await k.send({ kind: 'key', key: 'enter' });
  return {
    mode: 'keys' as const,
    focusMs,
    ...(verified !== undefined && { verified }),
    ...(opts.submit && !submitted && { submitted: false }),
  };
}

/** What keys added after the text a field held, deleted: true once it holds that text alone again. */
async function takeBack(k: Keyboard, find: Find, before: string) {
  let now = find(await k.read())?.t ?? '';
  if (now.length - before.length > TAKE_BACK_MAX) return false;
  // one at a time, each seen gone: a field that formats may take a separator along with a character
  for (let left = now.length - before.length; left > 0 && now.startsWith(before); left--) {
    throwIfCancelled('the text');
    const was = now;
    await k.send({ kind: 'key', key: 'delete' });
    if (!(await echoed(k, find, (s) => ((now = s), s !== was), false))) return false;
    if (now === before) return true;
  }
  return now === before;
}
