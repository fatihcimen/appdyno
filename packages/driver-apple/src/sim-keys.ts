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

/** Between keys: with none, the fixture's field that formats what is typed lost one of ten, once in three. */
const KEY_GAP_MS = 20;
const SLOW_KEY_GAP_MS = 70;
const FOCUS_MS = 5_000;
const ECHO_MS = 1_500;
const STILL_MS = 500;

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
  await k.send({ kind: 'key', key: 'a', modifiers: ['command'] });
  await k.send({ kind: 'key', key: 'delete' });
}

/**
 * Whether the field holds the text once its keys are handled, within the echo wait. `givesUp`: one whose text has held
 * still for half a second will not. Undefined: the field is gone.
 */
async function echoed(
  k: Keyboard,
  at: Point | undefined,
  holds: (s: string) => boolean,
  givesUp: boolean,
) {
  const end = Date.now() + ECHO_MS;
  let last: string | undefined;
  let still = Date.now();
  for (;;) {
    const field = fieldOf(await k.read(), at);
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
  if (!focused(field)) {
    if (!at || !(await k.send({ kind: 'tap', ...at }))) return undefined;
    // the keys wait for that field to have the focus, and its keyboard to be up
    while (!focused(field) || !t || !k.keyboardOpen(t)) {
      if (Date.now() - start > FOCUS_MS) return undefined;
      await sleep(50);
      t = await k.read();
      field = fieldOf(t, at);
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
  let verified = await echoed(k, at, holds, known);
  if (verified === false && known) {
    await clear(k);
    await press(k, text, SLOW_KEY_GAP_MS);
    verified = await echoed(k, at, holds, false);
    if (verified === false) {
      await clear(k);
      return 'retype' as const;
    }
  }
  if (opts.submit) await k.send({ kind: 'key', key: 'enter' });
  return { mode: 'keys' as const, focusMs, ...(verified !== undefined && { verified }) };
}
