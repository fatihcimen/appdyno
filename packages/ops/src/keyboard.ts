import type { Screen, Selector } from '@appdyno/core';
import type { Point } from '@appdyno/protocol';
import type { Session } from './session.js';
import { ToolError } from './tool.js';

/** How long a closed keyboard is given to go. */
const KEYBOARD_GONE_MS = 1_500;

/** Closes the on-screen keyboard: whether it went. */
export async function hideKeyboard(s: Session) {
  await s.device.dismissKeyboard();
  s.acted();
  const open = (x: Screen) => s.device.platformScreen.keyboardOpen(x.tree);
  return (await s.until((x) => !open(x), KEYBOARD_GONE_MS)).met;
}

/** Whether an element is the keyboard's own, as iOS lists its keys: a touch on it is meant for the keyboard. */
function ofKeyboard(screen: Screen, ref: string) {
  let el = screen.elements.find((x) => x.ref === ref);
  while (el && !/keyboard$/i.test(el.type))
    el = el.parent === undefined ? undefined : screen.elements[el.parent];
  return !!el;
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
  // the element aimed at is centred on the point
  const own = screen.list.some((e) => e.x === x && e.y === y && ofKeyboard(screen, e.ref));
  return !own && (await hideKeyboard(s)) ? aim(true) : aimed;
}
