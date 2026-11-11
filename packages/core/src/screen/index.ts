import type { Tree } from '@appdyno/protocol';
import { elementsOf, type UiElement } from './elements.js';
import { screenElements, windowRect, type ScreenElement } from './model.js';
import type { ScreenOptions } from './port.js';
import { withStableRefs } from './refs.js';

export * from './elements.js';
export * from './model.js';
export * from './port.js';
export * from './refs.js';
export * from './alert.js';
export * from './diff.js';
export * from './fold.js';
export * from './folded.js';
export * from './select.js';

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

/** The on-screen keyboard as the list holds it: one element, as an agent types with type_text and taps no key. */
export const KEYBOARD_REF = '@keyboard';

function keyboardOf(tree: Tree, { port }: ScreenOptions): ScreenElement[] {
  if (!port.keyboardOpen(tree)) return [];
  const rect = port.keyboardArea(tree) ?? { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.round(rect.x + rect.width / 2);
  const y = Math.round(rect.y + rect.height / 2);
  const role = 'keyboard';
  return [
    { ref: KEYBOARD_REF, role, label: '', name: role, nameKind: 'label', rect, x, y, flags: [] },
  ];
}

export function buildScreen(tree: Tree, opts: ScreenOptions): Screen {
  const elements = withStableRefs(elementsOf(tree), opts);
  const list = [...screenElements(elements, opts), ...keyboardOf(tree, opts)];
  // the topmost active application window (a dialog activity over the app), else the topmost
  const app = tree.windows.filter((w) => w.type === 1).sort((a, b) => b.layer - a.layer);
  const active = app.find((w) => w.active) ?? app[0];
  const win = windowRect(elements, opts.port);
  return {
    tree,
    elements,
    list,
    hash: tree.hash,
    ...(active?.pkg && { foreground: active.pkg }),
    ...(win && { window: { w: win.x + win.width, h: win.height } }),
  };
}
