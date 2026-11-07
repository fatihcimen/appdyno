import {
  alertButtonOf,
  alertOf,
  bare,
  fold,
  personNeeded,
  type AlertWords,
  type PlatformScreen,
  type UiElement,
} from '@appdyno/core';
import { NODE_FLAGS, type Point, type Tree } from '@appdyno/protocol';

/** The home screen app, whose alerts are the system's (permission prompts), never the app's own. */
export const HOME_SCREEN_APP = 'com.apple.springboard';

/** Spotlight, an app of its own over the home screen, in the simulators of iOS 17.5 to 27.2. */
export const SPOTLIGHT_APP = 'com.apple.Spotlight';

/**
 * The confirming button of a system prompt over the screen ("Open in …?" after a link): of two buttons
 * the second (the first cancels, in any language), else one that says `words`.
 */
// shortcut: a two-button system prompt that is not the link's (a notification prompt) within the 3 s
// after a link is answered as confirmed; tell them apart by the prompt's text if one shows up there
export function promptButton(t: Tree, words: RegExp = /^open$/): Point | undefined {
  const buttons = t.nodes.filter((n) => t.windows[n.w]?.type === 3 && n.c === 'Button');
  const b = buttons.length === 2 ? buttons[1] : buttons.find((n) => words.test(fold(n.d ?? '')));
  return b && { x: (b.b[0] + b.b[2]) / 2, y: (b.b[1] + b.b[3]) / 2 };
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
  elements.filter((_, i) => {
    for (let q = elements[i]!.parent; q !== undefined; q = elements[q]!.parent)
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

  /**
   * A button of an Alert of the home screen app, by `words`, else by its place: of two buttons deny is
   * the first and allow the last; of three or more (location, photos: once / while using / don't)
   * allow is the second and deny the last.
   */
  alertButton(elements, action, words = ALERT_WORDS) {
    const root = alertRoot(elements);
    if (root < 0) return undefined;
    const buttons = insideOf(elements, root).filter((e) => isButton(e) && !!e.rect);
    const text = (e: UiElement) => (e.label || e.text || e.name || '').trim();
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
    );
    return bar && { x: 0, y: -1e9, width: bar.rect!.width, height: 2e9 };
  },

  listsByIdAlone: true,
};
