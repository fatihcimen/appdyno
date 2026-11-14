import type { Platform } from '@appdyno/protocol';
import { NATIVE_TOOLKIT } from './device.js';
import type { ViewTree } from './device-views.js';
import { must } from './must.js';
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

/** A class of SwiftUI's own, mangled or demangled. */
const SWIFTUI = String.raw`^(_Tt[A-Z]*7SwiftUI|SwiftUI\.)`;

/**
 * Each framework by the class of a view its content hangs from. A generic Swift class comes mangled or demangled, so
 * SwiftUI's are found by their module and a part of the name: a hosting view of SwiftUI's own, never UIKit's (iOS 26
 * hosts its floating bars in one over the whole screen). UIKit and Android views have such a view only as an island:
 * the host of a representable the app wrote, as SwiftUI hosts its own navigation stack and lists in representables
 * too, and Compose's holder of an Android view.
 */
const ROOTS: readonly (readonly [Framework, RegExp])[] = [
  ['Flutter', /(^|\.)FlutterView$/],
  ['React Native', /^RCT(RootView|SurfaceHosting)|\.React(Root|Surface)View$/],
  ['Compose', /^androidx\.compose\.ui\.platform\.(Android)?ComposeView$/],
  ['web view', /WebView$/],
  ['SwiftUI', new RegExp(`${SWIFTUI}.*HostingView`)],
  ['UIKit', new RegExp(`${SWIFTUI}.*PlatformViewHost.*Adaptor(G?[VCO][1-9]|<(?!SwiftUI\\.))`)],
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

/** What is drawn of each view (it, and every view over it), and each view's ancestors, the nearest first. */
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
  return { drawn, ancestors };
}

/**
 * The frameworks a screen is drawn with, outermost first: at each step the roots right under the last step's (under
 * none at first), and of them the framework whose roots cover most of the content. Drawn over one another, the later
 * one is on top.
 */
function levelsOf(nodes: Node[], content: Rect) {
  const { drawn, ancestors } = readNodes(nodes);
  const kinds = nodes.map((n) => kindOf(n.cls));
  const roots = nodes.flatMap((n, i) => (kinds[i] && n.rect && drawn(i) ? [i] : []));
  const above = new Map(roots.map((r) => [r, ancestors(r).find((a) => roots.includes(a))]));
  const levels: Framework[] = [];
  for (let under: (number | undefined)[] = [undefined]; ;) {
    const below = roots.filter((r) => under.includes(above.get(r)));
    const share = new Map<Framework, number>();
    for (const r of below) {
      const kind = must(kinds[r], "a root's framework");
      const rect = must(nodes[r]?.rect, "a root's place");
      share.set(kind, (share.get(kind) ?? 0) + overlap(rect, content) / area(content));
    }
    const top = [...share].filter(([, part]) => part > MOST).at(-1)?.[0];
    if (!top) return levels;
    levels.push(top);
    under = below.filter((r) => kinds[r] === top);
  }
}

/** The innermost framework drawing most of the content, in the nearest that holds it and is no island. */
function label(nodes: Node[], otherwise?: Framework): FrameworkLabel | undefined {
  const { drawn } = readNodes(nodes);
  const content = nodes
    .flatMap((n, i) => (n.parent === undefined && n.rect && drawn(i) ? [n.rect] : []))
    .reduce<Rect | undefined>((a, r) => (a && area(a) >= area(r) ? a : r), undefined);
  if (!content) return undefined;
  const levels = levelsOf(nodes, content);
  const name = levels.at(-1);
  if (!name) return otherwise && { name: otherwise };
  const inside = levels
    .slice(0, -1)
    .reverse()
    .find((f) => !ISLANDS.has(f) && f !== name);
  return { name, ...(inside && { inside }) };
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
