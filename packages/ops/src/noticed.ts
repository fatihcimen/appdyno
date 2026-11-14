import { personNeeded, PICTURE_TEXT, type Screen, type SystemAlert } from '@appdyno/core';
import type { Session } from './session.js';

/** What a read of words from the picture at the fast level adds: those of some languages may be wrong. */
const FAST_READ =
  '; read at the fast level: letters outside English, French, Italian, German, Spanish and Portuguese may be wrong';

const needsPerson = (what: string) => `\nneeds a person: ${what}. hand_off asks yours, and waits`;

/** A system alert by its own words and buttons, whatever it asks: a permission, or a link's "Open in …?". */
export const systemAsks = (a: SystemAlert) =>
  `the system asks: ${a.texts.join(' ')} (${a.buttons.map((b) => b.label).join(', ')}): answer it with alert`;

/** The app check: a system alert points to alert; another app in front is said. */
function appCheck(s: Session, screen: Screen) {
  if (screen.foreground === s.appId) s.leftTheApp(false);
  if (s.wordless && screen.elements.some((e) => e.type === PICTURE_TEXT))
    return `\nno words in the tree: these were read from the picture, and their places are near${s.pictureLevel === 'fast' ? FAST_READ : ''}`;
  if (s.pictureFailed)
    return `\nno words in the tree, and none from the picture: ${s.pictureFailed}`;
  const person = s.device.platformScreen.personPrompt(screen.tree, screen.elements);
  if (person) return needsPerson(person);
  // any the system shows over the app, a permission's or an app's crash ("keeps stopping"), by its words and buttons
  const asks = s.device.platformScreen.systemAlert(screen.tree, screen.elements);
  if (asks) return `\n${systemAsks(asks)}`;
  // an iOS alert of two buttons has an allow by its place, the one a link's "Open in …?" asks with too
  if (s.device.platformScreen.alertButton(screen.elements, 'allow'))
    return '\na system alert is open: answer it with alert';
  if (!s.appId || !screen.foreground || screen.foreground === s.appId || s.leftApp) return '';
  return `\nWARNING: the app is not in the foreground (${screen.foreground}): if it crashed, bring it back with launch_app`;
}

/**
 * The app check, and what the system shows that no read of the app has. That second look costs a read, so an action
 * takes it only when nothing changed, which is all such a prompt leaves on the app.
 */
export async function noticed(s: Session, screen: Screen, lookFurther = true) {
  const fg = appCheck(s, screen);
  if (fg || !lookFurther || !s.device.systemWords) return fg;
  const words = await s.device.systemWords().catch(() => []);
  const person = personNeeded({ texts: words, buttons: [] });
  return person ? needsPerson(person) : '';
}
