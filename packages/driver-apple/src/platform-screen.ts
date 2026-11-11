import {
  alertButtonOf,
  alertOf,
  bare,
  fold,
  personNeeded,
  type AlertWords,
  type PlatformScreen,
  type UiElement,
  must,
} from '@appdyno/core';
import { NODE_FLAGS, type Point, type Tree } from '@appdyno/protocol';
import type { Prompt } from './simtree.js';

/** The home screen app, whose alerts are the system's (permission prompts), never the app's own. */
export const HOME_SCREEN_APP = 'com.apple.springboard';

/** Spotlight, an app of its own over the home screen, in the simulators of iOS 17.5 to 27.2. */
export const SPOTLIGHT_APP = 'com.apple.Spotlight';

/**
 * The button that opens of "Open in “name”?", which iOS asks before a link first opens an app: one line that names the
 * app, and of two buttons the second in every language. A permission's prompt names the app too, with a line on why.
 */
export function openButton(p: Prompt | undefined, name: string) {
  if (p?.words.length !== 1 || !p.words[0]?.includes(name)) return undefined;
  const b = p.buttons.length === 2 ? p.buttons[1] : p.buttons.find((x) => /^open$/i.test(x.label));
  return b && { x: b.x, y: b.y };
}

/** `openButton` of the home screen app's first alert in a read, by its own words and buttons: never the app's own. */
export function promptButton(t: Tree, name: string): Point | undefined {
  const alert = t.nodes.findIndex(
    (n) => n.c === 'Alert' && t.windows[n.w]?.pkg === HOME_SCREEN_APP,
  );
  const under = (i: number): boolean => {
    const p = t.nodes[i]?.p ?? -1;
    return p === alert || (p >= 0 && under(p));
  };
  const inside = alert < 0 ? [] : t.nodes.filter((_, i) => under(i));
  const label = (n: Tree['nodes'][number]) => n.d ?? n.t ?? '';
  const words = inside.filter((n) => n.c === 'StaticText' && label(n)).map(label);
  const buttons = inside
    .filter((n) => n.c === 'Button')
    .map((n) => ({ label: label(n), x: (n.b[0] + n.b[2]) / 2, y: (n.b[1] + n.b[3]) / 2 }));
  return openButton({ words, buttons }, name);
}

/** The words of a read that are no control's. */
export const staticTexts = ({ nodes }: Tree) =>
  nodes.flatMap((n) => (n.c === 'StaticText' ? (n.d ?? n.t ?? []) : []));

/** A point above the keyboard with no control or field on it; else near the top. */
export function inertPoint(t: Tree): Point {
  const screen = t.windows[0]?.b ?? [0, 0, 400, 800];
  const keyboard = t.nodes.find((n) => /keyboard$/i.test(n.c));
  const bottom = keyboard ? keyboard.b[1] : screen[3];
  const x = Math.round((screen[0] + screen[2]) / 2);
  const reacts = NODE_FLAGS.clickable | NODE_FLAGS.editable | NODE_FLAGS.checkable;
  const taken = (y: number) =>
    t.nodes.some(
      (n) => (n.f & reacts) !== 0 && x >= n.b[0] && x <= n.b[2] && y >= n.b[1] && y <= n.b[3],
    );
  for (let y = 120; y < bottom - 10; y += 40) if (!taken(y)) return { x, y };
  return { x, y: 120 };
}
/** As tall as it gets, on a phone with a Dynamic Island: a pixel comparison leaves it out. */
const STATUS_BAND_PT = 64;
/** Status bar items are root elements in this band. */
const STATUS_BAR_PT = 50;

/** A caller testing in another language passes its own. */
export const ALERT_WORDS: AlertWords = {
  allow:
    /^(allow|allow while using( the)? app|allow once|allow full access|while using the app|only this time)$/,
  deny: /^(don[’']t allow|ask app not to track)$/,
};

const alertRoot = (elements: UiElement[]) =>
  elements.findIndex((e) => /alert$/i.test(e.type) && e.pkg === HOME_SCREEN_APP);

const insideOf = (elements: UiElement[], root: number) =>
  elements.filter((e) => {
    for (let q = e.parent; q !== undefined; q = must(elements[q], 'a parent').parent)
      if (q === root) return true;
    return false;
  });

const isButton = (e: UiElement) => /button$/i.test(e.type);

export const iosScreen: PlatformScreen = {
  /** The alerts of the home screen app; a dialog of an app is the app's own. */
  systemAlert(_tree, elements) {
    const root = alertRoot(elements);
    return root < 0 ? undefined : alertOf(insideOf(elements, root), isButton);
  },

  personPrompt: (tree, elements) => personNeeded(iosScreen.systemAlert(tree, elements)),

  /** The home screen app's alert over the app, and no other of its windows; a keyboard and a share sheet are the app's. */
  overApp: (tree, i) =>
    tree.windows[i]?.pkg === HOME_SCREEN_APP &&
    tree.nodes.some((n) => n.w === i && n.p < 0 && /alert$/i.test(n.c)),

  /**
   * A button of an Alert of the home screen app, by `words`, else by its place: of two buttons deny is
   * the first and allow the last; of three or more (location, photos: once / while using / don't)
   * allow is the second and deny the last.
   */
  alertButton(elements, action, words = ALERT_WORDS) {
    const root = alertRoot(elements);
    if (root < 0) return undefined;
    const text = (e: UiElement) => (e.label || e.text || e.name || '').trim();
    const all = insideOf(elements, root).filter((e) => isButton(e) && !!e.rect);
    // a location prompt's precise switch is no answer, and shows as two buttons of one label
    const buttons = all.filter((b) => all.filter((o) => text(o) === text(b)).length === 1);
    const re = action === 'allow' ? words.allow : words.deny;
    const byWord = buttons.find((b) => re.test(fold(text(b))));
    if (byWord) return alertButtonOf(byWord);
    if (buttons.length < 2) return undefined;
    // allow is the second button either way; deny the first of two, the last of more
    return alertButtonOf(
      action === 'allow' ? buttons[1] : buttons.length === 2 ? buttons[0] : buttons.at(-1),
    );
  },

  contrastAudits: ['contrast'],

  keyboardOpen: (tree) => tree.nodes.some((n) => /keyboard$/i.test(n.c)),

  keyboardArea(tree) {
    const b = tree.nodes.find((n) => /keyboard$/i.test(n.c))?.b;
    return b && { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] };
  },

  statusBand: () => STATUS_BAND_PT,

  notTheApp: (el) =>
    el.parent === undefined && el.rect !== undefined && el.rect.y + el.rect.height <= STATUS_BAR_PT,

  isSystemUi: () => false,

  barBesideWindow: false,

  /** The width of a navigation or tab bar at x 0, with no height limit. */
  windowByBars(elements) {
    const bar = elements.find(
      (e) => /^(navigationbar|tabbar)$/.test(bare(e.type)) && e.rect?.x === 0,
    )?.rect;
    return bar && { x: 0, y: -1e9, width: bar.width, height: 2e9 };
  },

  listsByIdAlone: true,
};
