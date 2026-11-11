import type { Device, Screen } from '@appdyno/core';
import { DeviceError, NODE_FLAGS, type ActParams, type Point, type Tree } from '@appdyno/protocol';
import { approvePower, powerAllowed } from './approval.js';
import type { Policy } from './policy.js';
import type { Session } from './session.js';
import { ToolError } from './tool.js';

/** What an input would reach: the points a finger comes down on, a key, or text typed (at a point, if given). */
export type Input = { points: Point[]; key?: string; types?: true };

/** Looks at an input before it leaves for the device, and refuses it there or lets it go. */
export type InputGuard = (s: Session, input: Input) => Promise<void>;

/** Each way a device takes an input, as what it would reach: these are all of them. */
const INPUTS: Record<string, (...args: never[]) => Input> = {
  act: (a: ActParams) =>
    a.kind === 'key'
      ? { points: [], key: a.key }
      : {
          points:
            a.kind === 'gesture'
              ? a.pointers.flatMap((p) => p.slice(0, 1))
              : [a.kind === 'swipe' ? a.from : a],
        },
  tap: (p: Point) => ({ points: [p] }),
  longPress: (p: Point) => ({ points: [p] }),
  swipe: (from: Point) => ({ points: [from] }),
  key: (key: string) => ({ points: [], key }),
  typeText: (_text: string, o?: { at?: Point }) => ({ points: o?.at ? [o.at] : [], types: true }),
};

/** The device, each of whose inputs `check` sees first, with nothing sent when it refuses. */
export function guardInputs(device: Device, check: (input: Input) => Promise<void>): Device {
  return new Proxy(device, {
    get(target, key) {
      const v: unknown = Reflect.get(target, key);
      if (typeof v !== 'function') return v;
      const input = typeof key === 'string' ? INPUTS[key] : undefined;
      const own = (v as (...args: unknown[]) => unknown).bind(target);
      return input
        ? async (...args: never[]) => {
            await check(input(...args));
            return own(...args);
          }
        : own;
    },
  });
}

/** The system's own apps: an app under test may call a button Restart, and only these power off or erase a device. */
const SYSTEM =
  /^(android$|com\.android\.(systemui|settings|phone|emergency)|com\.google\.android\.apps\.safetyhub|com\.(samsung|sec)\.android\.|com\.(miui|xiaomi)\.|com\.apple\.(springboard|Preferences)$)/;

/** The phone apps, where a touch may place a call: the dialers, their in-call screens, and FaceTime. */
const PHONE =
  /^(com\.(google\.)?android\.(dialer|incallui|server\.telecom)|com\.samsung\.android\.(dialer|incallui)|com\.apple\.(mobilephone|facetime|InCallService))$/;

/** A screen that is all such controls, by an id in any language: the power menu, and Settings' erase-all-data screen. */
const SCREEN_IDS = /:id\/\w*(global_?actions|main_?clear|master_?clear)\w*$/;

/** A control by its id: the power menu's button in quick settings, and what powers off, restarts or calls for help. */
const CONTROL_IDS =
  /:id\/(pm_lite|(\w+_)?(power_?(off|menu|button)|shut_?down|reboot|restart|emergency|sos)(_\w+)?)$/;

/** iOS's slide to power off, as the runner's read names it (ios/Runner/DeviceTree.swift). */
const IOS_SLIDER = 'actionSlider';

/**
 * A control by its words, in English and Turkish, as `plain` writes them: the power menu's keys and the button that opens
 * it, iOS Control Center's power button, a lock screen's emergency call, iOS's sliders, and Settings' resets and erases,
 * from what lists them to what does it.
 * shortcut: other languages are known by the ids above, which the power menu and the screen before an erase have; the
 * final confirmation has no id of its own, but the way to it passes that screen.
 */
const WORDS = [
  /^(power( off| menu| options)?|restart|reboot|shut ?down|emergency( call| mode| sos)?|sos|slide to (power off|reboot|restart|shut down)|kapat|gucu kapat|yeniden baslat|acil (durum( modu| sos| aramasi)?|arama|sos)|guc( menusu)?|(kapatmak|yeniden baslatmak) icin kaydirin)$/,
  /^(erase|reset|factory|delete all)\b|\berase all\b|\bsifirla\b|\b(tum verileri|tum icerikleri ve ayarlari|tumunu|iphone'u|simdi) sil\b|\bfabrika\b/,
];

/** Words as compared: no case nor accent, Turkish's dotless i an i, one space between, no closing mark. */
const plain = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.…?!:]+$/, '')
    .trim();

type Node = Tree['nodes'][number];

const contains = (n: Node, p: Point) =>
  p.x >= n.b[0] && p.x <= n.b[2] && p.y >= n.b[1] && p.y <= n.b[3];

const clickable = (n: Node) => (n.f & NODE_FLAGS.clickable) !== 0;

const area = (n: Node) => (n.b[2] - n.b[0]) * (n.b[3] - n.b[1]);

/** The window a finger coming down at `p` reaches, as the system routes it: the top one there. */
export const windowAt = (tree: Tree, p: Point) =>
  tree.windows
    .map((win, i) => ({ win, i }))
    .filter(({ win }) => p.x >= win.b[0] && p.x <= win.b[2] && p.y >= win.b[1] && p.y <= win.b[3])
    .sort((a, b) => b.win.layer - a.win.layer)[0]?.i;

/** The node's own words that name such a control, as an answer quotes them. */
const words = (n: Node) => {
  const w = [n.t, n.d].find((x) => x && WORDS.some((re) => re.test(plain(x))));
  return w && JSON.stringify(w.trim());
};

/** A control known by its id alone, in a language of no words here. */
const byId = (n: Node) => (n.id && CONTROL_IDS.test(n.id) ? `the control ${n.id}` : undefined);

const ownControl = (n: Node) => words(n) ?? byId(n);

/** Reads a tree for the system's power, emergency and erase controls. */
function controls(tree: Tree) {
  const kids = tree.nodes.map((): number[] => []);
  tree.nodes.forEach((n, i) => {
    if (n.p >= 0) kids[n.p]?.push(i);
  });
  const within = (i: number): Node[] => {
    const n = tree.nodes[i];
    return n ? [n, ...(kids[i] ?? []).flatMap(within)] : [];
  };
  /** What a clickable thing acts as: the words of all it holds, or else an id. */
  const named = (i: number) => {
    const all = within(i);
    return all.map(words).find(Boolean) ?? all.map(byId).find(Boolean);
  };
  const system = (w: number) => SYSTEM.test(tree.windows[w]?.pkg ?? '');
  /** A window that is all such controls, by what it is. */
  const wholeWindow = (w: number) => {
    const id = tree.nodes.find((n) => n.w === w && n.id && SCREEN_IDS.test(n.id))?.id;
    return (
      id && (/global_?actions/.test(id) ? 'the power menu' : "Settings' erase-all-data screen")
    );
  };
  return {
    /** What a finger coming down at `p` acts on, as the system routes it: the smallest clickable thing there. */
    at(p: Point) {
      const w = windowAt(tree, p);
      if (w === undefined || !system(w)) return undefined;
      const here = tree.nodes.flatMap((n, i) => (n.w === w && contains(n, p) ? [{ n, i }] : []));
      const smallest = (xs: typeof here) => xs.sort((a, b) => area(a.n) - area(b.n))[0];
      const hit = smallest(here.filter((x) => clickable(x.n))) ?? smallest(here);
      // a clickable thing acts as all it holds; anything else only as itself
      const said = hit && (clickable(hit.n) ? named(hit.i) : ownControl(hit.n));
      // iOS's power-off slider by its id in any language, which holds the button a finger lands on
      const slider = here.some((x) => x.n.id === IOS_SLIDER)
        ? `the control ${IOS_SLIDER}`
        : undefined;
      return said ?? slider ?? wholeWindow(w);
    },
    /** What a key or typed text may act on: a screen that is all such controls, or one in the focus. */
    focused() {
      for (const w of tree.windows.keys()) {
        if (!system(w)) continue;
        const whole = wholeWindow(w);
        if (whole) return whole;
        const i = tree.nodes.findIndex((n) => n.w === w && (n.f & NODE_FLAGS.focused) !== 0);
        const said = i >= 0 ? named(i) : undefined;
        if (said) return said;
      }
      return undefined;
    },
  };
}

/** The phone app a touch at `p` lands in, if it lands in one. */
const phoneAt = (tree: Tree, p: Point) => phoneOf(tree.windows[windowAt(tree, p) ?? -1]?.pkg);

/** The phone app a key or typed text goes to: the window with the focus, else the top one of an app. */
const phoneFocused = (tree: Tree) =>
  phoneOf(
    (
      tree.windows.find((w) => w.focused) ??
      tree.windows.filter((w) => w.type === 1).sort((a, b) => b.layer - a.layer)[0]
    )?.pkg,
  );

const phoneOf = (pkg: string | undefined) => (pkg && PHONE.test(pkg) ? pkg : undefined);

/** What a touch at `p` would act on of the system's power, emergency and erase controls: its words, or undefined. */
export const powerControlAt = (tree: Tree, p: Point) => controls(tree).at(p);

/** Keys that leave such a screen or act on no element: back, home, the switcher, the volume. */
export const LEAVES = new Set([
  'back',
  'home',
  'appSwitch',
  'volumeUp',
  'volumeDown',
  'mute',
  'escape',
  'siri',
]);

/** The power and side keys: three presses this close call for help on many phones (Emergency SOS). */
export const SIDE_KEYS = new Set(['power', 'lock']);
const HELP_PRESSES = 3;
const HELP_MS = 5_000;
const pressed = new WeakMap<Session, number[]>();

/** What of the system's power, emergency and erase controls an input would act on, if any. */
async function reaches(s: Session, input: Input): Promise<string | undefined> {
  if (input.key && SIDE_KEYS.has(input.key)) {
    const now = Date.now();
    const recent = [...(pressed.get(s) ?? []).filter((t) => now - t < HELP_MS), now];
    pressed.set(s, recent);
    return recent.length >= HELP_PRESSES
      ? `${input.key} pressed ${recent.length} times in a row, which calls for help on many phones`
      : undefined;
  }
  if (input.key && LEAVES.has(input.key)) return undefined;
  // shortcut: the read a touch was aimed by, which may be up to 20 s old when nothing acted since (Session.beforeTouch);
  // a dialog a person opens by hand in that time is not seen: read again here if a person's hand must be allowed for
  const screen = s.fresh ?? (await s.current());
  const read = screen.tree;
  const how = input.types ? 'typing into' : input.key ? `the ${input.key} key on` : 'a touch on';
  // a dial pad takes digits and Enter by keys as it does by touch
  const call = input.points.length
    ? input.points.map((p) => phoneAt(read, p)).find(Boolean)
    : phoneFocused(read);
  if (call) return `${how} the phone app ${call}, which may place a call`;
  let what = actsOn(controls(read), input);
  // iOS's Control Center and power-off screen over an app may be in no read of it: the home screen app's read has them
  if (!what && s.device.systemTree && !read.windows.some((w) => SYSTEM.test(w.pkg ?? ''))) {
    const over = await homeRead(s, screen);
    what = over && actsOn(controls(over), input);
  }
  return what && `${how} ${what}, the system's own power, emergency or erase control`;
}

/**
 * The home screen app's read for each read of the screen, by that read and not its layout, which Control Center coming
 * over the app leaves as it was: one look, however many inputs that read aims, as the keys of a `press_key` count.
 */
const homeReads = new WeakMap<Screen, Tree | undefined>();

/**
 * The home screen app's read over the app on `screen`, taken once for it. One that fails sends nothing: no input goes
 * where the guard cannot tell whether a power, emergency or erase control is under it.
 */
async function homeRead(s: Session, screen: Screen) {
  if (homeReads.has(screen)) return homeReads.get(screen);
  const over = await s.device.systemTree?.().catch((e: unknown) => {
    const cause = e instanceof DeviceError ? e : undefined;
    throw new ToolError(
      `the home screen app could not be read, to tell whether Control Center or the power-off screen is over the app: ${(e as Error).message}`,
      cause?.code ?? 'INTERNAL',
      cause?.hint ??
        'read the screen and try again: appdyno sends no input where it cannot tell whether a power, emergency or erase control is under it',
      false,
    );
  });
  homeReads.set(screen, over);
  return over;
}

/** What of such controls in a read an input acts on: where a finger comes down, else what a key or text reaches. */
const actsOn = (found: ReturnType<typeof controls>, input: Input) =>
  input.points.map((p) => found.at(p)).find(Boolean) ??
  (input.key || input.types ? found.focused() : undefined);

/** The guard of every input of a session: one on the system's power, emergency or erase controls asks the person. */
export const powerGuard =
  (policy: Policy): InputGuard =>
  async (s, input) => {
    // what the person allowed ahead needs no look, which could only cost time or refuse what would go anyway
    if (powerAllowed(policy, s)) return;
    const what = await reaches(s, input);
    if (what) await approvePower(policy, s, what);
  };
