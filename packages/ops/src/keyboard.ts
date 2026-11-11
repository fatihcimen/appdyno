import { selectIn, type Screen, type Selector } from '@appdyno/core';
import type { Point } from '@appdyno/protocol';
import type { Session } from './session.js';
import { ToolError } from './tool.js';

/** How long a closed keyboard is given to go. */
const KEYBOARD_GONE_MS = 1_500;

/** Closes the on-screen keyboard: whether it went. */
export async function hideKeyboard(s: Session) {
  await s.device.dismissKeyboard();
  return keyboardGone(s);
}

/** Whether a keyboard the device was just asked to close went. */
export async function keyboardGone(s: Session) {
  s.acted();
  const open = (x: Screen) => s.device.platformScreen.keyboardOpen(x.tree);
  return (await s.until((x) => !open(x), KEYBOARD_GONE_MS)).met;
}

/**
 * A selector with no match on the screen, with the keyboard up: the keyboard is closed at once, as the element may be
 * under it, before any wait for the element, which would see only the keyboard for all of its time. The last read
 * says so, and one of the moment then: what closes a keyboard on Android is the back key, which leaves the screen
 * where the app has closed it since.
 */
export async function keyboardFirst(s: Session, selector: Selector) {
  const covered = (x: Screen) =>
    !selectIn(x.list, selector).length && s.device.platformScreen.keyboardOpen(x.tree);
  if (covered(await s.current()) && covered(await s.justNow())) await hideKeyboard(s);
}

type Aimed = { point: Point; name: string };

/**
 * A target's point as `aim` finds it, where an element under the keyboard, which a touch would type on, or a selector
 * the window the keyboard shrank leaves out, is looked for again once the keyboard is closed.
 */
export async function pastKeyboard(
  s: Session,
  a: { ref?: string; selector?: Selector },
  aim: (patient: boolean) => Promise<Aimed>,
  patient: boolean,
): Promise<Aimed> {
  const platform = s.device.platformScreen;
  if (a.selector) await keyboardFirst(s, a.selector);
  const aimed = await aim(patient).catch(async (e: unknown) => {
    const leftOut = a.selector && e instanceof ToolError && e.code === 'NOT_FOUND';
    if (leftOut && platform.keyboardOpen((await s.current()).tree) && (await hideKeyboard(s)))
      return undefined;
    throw e;
  });
  if (!aimed) return aim(true);
  if (!a.ref && !a.selector) return aimed;
  const screen = await s.current();
  const k = platform.keyboardArea(screen.tree);
  const { x, y } = aimed.point;
  if (!k || x < k.x || x > k.x + k.width || y < k.y || y > k.y + k.height) return aimed;
  return (await hideKeyboard(s)) ? aim(true) : aimed;
}
