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

/** Two presses as a person's: the second within the time iOS counts as a double. */
const DOUBLE_PRESS_MS = 150;
/** Held this long, the side button is Siri. */
const HOLD_MS = 900;
const CONSUMER_PAGE = 12;
const SIDE_BUTTON = 0x30;

/** A press that is more than one key on an Apple device; false leaves it to the device's own key. */
export async function applePress(name: string, send: (e: InputEvent) => Promise<void>) {
  if (name === 'appSwitch') {
    await send({ kind: 'button', name: 'home' });
    await pause(DOUBLE_PRESS_MS);
    await send({ kind: 'button', name: 'home' });
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
