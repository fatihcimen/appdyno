import { must } from '../must.js';
import { familyOf, type Rect, type UiElement } from './elements.js';
import type { PlatformScreen, ScreenOptions } from './port.js';

type Role =
  | 'button'
  | 'link'
  | 'switch'
  | 'checkbox'
  | 'radio'
  | 'textField'
  | 'cell'
  | 'slider'
  | 'tab'
  | 'image';

/** Bare type names (package path and the iOS element-type prefix dropped). */
const ROLES: Record<string, Role> = {
  button: 'button',
  imagebutton: 'button',
  floatingactionbutton: 'button',
  materialbutton: 'button',
  appcompatbutton: 'button',
  link: 'link',
  switch: 'switch',
  switchcompat: 'switch',
  switchmaterial: 'switch',
  toggle: 'switch',
  togglebutton: 'switch',
  checkbox: 'checkbox',
  appcompatcheckbox: 'checkbox',
  materialcheckbox: 'checkbox',
  radio: 'radio',
  radiobutton: 'radio',
  appcompatradiobutton: 'radio',
  textfield: 'textField',
  securetextfield: 'textField',
  searchfield: 'textField',
  edittext: 'textField',
  appcompatedittext: 'textField',
  textinputedittext: 'textField',
  autocompletetextview: 'textField',
  cell: 'cell',
  slider: 'slider',
  seekbar: 'slider',
  stepper: 'slider',
  segmentedcontrol: 'tab',
  tab: 'tab',
  image: 'image',
  imageview: 'image',
  appcompatimageview: 'image',
  shapeableimageview: 'image',
};

/** Less of an element than this on the screen: a hidden pager page or a scrolled-away carousel item. */
const MIN_ON_SCREEN = 0.5;
const MAX_LABEL = 60;
const MAX_CONTEXT = 40;

export const bare = (type: string) => {
  const t = type.toLowerCase();
  const name = t.slice(t.lastIndexOf('.') + 1);
  return name.startsWith('xcuielementtype') ? name.slice('xcuielementtype'.length) : name;
};
const isWebView = (type: string) => /^web.?view$/.test(bare(type));
/** `com.android.systemui:id/clock` → `com.android.systemui`. */
export const packageOf = (id: string | undefined) => /^([A-Za-z][\w.]*):id\//.exec(id ?? '')?.[1];
const ownName = (el: UiElement) => (el.label || el.text || '').trim();
const cutAt = (text: string, max: number) => {
  const chars = Array.from(text); // code points: never half a surrogate pair
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
};
const cut = (text: string) => cutAt(text, MAX_LABEL);
/** What tells an element apart is said only so far: the rest of a paragraph tells nothing more. */
export const cutContext = (text: string) => cutAt(text, MAX_CONTEXT);
/** `com.example.shop:id/basket_btn` → `basket_btn`; iOS identifiers stay as they are. */
const idOf = (identifier: string | undefined) =>
  identifier?.replace(/^[A-Za-z][\w.]*:id\//, '').trim() || undefined;
const round10 = (n: number) => Math.round(n / 10) * 10;

type Item = {
  el: UiElement;
  index: number;
  type: string;
  role: Role | 'tappable' | undefined;
  r: { x: number; y: number; w: number; h: number };
};

/**
 * The screen in tap units: the largest root when it sits at the origin (the decor view, an application
 * node) or beside a navigation bar on the left, where the platform has one there; else what the
 * platform's bars tell; undefined (nothing filtered) when neither is there.
 */
export function windowRect(elements: UiElement[], port: PlatformScreen): Rect | undefined {
  const area = (r: Rect) => r.width * r.height;
  const [big, next] = elements
    .flatMap((e) => (e.parent === undefined && e.rect && area(e.rect) > 0 ? [e.rect] : []))
    .sort((a, b) => area(b) - area(a));
  const same = (a: Rect, b: Rect) =>
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  const sideBar = port.barBesideWindow && !!big && big.width > big.height;
  // an activity in transition shows two full-screen roots: equal ones are still the window
  if (
    big &&
    (big.x === 0 || sideBar) &&
    big.y === 0 &&
    (!next || area(big) > area(next) || same(big, next))
  )
    return big;
  return port.windowByBars(elements);
}

const onScreen = (r: Rect, w: Rect) => {
  const iw = Math.min(r.x + r.width, w.x + w.width) - Math.max(r.x, w.x);
  const ih = Math.min(r.y + r.height, w.y + w.height) - Math.max(r.y, w.y);
  return iw > 0 && ih > 0 && (iw * ih) / (r.width * r.height) >= MIN_ON_SCREEN;
};

/**
 * The app's part of the tree: what the platform says is none of the app's goes, with what it holds but
 * for what carries the app's own id. Elements mostly off the screen are left out.
 */
function appTree(elements: UiElement[], opts: ScreenOptions) {
  const { port } = opts;
  // an app not on the screen has nothing to keep apart from: what is in front is what must be seen
  const front = elements.some((el) => el.pkg === opts.appId) ? opts.appId : undefined;
  const dropped = new Set<number>(port.keyboardParts?.(elements));
  const systemUi = new Set<number>();
  elements.forEach((el, i) => {
    const pkg = packageOf(el.identifier);
    const own = opts.appId !== undefined && pkg === opts.appId && !systemUi.has(el.parent ?? -1);
    const inherited = el.parent !== undefined && dropped.has(el.parent) && !own;
    if (port.notTheApp(el, front) || inherited) dropped.add(i);
    if (port.isSystemUi(el) || (el.parent !== undefined && systemUi.has(el.parent)))
      systemUi.add(i);
  });

  const items = new Map<number, Item>();
  const win = windowRect(elements, port);
  const family = familyOf(elements);
  const below = (y: number) =>
    win && y > win.y ? { ...win, y, height: win.height - (y - win.y) } : win;
  const bars = (port.topBars?.(elements) ?? []).flatMap((i) => {
    const { parent, rect } = must(elements[i], 'a bar');
    return parent !== undefined && rect ? [{ i, parent, rect }] : [];
  });
  // what the status bar covers is off the screen for a touch as what is past its edge
  const seen = bars.length ? below(Math.min(...bars.map((b) => b.rect.y))) : win;
  // and so is what of a bar's own screen lies under the bar, which takes the touch: what is the bar's own stays, and a
  // sheet or a cover over that screen is another's
  const shownIn = (i: number) => {
    const up = bars.length ? family.ancestors(i) : [];
    const bar = bars.find((b) => i !== b.i && up.includes(b.parent) && !up.includes(b.i));
    return bar ? below(bar.rect.y + bar.rect.height) : seen;
  };
  elements.forEach((el, index) => {
    if (dropped.has(index) || !el.rect || el.rect.width <= 0 || el.rect.height <= 0) return;
    const shown = seen && shownIn(index);
    if (el.visible === false || (shown && !onScreen(el.rect, shown))) return;
    const type = bare(el.type);
    const known = ROLES[type];
    const role =
      known === 'image' && el.clickable
        ? 'button'
        : (known ?? (el.clickable ? ('tappable' as const) : undefined));
    const { x, y, width, height } = el.rect;
    items.set(index, { el, index, type, role, r: { x, y, w: width, h: height } });
  });

  const descendants = (i: number): Item[] =>
    family.descendants(i).flatMap((d) => items.get(d) ?? []);
  const { ancestors } = family;
  const nameOf = (i: Item) =>
    ownName(i.el) ||
    descendants(i.index)
      .map((d) => ownName(d.el))
      .filter(Boolean)
      .join(' ');
  return { items, descendants, ancestors, nameOf, win };
}

export type ScreenElement = {
  ref: string;
  role: string;
  label: string;
  /** Identifier (Android resource id without its package). */
  id?: string;
  /** Stable across runs: the id, else the label, else the path from the nearest ancestor with an id, else the rounded centre. */
  name: string;
  nameKind: 'label' | 'id' | 'path' | 'position';
  rect: Rect;
  /** A path or a position: the text next to it. */
  context?: string;
  /** The text that tells identical elements apart (the stable refs' context). */
  refContext?: string;
  /** Centre in tap units. */
  x: number;
  y: number;
  flags: ('clickable' | 'checked' | 'focused' | 'web')[];
};

/**
 * The elements a tester reads or taps: controls, elements with a label or text, and where the platform
 * says so an untyped one named only by its id; system UI excluded. A control's label falls back to the text inside it. `all`:
 * every app element with a ref.
 */
export function screenElements(
  elements: UiElement[],
  opts: ScreenOptions,
  all = false,
): ScreenElement[] {
  const { items, nameOf, ancestors, descendants, win } = appTree(elements, opts);
  const screenWide = (r: Rect | undefined) =>
    !!r && !!win && r.width * r.height >= 0.5 * Math.min(win.width * win.height, 1e8);
  const at = (n: number) => must(elements[n], `element ${n}`);
  const pathOf = (i: Item, role: string) => {
    const anc = ancestors(i.index).find((a) => idOf(at(a).identifier) && !screenWide(at(a).rect));
    if (anc === undefined) return undefined;
    const same = descendants(anc).filter((d) => (d.role ?? d.type) === role);
    return `${cut(must(idOf(at(anc).identifier), 'its id'))}/${role}[${same.indexOf(i)}]`;
  };
  const labelled = [...items.values()].filter((i) => ownName(i.el));
  const centre = (i: Item) => ({ x: i.r.x + i.r.w / 2, y: i.r.y + i.r.h / 2 });
  const contextOf = (i: Item) => {
    const c = centre(i);
    const rank = (o: Item) => {
      const oc = centre(o);
      const row = Math.abs(oc.y - c.y) <= Math.max(i.r.h, 20) ? 0 : 1;
      return [row, Math.hypot(oc.x - c.x, oc.y - c.y)] as const;
    };
    const best = labelled
      .filter((o) => o.index !== i.index)
      .map((o) => ({ o, k: rank(o) }))
      .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1])[0];
    return best && cutContext(ownName(best.o.el));
  };
  const out: ScreenElement[] = [];
  const from: number[] = [];
  for (const i of items.values()) {
    if (!i.el.ref) continue;
    const control = i.role !== undefined && i.role !== 'image';
    const label = cut(control ? nameOf(i) : ownName(i.el));
    const id = idOf(i.el.identifier);
    const idOnly = opts.port.listsByIdAlone && i.type === 'other' && id !== undefined;
    const field = i.role === 'textField';
    // what a web view shows: its coordinates hold, its text is the page's
    const web = [i.index, ...ancestors(i.index)].some((a) => isWebView(at(a).type));
    // XCUI says every element of a web view has the focus: there it is a field's, where typing goes
    const focused = i.el.focused && (!web || i.el.editable);
    if (!all && !control && !label && !idOnly && !focused && !i.el.checked) continue;
    const x = Math.round(i.r.x + i.r.w / 2);
    const y = Math.round(i.r.y + i.r.h / 2);
    const role = i.role ?? (label ? 'text' : i.type);
    // an empty field is named by its placeholder
    const shown = label || (field && i.el.placeholder ? cut(i.el.placeholder) : '');
    const path = !shown && !id ? pathOf(i, i.role ?? i.type) : undefined;
    const [name, nameKind] = id
      ? ([cut(id), 'id'] as const)
      : shown
        ? ([shown, 'label'] as const)
        : path
          ? ([path, 'path'] as const)
          : ([`at ${round10(x)},${round10(y)}`, 'position'] as const);
    out.push({
      ref: i.el.ref,
      role,
      label: shown,
      ...(id && { id: cut(id) }),
      name,
      nameKind,
      rect: must(i.el.rect, 'its rect'),
      ...((nameKind === 'path' || nameKind === 'position') && { context: contextOf(i) }),
      ...(i.el.refContext && { refContext: i.el.refContext }),
      x,
      y,
      flags: [
        ...(['clickable', 'checked'] as const).filter((f) => i.el[f]),
        ...(focused ? (['focused'] as const) : []),
        ...(web ? (['web'] as const) : []),
      ],
    });
    from.push(i.index);
  }
  return withoutPiles(out, from, ancestors);
}

/**
 * As many elements as this at one point, none inside another, are rows not laid out yet, piled where their list begins
 * at places nothing is: none of them is on the screen.
 */
const PILED = 4;
/** Two centres this close, in tap units, are one point. */
const ONE_POINT = 4;

function withoutPiles(out: ScreenElement[], from: number[], ancestors: (i: number) => number[]) {
  const key = (e: ScreenElement) => `${Math.round(e.x / ONE_POINT)},${Math.round(e.y / ONE_POINT)}`;
  const at = new Map<string, number[]>();
  out.forEach((e, n) => at.set(key(e), [...(at.get(key(e)) ?? []), n]));
  const piled = new Set<number>();
  for (const here of at.values()) {
    const which = new Set(here.map((n) => from[n]));
    const apart = here.filter(
      (n) => !ancestors(must(from[n], 'its element')).some((a) => which.has(a)),
    );
    if (apart.length >= PILED) for (const n of here) piled.add(n);
  }
  return piled.size ? out.filter((_, n) => !piled.has(n)) : out;
}
