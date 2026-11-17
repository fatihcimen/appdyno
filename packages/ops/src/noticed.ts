import {
  actionable,
  diffScreens,
  onLine,
  personNeeded,
  PICTURE_TEXT,
  type Screen,
  type ScreenElement,
  type SystemAlert,
} from '@appdyno/core';
import { SETTLE_DEFAULT, type Point } from '@appdyno/protocol';
import { inAlert } from './power.js';
import type { Session } from './session.js';

/**
 * An iOS alert over an app is the home screen app's: as a touch at `at` on `screen` closes one, that app is in front a
 * moment, showing only the app's card in its switcher, and the settle answered with that (`answer_alert` 5 of 5, a tap 3 of 3).
 * Until another app is in front again; undefined for a touch on no such alert.
 */
export async function backFromAlert(s: Session, screen: Screen, at: Point) {
  const t = screen.tree;
  const on = t.nodes.findIndex(
    (n, i) => at.x >= n.b[0] && at.x <= n.b[2] && at.y >= n.b[1] && at.y <= n.b[3] && inAlert(t, i),
  );
  const owner = t.windows[t.nodes[on]?.w ?? -1]?.pkg;
  if (!owner) return undefined;
  // what it is over: the app in front on this read, else the selected one where it runs, as a read of the alert alone
  // is the home screen app's
  const app = s.appId;
  const over =
    screen.foreground !== owner
      ? screen.foreground
      : app && (await s.device.appRunning(app).catch(() => false))
        ? app
        : undefined;
  return over && owner !== over ? (x: Screen) => x.foreground !== owner : undefined;
}

/** What a read of words from the picture at the fast level adds: those of some languages may be wrong. */
const FAST_READ =
  '; read at the fast level: letters outside English, French, Italian, German, Spanish and Portuguese may be wrong';

const needsPerson = (what: string) => `\nneeds a person: ${what}. ask_person asks yours, and waits`;

/** A system alert by its own words and buttons, whatever it asks: a permission, or a link's "Open in …?". */
export const systemAsks = (a: SystemAlert) =>
  `the system asks: ${a.texts.map(onLine).join(' ')} (${a.buttons.map((b) => onLine(b.label)).join(', ')}): answer it with answer_alert`;

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
    return '\na system alert is open: answer it with answer_alert';
  if (!s.appId || !screen.foreground || screen.foreground === s.appId || s.leftApp) return '';
  return `${NOT_IN_FRONT} (${screen.foreground} is, not ${s.appId}): if it crashed, bring it back with launch_app`;
}

const NOT_IN_FRONT = '\nWARNING: the app is not in the foreground';

/**
 * The app check after an action that began with the app in front, which runs on (a death refuses the action first):
 * another app in front is one the action brought up, as a link the app opened in Safari, and not a crash.
 */
export function broughtUp(s: Session, screen: Screen, fg: string) {
  if (!fg.startsWith(NOT_IN_FRONT)) return fg;
  s.leftTheApp();
  return `\n${screen.foreground ?? ''} came to the front: launch_app brings ${s.appId ?? ''} back`;
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

/** How long an actionable tap that changed nothing is watched for a late reaction, as an iOS device watches itself. */
const LATE_WATCH_MS = 800;

/** Where a tap went, once its device call is over. */
export type TappedAt = () => Point | undefined;

/**
 * An actionable tap at `at` that left the screen as `base` had it may be answered late, by an app that moves only once
 * its keyboard has gone or by a system alert: where the device did not watch for that itself (`idleMs` is what it
 * watched), it is watched for here for LATE_WATCH_MS, and the screen settled again from a change.
 */
export async function lateReaction(
  s: Session,
  base: ScreenElement[] | undefined,
  aimedAt: Screen | undefined,
  at: Point | undefined,
  screen: Screen,
  idleMs: number | undefined,
): Promise<{ screen: Screen; settled?: boolean; idleMs?: number | undefined }> {
  const unchanged = (x: Screen) => {
    const d = base && diffScreens(base, x.list);
    return !!d && d.added.length + d.removed.length + d.changed.length === 0;
  };
  const watched = s.device.platformScreen.watchesTaps || idleMs !== undefined;
  if (!at || watched || !actionable(aimedAt?.tree.nodes, at.x, at.y) || !unchanged(screen))
    return { screen, idleMs };
  const from = Date.now();
  const moved = await s.until((x) => !unchanged(x), LATE_WATCH_MS);
  const waited = Date.now() - from;
  if (!moved.met) return { screen, idleMs: waited };
  return { ...(await s.settle(SETTLE_DEFAULT.quietMs, SETTLE_DEFAULT.maxMs)), idleMs: waited };
}
