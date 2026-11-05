import { NODE_FLAGS, type Tree } from '@appdyno/protocol';
import { HOME_SCREEN_APP } from './platform-screen.js';

type Node = Tree['nodes'][number];

/** XCUI's element types by raw value (the runner's names): a test holds these tables to the runner's. */
export const TYPES =
  'Any Other Application Group Window Sheet Drawer Alert Dialog Button RadioButton RadioGroup CheckBox DisclosureTriangle PopUpButton ComboBox MenuButton ToolbarButton Popover Keyboard Key NavigationBar TabBar TabGroup Toolbar StatusBar Table TableRow TableColumn Outline OutlineRow Browser CollectionView Slider PageIndicator ProgressIndicator ActivityIndicator SegmentedControl Picker PickerWheel Switch Toggle Link Image Icon SearchField ScrollView ScrollBar StaticText TextField SecureTextField DatePicker TextView Menu MenuItem MenuBar MenuBarItem Map WebView IncrementArrow DecrementArrow Timeline RatingIndicator ValueIndicator SplitGroup Splitter RelevanceIndicator ColorWell HelpTag Matte DockItem Ruler RulerMarker Grid LevelIndicator Cell LayoutArea LayoutItem Handle Stepper Tab TouchBar'.split(
    ' ',
  );

/** The accessibility server numbers the first few on its own; from Button on they are XCUI's. */
const SERVER_TYPES: Record<number, string> = { 0: 'Other', 1: 'Application', 2: 'Window' };

export const CLICKABLE = new Set(
  'Button Cell Link Tab MenuItem SegmentedControl Switch Toggle Slider Stepper Picker PickerWheel Key Icon IncrementArrow DecrementArrow RadioButton CheckBox PopUpButton MenuButton DisclosureTriangle PageIndicator'.split(
    ' ',
  ),
);

export const EDITABLE = new Set(['TextField', 'SecureTextField', 'SearchField', 'TextView']);

export const SCROLLABLE = new Set(['ScrollView', 'Table', 'CollectionView', 'WebView']);

export const CHECKABLE = new Set(['Switch', 'Toggle', 'CheckBox']);

export const SCROLLERS = new Set(['ScrollView', 'Table', 'CollectionView', 'WebView', 'TextView']);

const F = NODE_FLAGS;

const TRAIT_SELECTED = 1n << 3n;

const TRAIT_NOT_ENABLED = 1n << 8n;

const TRAIT_EDITING = 1n << 21n;

/** A node as the helper sends it. */
export type RawAx = {
  /** Automation type. */
  a?: number;
  /** The view's class. */
  e?: string;
  l?: string;
  v?: string | number | boolean;
  h?: string;
  i?: string;
  /** x, y, width, height. */
  f?: number[];
  /** The traits word in decimal: 64 bits, past a JSON number. */
  t?: string;
  /** A process's content ends here. */
  r?: number | boolean;
  n?: number | boolean;
  k?: RawAx[];
  cut?: boolean;
};

const shown = (n: Node) => (n.f & F.visible) !== 0 && n.b[2] > n.b[0] && n.b[3] > n.b[1];

const interactive = (n: Node) =>
  (n.f & (F.clickable | F.editable | F.checkable | F.scrollable)) !== 0;

const plainText = (n: Node) => !interactive(n) && !!(n.t ?? n.d);

/** The layout digest the runner computes (RunnerCore's `layoutHash`). */
export function layoutHash(nodes: Node[]): string {
  let h = 0xcbf29ce484222325n;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= BigInt(s.charCodeAt(i));
      h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
  };
  for (const n of nodes) {
    if (!shown(n)) continue;
    mix(n.c);
    mix('#');
    mix(n.id ?? '');
    mix(plainText(n) ? `@${n.b[1]},${n.b[3]}` : `@${n.b[0]},${n.b[1]},${n.b[2]},${n.b[3]}`);
    mix(';');
  }
  return h.toString(16);
}

export const TOLERANCE = 4;

/** The same layout (RunnerCore's `sameLayout`). */
export function sameLayout(a: Node[], b: Node[]): boolean {
  const x = a.filter(shown);
  const y = b.filter(shown);
  if (x.length !== y.length) return false;
  const near = (u: number, v: number) => Math.abs(u - v) <= TOLERANCE;
  return x.every((p, i) => {
    const q = y[i]!;
    return (
      p.c === q.c &&
      p.id === q.id &&
      near(p.b[1], q.b[1]) &&
      near(p.b[3], q.b[3]) &&
      (plainText(p) || (near(p.b[0], q.b[0]) && near(p.b[2], q.b[2])))
    );
  });
}

/**
 * The same screen for a person or a tool: what can be named or acted on, each within the tolerance of its
 * place, in any order. The system's nameless views (glass, scroll edge effects) keep coming and going after
 * a transition, a floating search bar moves between levels of the tree, and neither shows in an answer.
 */
export function sameContent(a: Node[], b: Node[]): boolean {
  const meant = (n: Node) =>
    shown(n) && (interactive(n) || !!(n.id ?? n.d ?? n.t) || n.c !== 'Other');
  const x = a.filter(meant);
  const y = b.filter(meant);
  if (x.length !== y.length) return false;
  const near = (u: number, v: number) => Math.abs(u - v) <= TOLERANCE;
  const key = (n: Node) => `${n.c}#${n.id ?? ''}`;
  const left = new Map<string, Node[]>();
  for (const q of y) left.set(key(q), [...(left.get(key(q)) ?? []), q]);
  return x.every((p) => {
    const same = left.get(key(p));
    const i =
      same?.findIndex(
        (q) =>
          near(p.b[1], q.b[1]) &&
          near(p.b[3], q.b[3]) &&
          (plainText(p) || (near(p.b[0], q.b[0]) && near(p.b[2], q.b[2]))),
      ) ?? -1;
    if (i < 0) return false;
    same!.splice(i, 1);
    return true;
  });
}

/** Can a tap at (x, y) start a reaction the screen does not show yet (RunnerCore's `actionable`)? */
export function actionable(nodes: Node[] | undefined, x: number, y: number): boolean {
  if (!nodes) return true;
  let hit = false;
  for (const n of nodes) {
    if (!shown(n) || x < n.b[0] || x >= n.b[2] || y < n.b[1] || y >= n.b[3]) continue;
    hit = true;
    for (let a: Node | undefined = n; a; a = a.p >= 0 ? nodes[a.p] : undefined) {
      if ((a.f & (F.clickable | F.longClickable | F.editable | F.checkable)) !== 0) return true;
      if (a.c.includes('WebView') || a.c.includes('Map')) return true;
    }
  }
  return !hit;
}

/** A scroll view's bars: told by their shape (RunnerCore's `scrollIndicators`). */
export function scrollIndicators(nodes: Node[]): number[] {
  const named = nodes.map(() => false);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    if ((n.id !== undefined || n.d !== undefined || named[i]) && n.p >= 0 && n.p < i)
      named[n.p] = true;
  }
  return nodes.flatMap((n, i) => {
    if (n.c !== 'Other' || n.id !== undefined || named[i] || n.p < 0) return [];
    const p = nodes[n.p]!;
    if (!SCROLLERS.has(p.c)) return [];
    const w = n.b[2] - n.b[0];
    const h = n.b[3] - n.b[1];
    const pw = p.b[2] - p.b[0];
    const ph = p.b[3] - p.b[1];
    const vertical = w > 0 && w <= 40 && h * 2 >= ph && Math.abs(p.b[2] - n.b[2]) <= 40;
    const horizontal = h > 0 && h <= 40 && w * 2 >= pw && Math.abs(p.b[3] - n.b[3]) <= 40;
    return vertical || horizontal ? [i] : [];
  });
}

/** A toolbar as large as the screen is the system's container, no bar (RunnerCore's `containerBars`). */
export const containerBars = (nodes: Node[], screen: { w: number; h: number }): number[] =>
  nodes.flatMap((n, i) =>
    n.c === 'Toolbar' && n.b[2] - n.b[0] >= screen.w && n.b[3] - n.b[1] >= screen.h ? [i] : [],
  );

const nonEmpty = (s: string | undefined) => (s ? s : undefined);

/** One node, as the runner builds it from XCUI's snapshot (`Device.node`). */
function toNode(raw: RawAx, parent: number, screen: { w: number; h: number }): Node {
  const [x = 0, y = 0, w = 0, h = 0] = raw.f ?? [];
  const b = [Math.round(x), Math.round(y), Math.round(x + w), Math.round(y + h)] as Node['b'];
  const a = raw.a ?? 0;
  const c = SERVER_TYPES[a] ?? TYPES[a] ?? `Type${a}`;
  const traits = BigInt(raw.t ?? '0');
  const value =
    raw.v === undefined ? undefined : raw.v === true ? '1' : raw.v === false ? '0' : String(raw.v);
  let f = 0;
  if (w > 0 && h > 0 && x < screen.w && y < screen.h && x + w > 0 && y + h > 0) f |= F.visible;
  if (CLICKABLE.has(c)) f |= F.clickable;
  if (EDITABLE.has(c)) f |= F.editable | F.focusable;
  if (raw.n || (EDITABLE.has(c) && traits & TRAIT_EDITING)) f |= F.focused;
  if (!(traits & TRAIT_NOT_ENABLED)) f |= F.enabled;
  if (traits & TRAIT_SELECTED) f |= F.selected;
  if (SCROLLABLE.has(c)) f |= F.scrollable;
  if (c === 'SecureTextField') f |= F.password;
  if (CHECKABLE.has(c)) {
    f |= F.checkable;
    if (value === '1') f |= F.checked;
  }
  const hint = nonEmpty(raw.h);
  const text = value === hint ? undefined : nonEmpty(value);
  // the app itself is the screen, not an element of it
  const label = c === 'Application' ? undefined : nonEmpty(raw.l);
  const id = nonEmpty(raw.i);
  return {
    p: parent,
    w: 0,
    c,
    b,
    f,
    ...(id !== undefined && { id }),
    ...(text !== undefined && { t: text }),
    ...(label !== undefined && { d: label }),
    ...(hint !== undefined && { h: hint }),
  };
}

export type Refusal = { refused: string };

export type DirectRead = {
  tree: Tree;
  busy: boolean;
  copies: boolean;
  /** The home screen read past a widget: what the widget holds only the runner can read. */
  partial?: boolean;
};

const copyKey = (n: Node) => `${n.c}#${n.id ?? ''}@${n.b.join(',')}`;

/**
 * What the runner decided about a screen's repeated controls, seen in its read of the same screen: the
 * copies it left out as out of reach. Undefined when the reads are not of the same screen.
 */
export function learnCopies(direct: Tree, runner: Tree): Set<string> | undefined {
  if (direct.nodes.length !== runner.nodes.length) return undefined;
  const hidden = new Set<string>();
  for (let i = 0; i < direct.nodes.length; i++) {
    const a = direct.nodes[i]!;
    const b = runner.nodes[i]!;
    if (a.c !== b.c || a.id !== b.id) return undefined;
    if ((a.f & F.visible) !== 0 && (b.f & F.visible) === 0) hidden.add(copyKey(a));
  }
  return hidden;
}

/** The tree with those copies left out, as the runner's would have them. */
export function withoutCopies(t: Tree, hidden: Set<string>): Tree {
  if (!hidden.size) return t;
  const nodes = t.nodes.map((n) => (hidden.has(copyKey(n)) ? { ...n, f: n.f & ~F.visible } : n));
  return { ...t, nodes, hash: layoutHash(nodes) };
}

/**
 * The helper's tree in the runner's shape: nodes breadth first, flags as XCUI gives them, so refs and
 * diffs do not depend on who read. Refused when it would not say the same as the runner: content of
 * another process on screen (but for a widget on the home screen, which is `partial`), or an alert. `copies`: a control found twice at different places, and only XCUI
 * can tell which one a tap reaches (`learnCopies`).
 */
export function toTree(
  raw: RawAx,
  bundle: string,
  screen: { w: number; h: number },
  elapsedMs: number,
): DirectRead | Refusal {
  const nodes: Node[] = [];
  const queue: [RawAx, number][] = [[raw, -1]];
  let busy = false;
  let truncated = false;
  let partial = false;
  for (let head = 0; head < queue.length; head++) {
    const [r, parent] = queue[head]!;
    const n = toNode(r, parent, screen);
    if (r.r && (n.f & F.visible) !== 0) {
      // what fills the screen is what it shows, as Spotlight does; a widget beside the icons is no reason for a runner
      const [, , w = 0, h = 0] = r.f ?? [];
      if (bundle !== HOME_SCREEN_APP || w * h >= (screen.w * screen.h) / 2)
        return { refused: 'remote-content' };
      partial = true;
    }
    // XCUI makes an Alert of it and leaves out what it covers; the settle has to see it as one
    if (r.e?.includes('AlertController')) return { refused: 'alert' };
    if (n.c === 'ActivityIndicator' && (n.f & F.visible) !== 0) busy = true;
    if (r.cut) truncated = true;
    const index = nodes.push(n) - 1;
    for (const k of r.k ?? []) queue.push([k, index]);
  }
  for (const i of [...scrollIndicators(nodes), ...containerBars(nodes, screen)])
    nodes[i]!.f &= ~F.visible;
  const places = new Map<string, string[]>();
  for (const n of nodes)
    if (n.id !== undefined && (n.f & F.visible) !== 0) {
      const key = `${n.c}#${n.id}`;
      places.set(key, [...(places.get(key) ?? []), n.b.join()]);
    }
  return {
    busy,
    ...(partial && { partial }),
    // at one place a touch has nothing to choose; an id repeated more is a list's rows; and on the home screen a
    // widget and its app's icon are two things to tap, each opening the app
    copies:
      bundle !== HOME_SCREEN_APP &&
      [...places.values()].some(
        (at) => (at.length === 2 || at.length === 3) && new Set(at).size > 1,
      ),
    tree: {
      windows: [
        {
          type: 1,
          pkg: bundle,
          layer: 0,
          b: nodes[0]?.b ?? [0, 0, 0, 0],
          active: true,
          focused: true,
        },
      ],
      nodes,
      truncated,
      elapsedMs,
      hash: layoutHash(nodes),
    },
  };
}

/** Does the helper's read say what the runner's says? Layout and names of everything shown. */
export function sameTree(a: Tree, b: Tree): boolean {
  if (!sameLayout(a.nodes, b.nodes)) return false;
  const x = a.nodes.filter(shown);
  const y = b.nodes.filter(shown);
  // a clock or a counter on screen moves between the two reads
  const off = x.filter((n, i) => n.d !== y[i]!.d || n.t !== y[i]!.t).length;
  return off <= x.length * 0.2;
}

/**
 * What sticks out over the side of the screen and has a name: during a push the old page does, drawn part
 * way out, with no change in the tree until it goes (the app's own animation reports say nothing of it).
 */
export function stickingOut(nodes: Node[], width: number): Set<string> {
  return new Set(
    nodes
      // over one side only: what spans the whole screen (a dimming overlay) is not on its way anywhere
      .filter((n) => shown(n) && !!(n.id ?? n.d ?? n.t) && n.b[0] < 0 !== n.b[2] > width)
      .map(copyKey),
  );
}

/** A point on the keyboard: another process may draw it, and its touches are not the app's to report. */
export function onKeyboard(nodes: Node[], x: number, y: number): boolean {
  return nodes.some(
    (n) =>
      (n.c === 'Keyboard' || n.c === 'Key') &&
      shown(n) &&
      x >= n.b[0] &&
      x < n.b[2] &&
      y >= n.b[1] &&
      y < n.b[3],
  );
}

export const hasAlert = (nodes: Node[]) =>
  nodes.some((n) => (n.c === 'Alert' || n.c === 'Sheet') && (n.f & F.visible) !== 0);
