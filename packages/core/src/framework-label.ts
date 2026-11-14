import type { Platform } from '@appdyno/protocol';
import { NATIVE_TOOLKIT } from './device.js';
import type { ViewTree } from './device-views.js';
import type { Rect, UiElement } from './screen/elements.js';

export const FRAMEWORKS = [
  'Flutter',
  'React Native',
  'Compose',
  'web view',
  'SwiftUI',
  'UIKit',
  'Android views',
] as const;
export type Framework = (typeof FRAMEWORKS)[number];

/** What draws most of a screen's content, and the framework that holds it there, where another does. */
export type FrameworkLabel = { name: Framework; inside?: Framework };

/**
 * Each framework by the class of a view its content hangs from. A generic Swift class comes mangled or demangled, so
 * SwiftUI's are found by a part of the name. UIKit and Android views have such a view only as an island: a SwiftUI
 * representable's host, and Compose's holder of an Android view.
 */
const ROOTS: readonly (readonly [Framework, RegExp])[] = [
  ['Flutter', /(^|\.)FlutterView$/],
  ['React Native', /^RCT(RootView|SurfaceHosting)|\.React(Root|Surface)View$/],
  ['Compose', /^androidx\.compose\.ui\.platform\.(Android)?ComposeView$/],
  ['web view', /WebView$/],
  ['SwiftUI', /UIHostingView/],
  ['UIKit', /PlatformViewHost/],
  ['Android views', /^androidx\.compose\.ui\.viewinterop\./],
];

/** An island names what is in it, never what holds another framework: a web view in a representable is in SwiftUI. */
const ISLANDS: ReadonlySet<Framework> = new Set(['UIKit', 'Android views']);

/** More of the content than this, and a framework draws the screen. */
const MOST = 0.5;

type Node = { cls: string; rect?: Rect | undefined; shown: boolean; parent?: number | undefined };

const area = (r: Rect) => Math.max(0, r.width) * Math.max(0, r.height);
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const kindOf = (cls: string) => ROOTS.find(([, by]) => by.test(cls))?.[0];

/** The framework of each view that roots one, and what is drawn of each view: it, and every view over it. */
function readNodes(nodes: Node[]) {
  const seen: (boolean | undefined)[] = [];
  const drawn = (i: number): boolean => {
    const known = seen[i];
    if (known !== undefined) return known;
    const n = nodes[i];
    // a parent out of the list, or a loop, leaves the view unseen
    seen[i] = false;
    const up = n?.parent === undefined || drawn(n.parent);
    seen[i] = !!n?.shown && !!n.rect && area(n.rect) > 0 && up;
    return seen[i];
  };
  const ancestors = (i: number) => {
    const out: number[] = [];
    for (let p = nodes[i]?.parent; p !== undefined && !out.includes(p); p = nodes[p]?.parent)
      out.push(p);
    return out;
  };
  return { drawn, ancestors, kinds: nodes.map((n) => kindOf(n.cls)) };
}

/** Each framework drawing most of `content`, with the frameworks over its roots, the nearest first. */
function mostOf(
  nodes: Node[],
  content: Rect,
  { drawn, ancestors, kinds }: ReturnType<typeof readNodes>,
) {
  const share = new Map<Framework, number>();
  const holders = new Map<Framework, Framework[]>();
  nodes.forEach((n, i) => {
    const kind = kinds[i];
    if (!kind || !n.rect || !drawn(i)) return;
    const over = ancestors(i).flatMap((a) => kinds[a] ?? []);
    // a root under one of its own kind is drawn by that one already
    if (over.includes(kind)) return;
    share.set(kind, (share.get(kind) ?? 0) + overlap(n.rect, content) / area(content));
    holders.set(kind, [...(holders.get(kind) ?? []), ...over]);
  });
  return [...share]
    .filter(([, part]) => part > MOST)
    .map(([name]) => ({ name, over: holders.get(name) ?? [] }));
}

/** The innermost of the frameworks drawing most of the content, in the nearest that holds it and is no island. */
function label(nodes: Node[], otherwise?: Framework): FrameworkLabel | undefined {
  const read = readNodes(nodes);
  const roots = nodes.flatMap((n, i) =>
    n.parent === undefined && n.rect && read.drawn(i) ? [n.rect] : [],
  );
  const content = roots.reduce<Rect | undefined>(
    (a, r) => (a && area(a) >= area(r) ? a : r),
    undefined,
  );
  if (!content) return undefined;
  const most = mostOf(nodes, content, read);
  // drawn over one another and held by neither: the later one is on top
  const inner = most.filter((m) => !most.some((o) => o.over.includes(m.name))).at(-1);
  if (!inner) return otherwise && { name: otherwise };
  const inside = inner.over.find((f) => !ISLANDS.has(f) && f !== inner.name);
  return { name: inner.name, ...(inside && { inside }) };
}

/** What draws most of the screen by the app's native views: a platform's own toolkit where nothing else does. */
export const frameworkOfViews = (tree: ViewTree, platform: Platform) =>
  tree.framework ??
  label(
    tree.views.map((v) => ({
      cls: v.class,
      rect: v.rect,
      shown: !v.hidden && (v.alpha ?? 1) > 0,
      parent: v.parent,
    })),
    NATIVE_TOOLKIT[platform],
  );

/**
 * What draws most of the screen by its accessibility tree, where a class tells: an element's class is the one its view
 * gives a screen reader, so a toolkit's own is seldom there, and none tells SwiftUI from UIKit. Undefined: not known.
 */
export const frameworkOfElements = (elements: UiElement[]) =>
  label(
    elements.map((e) => ({
      cls: e.type,
      rect: e.rect,
      shown: e.visible !== false,
      parent: e.parent,
    })),
  );
