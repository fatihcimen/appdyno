import { NODE_FLAGS, type Traversal, type Tree } from '@appdyno/protocol';
import { must } from '../must.js';

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * One element of the screen in the host's model (a flat list, each with its parent's index): what the
 * screen model reads, whatever platform it came from.
 */
export type UiElement = {
  /** Android: class name (`android.widget.Button`); iOS: element type. */
  type: string;
  /** Accessibility label (Android content description). */
  label?: string;
  text?: string;
  /** Android resource id (`pkg:id/name`) / iOS accessibility identifier. */
  identifier?: string;
  placeholder?: string;
  /** Device pixels on Android, points on iOS: the units taps are given in. */
  rect?: Rect;
  ref?: string;
  clickable?: boolean;
  focusable?: boolean;
  enabled?: boolean;
  visible?: boolean;
  checked?: boolean;
  focused?: boolean;
  selected?: boolean;
  editable?: boolean;
  password?: boolean;
  scrollable?: boolean;
  /** Android: a screen reader skips it (not important for accessibility); set only when true. */
  notImportant?: boolean;
  /** Android: a screen reader reads it with its children as one unit; set only when true. */
  screenReaderFocusable?: boolean;
  /** Android: a screen reader reads it before / after the element at this index (`a11y.read`'s hints). */
  traversalBefore?: number;
  traversalAfter?: number;
  /** Index of the parent in the flat list; absent for a root. */
  parent?: number;
  /** Package of the window the element is in (Android). */
  pkg?: string;
  /** In a system UI window that holds the focus: what is on the screen (Android). */
  prompt?: boolean;
  /** The stable refs' context: the text that tells this element from identical ones. */
  refContext?: string;
  name?: string;
};

/** Accessibility window types (Android) that are never the app's screen. */
const INPUT_METHOD = 2;
const ACCESSIBILITY_OVERLAY = 4;
const SYSTEM = 3;
const SYSTEM_UI = 'com.android.systemui';

/**
 * The agent's tree as screen elements: the keyboard, accessibility overlays and the system UI's own
 * windows (status bar, navigation bar, notification shade) are left out; system dialogs (permission
 * prompts, "app isn't responding") stay, as they are what the user sees and answers, and so does a system
 * UI window with the focus: a biometric prompt is one, and with it gone an app's prompt reads as nothing.
 */
export function elementsOf(tree: Tree, traversal: Traversal[] = []): UiElement[] {
  const systemUi = (w: Tree['windows'][number]) => w.type === SYSTEM && w.pkg === SYSTEM_UI;
  const keep = tree.windows.map(
    (w) =>
      w.type !== INPUT_METHOD && w.type !== ACCESSIBILITY_OVERLAY && !(systemUi(w) && !w.focused),
  );
  const index = new Map<number, number>();
  const out: UiElement[] = [];
  tree.nodes.forEach((n, i) => {
    if (!keep[n.w]) return;
    const has = (f: keyof typeof NODE_FLAGS) => (n.f & NODE_FLAGS[f]) !== 0;
    const [l, t, r, b] = n.b;
    const win = tree.windows[n.w];
    const parent = n.p >= 0 ? index.get(n.p) : undefined;
    const el: UiElement = {
      type: n.c,
      ...(n.d && { label: n.d }),
      ...(n.t && { text: n.t }),
      ...(n.id && { identifier: n.id }),
      ...(n.h && { placeholder: n.h }),
      rect: { x: l, y: t, width: r - l, height: b - t },
      ref: `n${i}`,
      clickable: has('clickable') || has('longClickable'),
      focusable: has('focusable'),
      enabled: has('enabled'),
      visible: has('visible'),
      checked: has('checked'),
      focused: has('focused'),
      selected: has('selected'),
      editable: has('editable'),
      password: has('password'),
      scrollable: has('scrollable'),
      ...(has('notImportant') && { notImportant: true }),
      ...(has('screenReaderFocusable') && { screenReaderFocusable: true }),
      ...(parent !== undefined && { parent }),
      ...(win?.pkg && { pkg: win.pkg }),
      ...(win && systemUi(win) && { prompt: true }),
    };
    index.set(i, out.length);
    out.push(el);
  });
  for (const t of traversal) {
    const el = out[index.get(t.n) ?? -1];
    const before = t.before === undefined ? undefined : index.get(t.before);
    const after = t.after === undefined ? undefined : index.get(t.after);
    if (el && before !== undefined) el.traversalBefore = before;
    if (el && after !== undefined) el.traversalAfter = after;
  }
  return out;
}

/** Who holds whom, in a list where each names its parent by its place in the list. */
export function familyOf(elements: { parent?: number | undefined }[]) {
  const children = new Map<number, number[]>();
  elements.forEach((e, i) => {
    if (e.parent !== undefined) children.set(e.parent, [...(children.get(e.parent) ?? []), i]);
  });
  const ancestors = (i: number) => {
    const out: number[] = [];
    const at = (n: number) => must(elements[n], `element ${n}`);
    for (let p = at(i).parent; p !== undefined; p = at(p).parent) out.push(p);
    return out;
  };
  const descendants = (i: number): number[] =>
    (children.get(i) ?? []).flatMap((c) => [c, ...descendants(c)]);
  return { ancestors, descendants };
}
