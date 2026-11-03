import type { ActParams, Key, Tree } from '@appdyno/protocol';

type Node = Tree['nodes'][number];
import { type HelperAnswer, type HelperProcess, startSimAx, startSimHid } from './simhelper.js';

/** XCUI's element types by raw value (the runner's names). */
const TYPES =
  'Any Other Application Group Window Sheet Drawer Alert Dialog Button RadioButton RadioGroup CheckBox DisclosureTriangle PopUpButton ComboBox MenuButton ToolbarButton Popover Keyboard Key NavigationBar TabBar TabGroup Toolbar StatusBar Table TableRow TableColumn Outline OutlineRow Browser CollectionView Slider PageIndicator ProgressIndicator ActivityIndicator SegmentedControl Picker PickerWheel Switch Toggle Link Image Icon SearchField ScrollView ScrollBar StaticText TextField SecureTextField DatePicker TextView Menu MenuItem MenuBar MenuBarItem Map WebView IncrementArrow DecrementArrow Timeline RatingIndicator ValueIndicator SplitGroup Splitter RelevanceIndicator ColorWell HelpTag Matte DockItem Ruler RulerMarker Grid LevelIndicator Cell LayoutArea LayoutItem Handle Stepper Tab TouchBar'.split(
    ' ',
  );
/** The accessibility server numbers the first few on its own; from Button on they are XCUI's. */
const SERVER_TYPES: Record<number, string> = { 0: 'Other', 1: 'Application', 2: 'Window' };
const CLICKABLE = new Set(
  'Button Cell Link Tab MenuItem SegmentedControl Switch Toggle Slider Stepper Picker PickerWheel Key Icon IncrementArrow DecrementArrow RadioButton CheckBox PopUpButton MenuButton DisclosureTriangle PageIndicator'.split(
    ' ',
  ),
);
const EDITABLE = new Set(['TextField', 'SecureTextField', 'SearchField', 'TextView']);
const SCROLLABLE = new Set(['ScrollView', 'Table', 'CollectionView', 'WebView']);
const CHECKABLE = new Set(['Switch', 'Toggle', 'CheckBox']);
const SCROLLERS = new Set(['ScrollView', 'Table', 'CollectionView', 'WebView', 'TextView']);
const F = {
  visible: 1,
  clickable: 2,
  focusable: 4,
  focused: 8,
  enabled: 16,
  checked: 32,
  selected: 64,
  editable: 128,
  scrollable: 256,
  password: 512,
  checkable: 1024,
  longClickable: 2048,
};
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

const TOLERANCE = 4;

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
function hideScrollBars(nodes: Node[]) {
  const named = nodes.map(() => false);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    if ((n.id !== undefined || n.d !== undefined || named[i]) && n.p >= 0 && n.p < i)
      named[n.p] = true;
  }
  nodes.forEach((n, i) => {
    if (n.c !== 'Other' || n.id !== undefined || named[i] || n.p < 0) return;
    const p = nodes[n.p]!;
    if (!SCROLLERS.has(p.c)) return;
    const w = n.b[2] - n.b[0];
    const h = n.b[3] - n.b[1];
    const pw = p.b[2] - p.b[0];
    const ph = p.b[3] - p.b[1];
    const vertical = w > 0 && w <= 40 && h * 2 >= ph && Math.abs(p.b[2] - n.b[2]) <= 40;
    const horizontal = h > 0 && h <= 40 && w * 2 >= pw && Math.abs(p.b[3] - n.b[3]) <= 40;
    if (vertical || horizontal) n.f &= ~F.visible;
  });
}

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
export type DirectRead = { tree: Tree; busy: boolean; copies: boolean };

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
 * another process on screen, or an alert. `copies`: a control found twice, and only XCUI can tell which one
 * a tap reaches (`learnCopies`).
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
  for (let head = 0; head < queue.length; head++) {
    const [r, parent] = queue[head]!;
    const n = toNode(r, parent, screen);
    if (r.r && (n.f & F.visible) !== 0) return { refused: 'remote-content' };
    // XCUI makes an Alert of it and leaves out what it covers; the settle has to see it as one
    if (r.e?.includes('AlertController')) return { refused: 'alert' };
    if (n.c === 'ActivityIndicator' && (n.f & F.visible) !== 0) busy = true;
    if (r.cut) truncated = true;
    const index = nodes.push(n) - 1;
    for (const k of r.k ?? []) queue.push([k, index]);
  }
  hideScrollBars(nodes);
  // a toolbar as large as the screen is the system's container, no bar (RunnerCore's `containerBars`)
  for (const n of nodes)
    if (n.c === 'Toolbar' && n.b[2] - n.b[0] >= screen.w && n.b[3] - n.b[1] >= screen.h)
      n.f &= ~F.visible;
  const copies = new Map<string, number>();
  for (const n of nodes)
    if (n.id !== undefined && (n.f & F.visible) !== 0) {
      const key = `${n.c}#${n.id}`;
      copies.set(key, (copies.get(key) ?? 0) + 1);
    }
  return {
    busy,
    copies: [...copies.values()].some((count) => count === 2 || count === 3),
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

export type TouchEvent = {
  p: 0 | 1 | 2;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  at: number;
};

/** A finger's hold on a tap: as long as a person's, enough for UIKit to see a tap, not a press. */
const TAP_MS = 50;
const STEP_MS = 16;
const DOUBLE_TAP_GAP_MS = 80;

/** The digitizer's events for a touch action, in normalized coordinates; undefined when none applies. */
export function touchEvents(
  action: ActParams,
  screen: { w: number; h: number },
): TouchEvent[] | undefined {
  const X = (x: number) => x / screen.w;
  const Y = (y: number) => y / screen.h;
  type Path = { x: number; y: number; t: number }[];
  const along = (path: Path, t: number) => {
    const next = path.findIndex((q) => q.t >= t);
    if (next <= 0) return next === 0 ? path[0]! : path[path.length - 1]!;
    const a = path[next - 1]!;
    const b = path[next]!;
    const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, t };
  };
  const walk = (paths: Path[]) => {
    const t0 = Math.min(...paths.map((p) => p[0]!.t));
    const t1 = Math.max(...paths.map((p) => p[p.length - 1]!.t));
    const events: TouchEvent[] = [];
    for (let t = t0; ; t = Math.min(t + STEP_MS, t1)) {
      const a = along(paths[0]!, t);
      const b = paths[1] && along(paths[1], t);
      events.push({
        p: t === t0 ? 0 : t === t1 ? 2 : 1,
        x: X(a.x),
        y: Y(a.y),
        ...(b && { x2: X(b.x), y2: Y(b.y) }),
        at: t - t0,
      });
      if (t === t1) return events;
    }
  };
  switch (action.kind) {
    case 'tap':
      return walk([
        [
          { x: action.x, y: action.y, t: 0 },
          { x: action.x, y: action.y, t: TAP_MS },
        ],
      ]).filter((e) => e.p !== 1);
    case 'doubleTap': {
      const press = walk([
        [
          { x: action.x, y: action.y, t: 0 },
          { x: action.x, y: action.y, t: TAP_MS },
        ],
      ]).filter((e) => e.p !== 1);
      return [...press, ...press.map((e) => ({ ...e, at: e.at + TAP_MS + DOUBLE_TAP_GAP_MS }))];
    }
    case 'longPress':
      return walk([
        [
          { x: action.x, y: action.y, t: 0 },
          { x: action.x, y: action.y, t: action.durationMs },
        ],
      ]).filter((e) => e.p !== 1);
    case 'swipe':
      return walk([
        [
          { ...action.from, t: 0 },
          { ...action.to, t: action.durationMs },
        ],
      ]);
    case 'gesture':
      return action.pointers.length <= 2
        ? walk(action.pointers.map((p) => p.map((q) => ({ x: q.x, y: q.y, t: q.t }))))
        : undefined;
    default:
      return undefined;
  }
}

/** USB HID usages of the keys that have one; page 12 is the consumer page of hardware buttons. */
const KEYS: Partial<Record<Key, { page: number; usage: number }>> = {
  home: { page: 12, usage: 0x40 },
  enter: { page: 7, usage: 0x28 },
  delete: { page: 7, usage: 0x2a },
  tab: { page: 7, usage: 0x2b },
  volumeUp: { page: 12, usage: 0xe9 },
  volumeDown: { page: 12, usage: 0xea },
  lock: { page: 12, usage: 0x30 },
  power: { page: 12, usage: 0x30 },
};

export type DirectStatus = { input: string; read: string };

type Starters = {
  ax: (udid: string) => Promise<HelperProcess>;
  hid: (udid: string) => Promise<HelperProcess>;
};

/**
 * One simulator's helpers, used where they prove themselves: their reads are compared with the runner's
 * before the first is believed, and a touch that the app did not report is given to the runner, which
 * then keeps every later one (a Device Hub in Resize Mode swallows touches and reports success).
 * APPDYNO_SIM_DIRECT: `off`, `read` (no direct input), else both.
 */
export class DirectSim {
  private ax: Promise<HelperProcess> | undefined;
  private hid: Promise<HelperProcess> | undefined;
  private readChecked = false;
  private readOff: string | undefined;
  private inputOff: string | undefined;
  private screen: { w: number; h: number } | undefined;
  private rotated = false;
  private axDeaths = 0;
  private misreads = 0;
  /** How many touches the app in front has reported finished, as of the last answer. */
  touchesEnded: number | undefined;

  constructor(
    private readonly udid: string,
    private readonly start: Starters = { ax: startSimAx, hid: startSimHid },
    mode = process.env.APPDYNO_SIM_DIRECT,
  ) {
    if (mode === 'off') this.readOff = this.inputOff = 'APPDYNO_SIM_DIRECT=off';
    if (mode === 'read') this.inputOff = 'APPDYNO_SIM_DIRECT=read';
  }

  status(): DirectStatus {
    return {
      input: this.inputOff ? `runner: ${this.inputOff}` : this.hid ? 'direct' : 'not used yet',
      read: this.readOff ? `runner: ${this.readOff}` : this.readChecked ? 'direct' : 'not used yet',
    };
  }

  /** Portrait only is verified for both helpers. */
  setRotation(rotation: number) {
    this.rotated = rotation !== 0;
  }

  private async helperAx() {
    this.ax ??= this.start.ax(this.udid).catch((e: Error) => {
      this.turnReadOff(`the read helper did not start: ${e.message.slice(0, 120)}`);
      throw e;
    });
    const h = await this.ax;
    // a helper that keeps dying is not asked again
    if (h.closed) {
      this.ax = undefined;
      if (++this.axDeaths >= 3) this.turnReadOff('the read helper keeps ending');
    }
    return h;
  }

  private note(a: HelperAnswer) {
    if (typeof a.touchesEnded === 'number') this.touchesEnded = a.touchesEnded;
    return a;
  }

  /** A read of `bundle` in front, in the runner's shape; a refusal when the runner must answer this one. */
  async read(bundle: string | undefined): Promise<DirectRead | Refusal> {
    if (this.readOff || this.rotated || !bundle) return { refused: this.readOff ?? 'no-target' };
    const a = this.note(await (await this.helperAx()).call({ op: 'read', bundle }, 10_000));
    if (!a.ok) return { refused: a.refused ?? 'refused' };
    const size = a.screen as [number, number];
    this.screen = { w: size[0], h: size[1] };
    if (size[0] > size[1]) return { refused: 'landscape' };
    return toTree(a.tree as RawAx, bundle, this.screen, a.ms ?? 0);
  }

  /** Does its read say what the runner's says? Three times no before a first yes: not for this session. */
  checkRead(direct: Tree, runner: Tree): boolean {
    if (sameTree(direct, runner)) return (this.readChecked = true);
    if (!this.readChecked && ++this.misreads >= 3)
      this.turnReadOff('its read differed from the runner');
    return false;
  }

  turnReadOff(why: string) {
    this.readOff = why;
    this.inputOff ??= 'the direct read is off';
  }

  get readProven() {
    return this.readChecked;
  }

  /** The app in front, without a snapshot. */
  async front(): Promise<string | undefined> {
    if (this.readOff || this.rotated) return undefined;
    const a = this.note(await (await this.helperAx()).call({ op: 'front' }, 5_000));
    return a.ok && typeof a.bundle === 'string' ? a.bundle : undefined;
  }

  /**
   * Asks the app in front to report: its touches finishing are the proof that one got there. Whether that
   * proof can come; a helper that cannot observe at all leaves the input to the runner, unproven touches
   * being what must not happen.
   */
  async arm(): Promise<boolean> {
    if (this.readOff) return false;
    const a = this.note(await (await this.helperAx()).call({ op: 'arm' }, 3_000));
    if (!a.ok && a.refused !== 'no-report' && a.refused !== 'helper-gone')
      this.inputOff = `the app's reports cannot be observed: ${a.refused}`;
    return a.ok;
  }

  /** Sends the action straight to the simulator; false when the runner must do it. */
  async send(action: ActParams): Promise<boolean> {
    if (this.inputOff || this.rotated || !this.screen) return false;
    this.hid ??= this.start.hid(this.udid);
    const hid = await this.hid.catch((e: Error) => {
      this.inputOff = `the input helper did not start: ${e.message.slice(0, 120)}`;
      return undefined;
    });
    if (!hid) return false;
    const key = action.kind === 'key' ? KEYS[action.key] : undefined;
    const events = touchEvents(action, this.screen);
    if (!key && !events) return false;
    if (hid.closed) {
      this.inputOff = 'the input helper ended';
      return false;
    }
    const last = events?.[events.length - 1]?.at ?? 0;
    const a = await hid.call(key ? { op: 'key', ...key } : { op: 'touch', events }, last + 5_000);
    if (!a.ok) this.inputOff = a.error ?? a.refused ?? 'the input helper failed';
    return a.ok;
  }

  /** A touch the app never reported: the runner takes over the input from now on. */
  touchLost() {
    this.inputOff = 'a touch sent directly did not reach the app';
  }

  /** Are both helpers there, and does a read answer? For the doctor. */
  async probe(): Promise<{ input: string; read: string }> {
    const hid = await this.start.hid(this.udid);
    const h = await hid.call({ op: 'ping' }, 8_000);
    hid.close();
    const ax = await this.start.ax(this.udid);
    const a = await ax.call({ op: 'read' }, 10_000);
    ax.close();
    return {
      input: h.ok ? 'ok' : (h.error ?? h.refused ?? 'no answer'),
      read: a.ok ? 'ok' : (a.refused ?? 'no answer'),
    };
  }

  close() {
    void this.ax?.then(
      (h) => h.close(),
      () => undefined,
    );
    void this.hid?.then(
      (h) => h.close(),
      () => undefined,
    );
    this.ax = this.hid = undefined;
  }
}

/** Settling on the host: the runner's `Settler`, over reads that cost little. */
export async function settle<S>(o: {
  actionAt: number;
  quietMs: number;
  /** How long stillness must last while nothing has reacted yet. */
  firstMs: number;
  /** And once something has: the reaction has begun, only its end is awaited. */
  reactedMs: number;
  maxMs: number;
  pollMs: number;
  before: S | undefined;
  read: () => Promise<S>;
  same: (a: S, b: S) => boolean;
  busy: (s: S) => boolean;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ settled: boolean; reads: number; last: S; elapsedMs: number }> {
  const clock = o.clock ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = o.actionAt + o.maxMs;
  let reads = 0;
  let last = o.before;
  let changedAt = o.actionAt;
  let reacted = false;
  for (;;) {
    const readStart = clock();
    const next = await o.read();
    reads++;
    const now = clock();
    const busy = o.busy(next);
    // a read shows the layout as it was when it began: stillness is proven up to its start only
    if (last === undefined || !o.same(next, last) || busy) {
      changedAt = readStart;
      reacted ||= last !== undefined;
    }
    const window = reacted ? Math.min(o.quietMs, o.reactedMs) : Math.max(o.quietMs, o.firstMs);
    const settled = last !== undefined && !busy && readStart - changedAt >= window;
    last = next;
    if (settled || now >= deadline)
      return { settled, reads, last: next, elapsedMs: now - o.actionAt };
    await sleep(Math.max(1, Math.min(o.pollMs, deadline - now)));
  }
}
