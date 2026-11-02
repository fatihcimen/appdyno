import type { Tree } from '@appdyno/protocol';
import { elementsOf, type UiElement } from './elements.js';
import { screenElements, windowRect, type Platform, type ScreenElement } from './model.js';
import { withStableRefs } from './refs.js';

export * from './elements.js';
export * from './model.js';
export * from './refs.js';
export * from './diff.js';
export * from './fold.js';

/** One read of the screen: the agent's tree, its elements with stable refs, and the list a tester sees. */
export type Screen = {
  tree: Tree;
  elements: UiElement[];
  list: ScreenElement[];
  /** The agent's layout digest (equal digests: the same settled layout). */
  hash: string;
  /** Package of the active application window. */
  foreground?: string;
  /** The screen in tap units, when the tree shows it. */
  window?: { w: number; h: number };
};

export function buildScreen(tree: Tree, opts: { platform: Platform; appId?: string }): Screen {
  const elements = withStableRefs(elementsOf(tree), opts);
  const list = screenElements(elements, opts);
  // the topmost active application window (a dialog activity over the app), else the topmost
  const app = tree.windows.filter((w) => w.type === 1).sort((a, b) => b.layer - a.layer);
  const active = app.find((w) => w.active) ?? app[0];
  const win = windowRect(elements, opts.platform);
  return {
    tree,
    elements,
    list,
    hash: tree.hash,
    ...(active?.pkg && { foreground: active.pkg }),
    ...(win && { window: { w: win.x + win.width, h: win.height } }),
  };
}
