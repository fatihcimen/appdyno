import type { Tree } from '@appdyno/protocol';
import type { Rect, UiElement } from './elements.js';

export type Platform = 'ios' | 'android';

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

/** iOS status bar items are root elements in this band. */
const IOS_STATUS_BAR_PT = 50;
/** As tall as it gets, on a phone with a Dynamic Island: a pixel comparison leaves it out. */
const IOS_STATUS_BAND_PT = 64;
const ANDROID_STATUS_BAND_DP = 56;
/** Less of an element than this on the screen: a hidden pager page or a scrolled-away carousel item. */
const MIN_ON_SCREEN = 0.5;
const MAX_LABEL = 60;
const MAX_CONTEXT = 40;

const bare = (type: string) => {
  const t = type.toLowerCase();
  const name = t.slice(t.lastIndexOf('.') + 1);
  return name.startsWith('xcuielementtype') ? name.slice('xcuielementtype'.length) : name;
};
const isWebView = (type: string) => /^web.?view$/.test(bare(type));
/** `com.android.systemui:id/clock` → `com.android.systemui`. */
const packageOf = (id: string | undefined) => /^([A-Za-z][\w.]*):id\//.exec(id ?? '')?.[1];
const ownName = (el: UiElement) => (el.label || el.text || '').trim();
const cut = (text: string) => {
  const chars = Array.from(text); // code points: never half a surrogate pair
  return chars.length > MAX_LABEL ? `${chars.slice(0, MAX_LABEL - 1).join('')}…` : text;
};
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
 * The screen in tap units: the largest root when it sits at the origin (the decor view, an iOS
 * application node) or, on Android in landscape, beside a navigation bar on the left; else on iOS the
 * width of a navigation or tab bar at x 0 with no height limit; undefined (nothing filtered) when
 * neither is there.
 */
export function windowRect(elements: UiElement[], platform: Platform): Rect | undefined {
  const area = (r: Rect) => r.width * r.height;
  const roots = elements.filter((e) => e.parent === undefined && e.rect && area(e.rect) > 0);
  const [big, next] = roots.map((e) => e.rect!).sort((a, b) => area(b) - area(a));
  const same = (a: Rect, b: Rect) =>
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  const sideBar = platform !== 'ios' && !!big && big.width > big.height;
  // an activity in transition shows two full-screen roots: equal ones are still the window
  if (
    big &&
    (big.x === 0 || sideBar) &&
    big.y === 0 &&
    (!next || area(big) > area(next) || same(big, next))
  )
    return big;
  if (platform !== 'ios') return undefined;
  const bar = elements.find(
    (e) => /^(navigationbar|tabbar)$/.test(bare(e.type)) && e.rect?.x === 0,
  );
  return bar && { x: 0, y: -1e9, width: bar.rect!.width, height: 2e9 };
}

const onScreen = (r: Rect, w: Rect) => {
  const iw = Math.min(r.x + r.width, w.x + w.width) - Math.max(r.x, w.x);
  const ih = Math.min(r.y + r.height, w.y + w.height) - Math.max(r.y, w.y);
  return iw > 0 && ih > 0 && (iw * ih) / (r.width * r.height) >= MIN_ON_SCREEN;
};

/**
 * What the status bar takes at the top of the screen, in tap units, for what compares pixels: its clock
 * moves. Android: the first app window's top when it leaves room for the bar, else a tall bar's height.
 */
export function statusBand(tree: Tree, platform: Platform, density = 160): number {
  if (platform === 'ios') return IOS_STATUS_BAND_PT;
  const app = tree.windows.find((w) => w.type === 1 && w.b[1] > 0);
  return app ? app.b[1] : Math.round((ANDROID_STATUS_BAND_DP * density) / 160);
}

/**
 * The app's part of the tree: Android drops the system UI's nodes and, with an app id, other packages'
 * nodes (by resource id) except those carrying the app's own id; iOS drops the status bar band.
 * Elements mostly off the screen are left out.
 */
function appTree(elements: UiElement[], opts: { platform: Platform; appId?: string }) {
  const { platform } = opts;
  // an app not on the screen has nothing to keep apart from: what is in front is what must be seen
  const inFront = opts.appId !== undefined && elements.some((el) => el.pkg === opts.appId);
  const dropped = new Set<number>();
  const systemUi = new Set<number>();
  const children = new Map<number, number[]>();
  elements.forEach((el, i) => {
    if (el.parent !== undefined) children.set(el.parent, [...(children.get(el.parent) ?? []), i]);
    const pkg = packageOf(el.identifier);
    const foreign =
      platform === 'android' &&
      pkg !== undefined &&
      (pkg === 'com.android.systemui' ||
        (inFront && pkg !== opts.appId && pkg !== 'android' && !isSystemDialog(el.pkg)));
    const statusBar =
      platform === 'ios' &&
      el.parent === undefined &&
      el.rect !== undefined &&
      el.rect.y + el.rect.height <= IOS_STATUS_BAR_PT;
    const own = opts.appId !== undefined && pkg === opts.appId && !systemUi.has(el.parent ?? -1);
    const inherited = el.parent !== undefined && dropped.has(el.parent) && !own;
    if (foreign || statusBar || inherited) dropped.add(i);
    if (
      platform === 'android' &&
      (pkg === 'com.android.systemui' || (el.parent !== undefined && systemUi.has(el.parent)))
    )
      systemUi.add(i);
  });

  const items = new Map<number, Item>();
  const win = windowRect(elements, platform);
  elements.forEach((el, index) => {
    if (dropped.has(index) || !el.rect || el.rect.width <= 0 || el.rect.height <= 0) return;
    if (el.visible === false || (win && !onScreen(el.rect, win))) return;
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
    (children.get(i) ?? []).flatMap((c) => [
      ...(items.has(c) ? [items.get(c)!] : []),
      ...descendants(c),
    ]);
  const ancestors = (i: number): number[] => {
    const out: number[] = [];
    for (let p = elements[i]!.parent; p !== undefined; p = elements[p]!.parent) out.push(p);
    return out;
  };
  const nameOf = (i: Item) =>
    ownName(i.el) ||
    descendants(i.index)
      .map((d) => ownName(d.el))
      .filter(Boolean)
      .join(' ');
  return { items, descendants, ancestors, nameOf, win };
}

/** Packages whose windows are the system's dialogs (they stay on the app's screen). */
export const isSystemDialog = (pkg: string | undefined) =>
  !!pkg && /^(android|com\.(google\.)?android\.(permissioncontroller|packageinstaller))$/.test(pkg);

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
 * The elements a tester reads or taps: controls, elements with a label or text, and on iOS an `Other`
 * named only by its id; system UI excluded. A control's label falls back to the text inside it. `all`:
 * every app element with a ref.
 */
export function screenElements(
  elements: UiElement[],
  opts: { platform: Platform; appId?: string },
  all = false,
): ScreenElement[] {
  const { items, nameOf, ancestors, descendants, win } = appTree(elements, opts);
  const screenWide = (r: Rect | undefined) =>
    !!r && !!win && r.width * r.height >= 0.5 * Math.min(win.width * win.height, 1e8);
  const pathOf = (i: Item, role: string) => {
    const anc = ancestors(i.index).find(
      (a) => idOf(elements[a]!.identifier) && !screenWide(elements[a]!.rect),
    );
    if (anc === undefined) return undefined;
    const same = descendants(anc).filter((d) => (d.role ?? d.type) === role);
    return `${cut(idOf(elements[anc]!.identifier)!)}/${role}[${same.indexOf(i)}]`;
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
    const text = best && Array.from(ownName(best.o.el));
    return (
      text &&
      (text.length > MAX_CONTEXT ? `${text.slice(0, MAX_CONTEXT - 1).join('')}…` : text.join(''))
    );
  };
  const out: ScreenElement[] = [];
  for (const i of items.values()) {
    if (!i.el.ref) continue;
    const control = i.role !== undefined && i.role !== 'image';
    const label = cut(control ? nameOf(i) : ownName(i.el));
    const id = idOf(i.el.identifier);
    const idOnly = opts.platform === 'ios' && i.type === 'other' && id !== undefined;
    const field = i.role === 'textField';
    if (!all && !control && !label && !idOnly && !i.el.focused && !i.el.checked) continue;
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
      rect: i.el.rect!,
      ...((nameKind === 'path' || nameKind === 'position') && { context: contextOf(i) }),
      ...(i.el.refContext && { refContext: i.el.refContext }),
      x,
      y,
      flags: [
        ...(['clickable', 'checked', 'focused'] as const).filter((f) => i.el[f]),
        // what a web view shows: its coordinates hold, its text is the page's
        ...([i.index, ...ancestors(i.index)].some((a) => isWebView(elements[a]!.type))
          ? (['web'] as const)
          : []),
      ],
    });
  }
  return out;
}
