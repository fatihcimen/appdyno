import {
  alertButtonOf,
  alertOf,
  fold,
  type AlertWords,
  type PlatformScreen,
  type UiElement,
} from '@appdyno/core';

/** The home screen app, whose alerts are the system's (permission prompts), never the app's own. */
const HOME_SCREEN_APP = 'com.apple.springboard';
/** As tall as it gets, on a phone with a Dynamic Island: a pixel comparison leaves it out. */
const STATUS_BAND_PT = 64;

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

  keyboardOpen: (tree) => tree.nodes.some((n) => /keyboard$/i.test(n.c)),

  statusBand: () => STATUS_BAND_PT,
};
