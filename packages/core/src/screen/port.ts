import type { Tree } from '@appdyno/protocol';
import type { AlertAction, AlertButton, AlertWords, SystemAlert } from './alert.js';
import type { Rect, UiElement } from './elements.js';

/** What only a platform knows about what its screen shows. */
export interface PlatformScreen {
  /** The system alert on the screen, whatever it asks. */
  systemAlert(tree: Tree, elements: UiElement[]): SystemAlert | undefined;
  /** What this screen wants of a person, as `personNeeded` names it: a prompt that is no alert as well. */
  personPrompt(tree: Tree, elements: UiElement[]): string | undefined;
  /** The button of a system permission prompt for `action`; undefined when no such prompt is up. */
  alertButton(
    elements: UiElement[],
    action: AlertAction,
    words?: AlertWords,
  ): AlertButton | undefined;
  keyboardOpen(tree: Tree): boolean;
  /** Where the on-screen keyboard is, in tap units; undefined when it is not open or does not say. */
  keyboardArea(tree: Tree): Rect | undefined;
  /**
   * What the status bar takes at the top of the screen, in tap units, for what compares pixels: its clock moves.
   * `density` is the agent's `screen.density` as this platform means it: dots per inch, or a scale.
   */
  statusBand(tree: Tree, density?: number): number;
  /**
   * An element that is none of the app's, and neither is what it holds, but for the app's own. `front`: the app, when
   * it is on the screen.
   */
  notTheApp(el: UiElement, front: string | undefined): boolean;
  /** The system's own: what it holds stays out whoever names it. */
  isSystemUi(el: UiElement): boolean;
  /** A navigation bar can stand beside the window in landscape, so that its largest root is not at the origin. */
  readonly barBesideWindow: boolean;
  /** The screen when no root tells it; undefined: nothing is left out for being off it. */
  windowByBars(elements: UiElement[]): Rect | undefined;
  /** An untyped element with no words of its own is listed when an id names it. */
  readonly listsByIdAlone: boolean;
}

/** What makes a tree a screen: its platform's rules, and the app it is read for. */
export type ScreenOptions = { port: PlatformScreen; appId?: string };
