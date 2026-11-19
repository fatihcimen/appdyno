import { KEYS, type Key } from '@appdyno/protocol';

type Trait =
  'button' | 'side' | 'leavesApp' | 'leavesHeld' | 'leavesScreen' | 'dark' | 'noLook' | 'appsOwn';

/** What each key does beside its press, each set below by its trait: the one table, so that a new key has to say. */
const KEY_TRAITS: Record<Key, readonly Trait[]> = {
  back: ['button', 'leavesScreen'],
  home: ['button', 'leavesApp', 'leavesScreen', 'noLook'],
  enter: ['appsOwn'],
  delete: [],
  tab: ['leavesHeld', 'appsOwn'],
  appSwitch: ['button', 'leavesApp', 'leavesScreen'],
  volumeUp: ['button', 'leavesScreen'],
  volumeDown: ['button', 'leavesScreen'],
  power: ['button', 'side', 'leavesApp', 'dark', 'noLook'],
  lock: ['button', 'side', 'leavesApp', 'dark', 'noLook'],
  escape: ['leavesScreen', 'appsOwn'],
  space: ['leavesHeld'],
  arrowUp: [],
  arrowDown: [],
  arrowLeft: [],
  arrowRight: [],
  mute: ['button', 'leavesScreen', 'dark', 'noLook'],
  siri: ['button', 'leavesApp', 'leavesScreen', 'dark'],
};

const keysThat = (trait: Trait): ReadonlySet<string> =>
  new Set(KEYS.filter((k) => KEY_TRAITS[k].includes(trait)));

/** `button`: what a key that is a button takes: nothing is held during it. */
export const BUTTONS = keysThat('button');

/** `side`: the power and side keys: three presses this close call for help on many phones (Emergency SOS). */
export const SIDE_KEYS = keysThat('side');

/** `leavesApp`: these leave the app, as the home key does. */
export const LEAVES_APP = keysThat('leavesApp');

/** `leavesHeld`: a keyboard's way to the same, a key held with it: to the home screen (`h`), the switcher and search. */
export const SHORTCUT_LEAVES: ReadonlySet<string> = new Set(['h', ...keysThat('leavesHeld')]);

/** `leavesScreen`: keys that leave the screen in front, as a power menu, or act on no element: back, home, the volume. */
export const LEAVES = keysThat('leavesScreen');

/** `dark`: the screen goes dark, or to a system sheet with no window to read: nothing to wait for. */
export const NOTHING_TO_READ = keysThat('dark');

/**
 * `noLook`: what is pressed with no look first: the way out of such a sheet, what opens one over itself, and what acts
 * on the screen's power, as a look at a dark screen wakes it and the key would then put it back.
 */
export const NEEDS_NO_LOOK = keysThat('noLook');

/** `appsOwn`: what a key does is the app's, with a field focused or none: no field to read it back from is not said. */
const APPS_OWN = keysThat('appsOwn');

/**
 * What an iOS key's presses read back, as its answer adds it: those its field showed nothing of, and that no field had
 * the keyboard focus where a key went (`name` as asked for).
 */
export function readBack(
  name: string,
  key: string,
  pressed: { verified?: boolean; noFocus?: boolean }[],
) {
  const unseen = pressed.filter((p) => p.verified === false).length;
  const lost = pressed.length > 1 ? `${String(unseen)} of them` : 'it';
  const blind = pressed.some((p) => p.noFocus) && !APPS_OWN.has(key);
  return `${unseen ? `, but the field read back does not show ${lost}` : ''}${blind ? `; no field had the keyboard focus: ${name} went to the screen, and nothing was read back` : ''}`;
}
