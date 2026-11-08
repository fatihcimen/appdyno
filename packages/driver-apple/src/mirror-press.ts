import { pause, type InputEvent } from '@appdyno/core';

/** What a window offers on any Apple device, in the viewer's names. */
export const APPLE_CONTROLS = [
  'home',
  'appSwitch',
  'lock',
  'volumeUp',
  'volumeDown',
  'siri',
  'controlCenter',
  'notifications',
  'spotlight',
  'rotateLeft',
  'rotateRight',
];

/** What an iPhone takes with no runner; the others are a simulator's, or an edge drag a person can do in the window. */
export const PHONE_CONTROLS = ['home', 'appSwitch', 'lock', 'volumeUp', 'volumeDown', 'siri'];

/** Two presses as a person's: the second within the time iOS counts as a double. */
const DOUBLE_PRESS_MS = 150;
/**
 * A press sooner after the switcher's two counts with them: on an iOS 27.2 simulator a home about 0.25 s after the second
 * showed the home screen with the app still in front, and the next home did nothing; from 0.35 s after, 16 of 16 were taken.
 */
const PRESSES_APART_MS = 500;
/** Held this long, the side button is Siri. */
const HOLD_MS = 900;
const CONSUMER_PAGE = 12;
const SIDE_BUTTON = 0x30;

const KEYBOARD_PAGE = 7;
const COMMAND = 0xe3;
const V = 0x19;

/** Command V as keys: what a person's keyboard sends. */
export async function pasteKeys(send: (e: InputEvent) => Promise<void>) {
  for (const [usage, state] of [
    [COMMAND, 1],
    [V, 1],
    [V, 2],
    [COMMAND, 2],
  ] as const) {
    await send({ kind: 'key', page: KEYBOARD_PAGE, usage, state });
  }
}

/** A press that is more than one key on an Apple device; false leaves it to the device's own key. */
export async function applePress(name: string, send: (e: InputEvent) => Promise<void>) {
  if (name === 'appSwitch') {
    await send({ kind: 'button', name: 'home' });
    await pause(DOUBLE_PRESS_MS);
    await send({ kind: 'button', name: 'home' });
    await pause(PRESSES_APART_MS);
    return true;
  }
  if (name === 'siri') {
    await send({ kind: 'key', page: CONSUMER_PAGE, usage: SIDE_BUTTON, state: 1 });
    await pause(HOLD_MS);
    await send({ kind: 'key', page: CONSUMER_PAGE, usage: SIDE_BUTTON, state: 2 });
    return true;
  }
  return false;
}
