import {
  frameworkOfViews,
  idOf,
  TIMEOUTS,
  type Framework,
  type NativeView,
  type Rect,
  type ViewTree,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg } from './adb.js';
import { NOT_ANSWERING } from './window-dump.js';

/** Where the read of the windows ends and the focused activity's own dump begins. */
const MARK = '@@ activity';
const DISPLAY_0 = '/^  Display: mDisplayId=0([^0-9]|$)/,/^  Display: mDisplayId=[1-9]/';

/**
 * The app windows of each display, the top first, then the dump of the activity that has the focus on the phone's own,
 * by its component: `dumpsys activity top` dumps the top activity of every task, and one in a frozen app's process
 * takes 5 s to fail. A component with several instances dumps each, and the focused one's record tells them apart.
 */
export const VIEWS_READ = [
  `w=$(dumpsys window visible-apps | grep -E '^  Display: mDisplayId=|^  mFocusedApp=|^  Window #|^    mDisplayId=|^    mAttrs=|^    Frames:')`,
  'echo "$w"',
  `c=$(echo "$w" | sed -n -E '${DISPLAY_0}s/^  mFocusedApp=ActivityRecord\\{[0-9a-f]+ u[0-9]+ ([^ }]+).*/\\1/p' | head -n 1)`,
  `if [ -n "$c" ]; then echo '${MARK}'; dumpsys activity "$c"; fi`,
].join('; ');

/** The activity with the focus by its record, its window's corner, and how many of its dialogs and menus lie over it. */
export type Focus = {
  record: string;
  component: string;
  /** None where its window is not on the screen. */
  origin?: { x: number; y: number };
  over: number;
};

/** `pkg/.Main` → `pkg/pkg.Main`, as a window names its activity. */
const fullName = (component: string) => component.replace(/^([^/]+)\/\./, '$1/$1.');

/** What the window manager says of the phone's own display: the activity with the focus, and where its window is. */
export function focusOf(windows: string): Focus | undefined {
  let display: number | undefined;
  let focused: { record: string; component: string } | undefined;
  const seen: { name: string; display?: number; type?: string; frame?: [number, number] }[] = [];
  for (const line of windows.split('\n')) {
    const shown = /^ {2}Display: mDisplayId=(\d+)/.exec(line);
    const app = /^ {2}mFocusedApp=ActivityRecord\{(\w+) u\d+ ([^ }]+)/.exec(line);
    const window = /^ {2}Window #\d+ Window\{\w+ u\d+ (.*)\}:/.exec(line);
    const on = /^ {4}mDisplayId=(\d+)/.exec(line);
    const type = /^ {4}mAttrs=.* ty=(\w+)/.exec(line);
    const frame = /^ {4}Frames:.* frame=\[(-?\d+),(-?\d+)\]/.exec(line);
    const last = seen.at(-1);
    if (shown) display = Number(shown[1]);
    else if (app?.[1] && app[2] && display === 0) focused ??= { record: app[1], component: app[2] };
    else if (window?.[1]) seen.push({ name: window[1] });
    else if (on && last) last.display = Number(on[1]);
    else if (type && last) last.type = type[1];
    else if (frame && last) last.frame = [Number(frame[1]), Number(frame[2])];
  }
  if (!focused) return undefined;
  const name = fullName(focused.component);
  const mine = seen.filter((w) => w.display === 0);
  const own = mine.findIndex((w) => w.type === 'BASE_APPLICATION' && w.name === name);
  const frame = mine[own]?.frame;
  return {
    ...focused,
    ...(frame && { origin: { x: frame[0], y: frame[1] } }),
    // another activity's window above it, as one beside it in split screen, is no dialog over it, nor is the splash
    // screen's, listed for a while after the app has drawn over it
    over: mine
      .slice(0, Math.max(0, own))
      .filter((w) => w.type !== 'BASE_APPLICATION' && w.type !== 'APPLICATION_STARTING').length,
  };
}

/** The `ACTIVITY` block of the focused record, written in hex, or in decimal where the window manager says it so. */
function blockOf(dump: string, record: string) {
  const blocks = dump.split(/\n(?= {2}ACTIVITY )/).flatMap((text) => {
    const hash = /^ {2}ACTIVITY \S+ ([0-9a-f]+) /m.exec(text)?.[1];
    return hash ? [{ hash, text }] : [];
  });
  const decimal = /^\d+$/.test(record) ? Number(record).toString(16) : undefined;
  return (
    blocks.find((b) => b.hash === record) ??
    blocks.find((b) => b.hash === decimal) ??
    (blocks.length === 1 ? blocks[0] : blocks.find((b) => /\bmResumed=true\b/.test(b.text)))
  )?.text;
}

/** A view as `View.toString` writes it: class, hash, its flags and private flags, l,t-r,b in its parent, its id. */
const VIEW =
  /^(\S+?)\{[0-9a-f]+ (\S+) (\S+) (-?\d+),(-?\d+)-(-?\d+),(-?\d+)(?: #[0-9a-f]+(?: (\S+:\w+\/\S+))?)?(?: aid=\d+)?\}/;

/** From `VFED..CL. ..S..A..` as Android 6 on writes them; another layout gives its visibility alone. */
function flagsOf(view: string, own: string) {
  const visibility = view.startsWith('G') ? ['gone'] : view.startsWith('I') ? ['invisible'] : [];
  if (view.length !== 9 || own.length !== 8) return visibility;
  return [
    ...visibility,
    ...(view[6] === 'C' || view[7] === 'L' ? ['clickable'] : []),
    ...(view[2] === 'E' ? [] : ['disabled']),
    ...(own[1] === 'F' ? ['focused'] : []),
    ...(own[2] === 'S' ? ['selected'] : []),
  ];
}

/** One line of the hierarchy: a view of its own `toString` keeps its place in the tree, at its parent's place. */
function viewOf(line: string, from: Rect, pkg: string): NativeView {
  const m = VIEW.exec(line);
  if (!m) return { class: line.split(/[\s{]/)[0] ?? line, rect: from };
  const [l = 0, t = 0, r = 0, b = 0] = [m[4], m[5], m[6], m[7]].map(Number);
  const flags = flagsOf(m[2] ?? '', m[3] ?? '');
  return {
    class: m[1] ?? '',
    rect: { x: from.x + l, y: from.y + t, width: r - l, height: b - t },
    // the app's own resources are `app:` in a dump, its package in an accessibility tree
    ...(m[8] && { id: m[8].replace(/^app:/, `${pkg}:`) }),
    ...(flags.some((f) => f === 'gone' || f === 'invisible') && { hidden: true }),
    ...(flags.length > 0 && { flags }),
  };
}

/**
 * The focused activity's views from its dump, each place added up through its parents from its window's corner, in
 * the screen's pixels, Android's tap units. Undefined where the dump holds no block of that record. `ships`: what
 * `shipsRead` printed of the app, which names the framework where a shrinker named the views that hold the screen.
 */
export function viewsOf(dump: string, focus: Focus, ships?: string): ViewTree | undefined {
  const block = blockOf(dump, focus.record);
  if (!block) return undefined;
  const failed = /Failure while dumping the activity: (.*)/.exec(block)?.[1];
  if (failed) throw notAnswering(focus.component, failed);
  const lines = block.split('\n');
  const start = lines.findIndex((l) => /^\s*View Hierarchy:$/.test(l));
  if (start < 0)
    throw new DeviceError(
      'NOT_FOUND',
      `${focus.component} has no window yet`,
      'it is starting or ending: read again in a moment',
    );
  const base = (lines[start] ?? '').search(/\S/) + 2;
  const [pkg = '', activity] = fullName(focus.component).split('/');
  const corner = { ...(focus.origin ?? { x: 0, y: 0 }), width: 0, height: 0 };
  const views: NativeView[] = [];
  const shown: boolean[] = [];
  const composes: boolean[] = [];
  const stack: number[] = [];
  for (const line of lines.slice(start + 1)) {
    const indent = line.search(/\S/);
    if (indent < base) break;
    stack.length = Math.min(Math.floor((indent - base) / 2), stack.length);
    const parent = stack.at(-1);
    const view = viewOf(
      line.slice(indent),
      (parent !== undefined && views[parent]?.rect) || corner,
      pkg,
    );
    if (parent === undefined && activity) view.controller = activity;
    else view.parent = parent;
    shown.push(!view.hidden && (parent === undefined || !!shown[parent]));
    composes.push(COMPOSES.test(line));
    stack.push(views.push(view) - 1);
  }
  const shrunk = shrunkOf(views, shown);
  const plain = frameworkOfViews({ views, truncated: false }, 'android');
  // a web view or a root that kept its name tells the screen by itself
  const told = plain?.name !== 'Android views' || !!plain.inside;
  const shipped =
    ships === undefined || shrunk.length === 0 || told
      ? undefined
      : shippedOf(
          ships,
          shrunk.some((i) => composes[i]),
        );
  return {
    views,
    truncated: false,
    ...(shipped && { framework: { name: shipped } }),
    notes: notesOf(views, shown, focus, shrunk, shipped),
  };
}

/** A container that scrolls by moving what it draws, not its children's places: theirs stay where its layout put them. */
const SCROLLS = /(ScrollView|ViewPager)$/;

const outside = (child: Rect, box: Rect) =>
  child.x < box.x ||
  child.y < box.y ||
  child.x + child.width > box.x + box.width ||
  child.y + child.height > box.y + box.height;

/** At most this many containers that scroll are named; one inside another is under its note already. */
const MAX_SCROLLED = 3;

/**
 * A class its build's shrinker named, so that no name tells what draws there: one of a few characters out of any
 * package, as R8 names Compose's views `p3` and `pi` in a minified build of the fixture and the emulator's browser its
 * own `dH0`, or a short lowercase one left in its package.
 */
const SHRUNK = /^[\w$]{1,4}$|\.[a-z][a-z0-9]{0,2}$/;

/** The shown views a shrinker named that hold most of the screen, where the label cannot see past their names. */
function shrunkOf(views: NativeView[], shown: boolean[]) {
  const screen = views[0]?.rect;
  if (!screen) return [];
  const area = (r: Rect) => r.width * r.height;
  return views.flatMap((v, i) =>
    shown[i] && SHRUNK.test(v.class) && area(v.rect) * 2 > area(screen) ? [i] : [],
  );
}

/** What `shipsRead` lists of each framework that draws a screen itself: its engine, or the file its library leaves. */
const SHIPPED: readonly (readonly [Framework, RegExp])[] = [
  ['Flutter', /\/libflutter\.so$/m],
  ['React Native', /\/lib(reactnative|hermes)[^/]*\.so$/m],
  ['Compose', /androidx\.compose\.ui_ui\.version$/m],
];

/** A view as Compose's own writes itself: one that takes the focus and draws, as a view an app made seldom does both. */
const COMPOSES = /^\s*[^\s{]+\{[0-9a-f]+ VFED/;

/**
 * The framework an app ships that draws where a shrinker named the views. An engine in the package draws its screens;
 * Compose is in many an app whose screens are views, so it is told only where a renamed view is as its own.
 */
const shippedOf = (ships: string, composes: boolean) =>
  SHIPPED.find(([name, file]) => file.test(ships) && (name !== 'Compose' || composes))?.[0];

/**
 * The files of the app's package, base and splits, that tell a framework: no class of theirs keeps its name in a
 * minified build, and these do. Nothing where the phone has no unzip.
 */
export const shipsRead = (pkg: string) =>
  `for a in $(pm path ${assertPkg(pkg)} | cut -d: -f2); do unzip -l "$a" 'lib/*/libflutter.so' 'lib/*/libreactnative*.so' 'lib/*/libhermes*.so' 'META-INF/androidx.compose.ui_ui.version'; done 2>/dev/null; true`;

const BY_SHRINKER = "named by the build's shrinker";

/** Whether a shrinker named what holds the screen, so that only what the app ships tells its framework. */
const namedByShrinker = (tree: ViewTree) => !!tree.notes?.[0]?.includes(BY_SHRINKER);

/** What no name tells, where a container that scrolls holds more than its box, and what these views leave out. */
function notesOf(
  views: NativeView[],
  shown: boolean[],
  focus: Focus,
  shrunk: number[],
  shipped: Framework | undefined,
) {
  const names = [...new Set(shrunk.map((i) => views[i]?.class))].join(', ');
  const unnamed = shipped
    ? `${names}: ${BY_SHRINKER}; the app ships ${shipped}, which the label goes by`
    : `${names}: ${BY_SHRINKER}, so no name tells what draws there`;
  const scrolls = views.map(
    (v, i) =>
      !!shown[i] &&
      SCROLLS.test(v.class) &&
      views.some((k, j) => k.parent === i && shown[j] && outside(k.rect, v.rect)),
  );
  const under = (i: number): boolean => {
    const p = views[i]?.parent;
    return p !== undefined && (!!scrolls[p] || under(p));
  };
  const outermost = views.filter((_, i) => scrolls[i] && !under(i));
  const scrolled = outermost.slice(0, MAX_SCROLLED).map((v) => {
    const id = idOf(v.id);
    const { x, y, width, height } = v.rect;
    return `under ${v.class}${id ? ` #${id}` : ''} at ${x},${y} ${width}x${height}, places are its layout's: its scroll moves them on the screen`;
  });
  if (outermost.length > MAX_SCROLLED)
    scrolled.push(`and so under ${outermost.length - MAX_SCROLLED} more containers that scroll`);
  const over =
    focus.over === 1
      ? 'a window over the activity, as a dialog or a menu, is not in these views: screen reads it'
      : `${focus.over} windows over the activity, as a dialog or a menu, are not in these views: screen reads them`;
  return [
    ...(shrunk.length > 0 ? [unnamed] : []),
    ...scrolled,
    ...(focus.over > 0 ? [over] : []),
    ...(focus.origin
      ? []
      : [
          "the activity's window is not on the screen: these places are where it was last laid out",
        ]),
  ];
}

/** The system asks the app for its views on the app's main thread, and gives up after 5 s. */
const notAnswering = (component: string, failure: string) =>
  failure.includes('Timeout')
    ? new DeviceError(
        'TIMEOUT',
        `${component} did not give its views: it is not answering`,
        NOT_ANSWERING,
      )
    : new DeviceError(
        'INTERNAL',
        `the system could not read the views of ${component}: ${failure}`,
      );

/**
 * The native views of the activity in front, from the system's own dump of it: no probe and no debuggable build. A
 * focus that moved while it was read is read once more.
 */
export async function androidViews(sh: (command: string, timeoutMs: number) => Promise<string>) {
  for (let tries = 2; ; tries--) {
    const out = await sh(VIEWS_READ, TIMEOUTS.read).catch((e: unknown) => {
      if (!(e instanceof DeviceError && e.code === 'TIMEOUT')) throw e;
      throw new DeviceError(
        'TIMEOUT',
        `dumpsys did not answer for the views in ${TIMEOUTS.read / 1000} s`,
        'the system is busy: read again in a moment',
      );
    });
    const [windows = '', dump] = out.split(`\n${MARK}\n`);
    const focus = focusOf(windows);
    if (!focus || dump === undefined)
      throw new DeviceError(
        'NOT_FOUND',
        'no activity has the focus to read its views',
        'the screen may be dark or locked, or an app starting: screen wakes it and reads what is there',
      );
    const tree = viewsOf(dump, focus);
    if (tree && namedByShrinker(tree)) {
      const [pkg = ''] = focus.component.split('/');
      const ships = await sh(shipsRead(pkg), TIMEOUTS.read).catch(() => '');
      return viewsOf(dump, focus, ships) ?? tree;
    }
    if (tree) return tree;
    if (tries <= 1)
      throw new DeviceError(
        'NOT_FOUND',
        `${focus.component} went while its views were read`,
        'read again once the screen has settled',
      );
  }
}
