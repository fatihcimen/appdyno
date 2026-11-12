import type { Device, Screen } from '@appdyno/core';
import {
  DeviceError,
  ERROR_TRAITS,
  NODE_FLAGS,
  type ActParams,
  type Point,
  type Tree,
} from '@appdyno/protocol';
import {
  ALLOW_POWER,
  approveLanguage,
  approvePower,
  CONTROL_CENTER_AHEAD,
  powerAllowed,
} from './approval.js';
import { LEAVES, SIDE_KEYS } from './keys.js';
import type { Policy } from './policy.js';
import type { Session } from './session.js';
import { ToolError } from './tool.js';

/**
 * What an input would reach: the points a finger comes down on, a key, or text typed (at a point, if given); `named`: an
 * element pressed by its words or id alone, wherever it is, with no point to judge.
 */
export type Input = { points: Point[]; key?: string; types?: true; named?: string };

/** Looks at an input before it leaves for the device, and refuses it there or lets it go. */
export type InputGuard = (s: Session, input: Input) => Promise<void>;

/** A device's inputs, and those of a part of it that takes its own. */
type Inputs = { [key: string]: ((...args: never[]) => Input) | Inputs };

/** Each way a device takes an input, as what it would reach: these are all of them. */
const INPUTS: Inputs = {
  // an iPhone's accessibility service presses what has those words or that id, as no runner is up to read the screen
  inspector: { press: (name: string) => ({ points: [], named: name }) },
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

/**
 * The device, each of whose inputs `check` sees first, with nothing sent when it refuses. `mayHaveGone`: an input that
 * failed once it left may have changed the screen all the same, as a swipe that opened Control Center and timed out.
 * `back`: an input that left is over, however it ended, and what was read while it went may hold the screen before it.
 */
export function guardInputs(
  device: Device,
  check: (input: Input) => Promise<void>,
  mayHaveGone: () => void,
  back: () => void,
): Device {
  const guarded = <T extends object>(on: T, inputs: Inputs): T =>
    new Proxy(on, {
      get(target, key) {
        const v: unknown = Reflect.get(target, key);
        const input =
          typeof key === 'string' && Object.hasOwn(inputs, key) ? inputs[key] : undefined;
        if (typeof input === 'object') return v && typeof v === 'object' ? guarded(v, input) : v;
        if (typeof v !== 'function') return v;
        const own = (v as (...args: unknown[]) => unknown).bind(target);
        return input
          ? async (...args: never[]) => {
              await check(input(...args));
              try {
                return await own(...args);
              } catch (e) {
                // the next input is judged by a new read, not by the screen before this one
                if (
                  !(e instanceof DeviceError) ||
                  ERROR_TRAITS[e.code].touch !== 'refused first' ||
                  e.sent
                )
                  mayHaveGone();
                throw e;
              } finally {
                back();
              }
            }
          : own;
      },
    });
  return guarded(device, INPUTS);
}

/**
 * The system's own apps: an app under test may call a button Restart, and only these power off or erase a device. Play
 * services shows Android's system update, and each maker its own power menu and Settings.
 */
const SYSTEM =
  /^(android$|com\.android\.(systemui|settings|phone|emergency)|com\.google\.android\.(apps\.safetyhub|gms$)|com\.(samsung|sec)\.android\.|com\.(miui|xiaomi|oplus|coloros|oneplus|huawei|hihonor|motorola|vivo)\.|com\.apple\.(springboard|Preferences)$)/;

/**
 * The phone apps, where a touch may place a call: the dialers, their in-call screens and FaceTime, and the contacts and
 * messages apps, whose call buttons dial at once.
 */
const PHONE =
  /^(com\.(google\.)?android\.(dialer|incallui|server\.telecom|contacts)|com\.android\.mms|com\.google\.android\.apps\.messaging|com\.samsung\.android\.(dialer|incallui|app\.contacts|messaging)|com\.apple\.(mobilephone|facetime|InCallService|MobileAddressBook|MobileSMS))$/;

/** A screen that is all such controls, by an id in any language: the power menu, and Settings' erase-all-data screen. */
const SCREEN_IDS = /:id\/\w*(global_?actions|main_?clear|master_?clear)\w*$/;

/** A control by its id: the power menu's button in quick settings, and what powers off, restarts or calls for help. */
const CONTROL_IDS =
  /:id\/(pm_lite|(\w+_)?(power_?(off|menu|button)|shut_?down|reboot|restart|emergency|sos)(_\w+)?)$/;

/** iOS's slide to power off, as the runner's read names it (ios/Runner/DeviceTree.swift), and the Cancel beside it. */
const IOS_SLIDER = 'actionSlider';
const IOS_CANCEL = 'cancelButton';

/** iOS's Control Center, by its module grid as the runner's read names it, in any language. */
const IOS_CONTROL_CENTER = 'cc-root-folder-view';

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
  // a restart with more words, as Restart now, but an app's own of a crash; and a system update, which restarts it
  /^(restart|reboot|shut ?down|power off|yeniden baslat)(?! (the )?app\b)\b|^(download and install|(install|update) now)\b|^(simdi (guncelle|yukle)|indir ve yukle)\b/,
];

/** A system alert's button that places a call, in English and Turkish, as `plain` writes it: "Call", "Ara". */
const CALL_WORDS = /^(call|ara)\b/;
const CANCEL_WORDS = /^(cancel|vazgec|iptal)$/;

/** A phone number and no more, as iOS's alert for a call link names what it calls, in any language: three digits or more. */
const aNumber = (s: string | undefined) => {
  const x = s?.replace(/\p{Cf}/gu, '').trim();
  return !!x && /^\+?[\d\s().-]+\??$/.test(x) && (x.match(/\d/g) ?? []).length >= 3;
};

/** The alert node `i` lies in, if any: iOS may show a system prompt, a call's among them, as a sheet. */
const alertOf = (tree: Tree, i: number): number | undefined => {
  const n = tree.nodes[i];
  return !n ? undefined : /(alert|sheet)$/i.test(n.c) ? i : alertOf(tree, n.p);
};

/** Whether node `i` lies in an alert. */
export const inAlert = (tree: Tree, i: number) => alertOf(tree, i) !== undefined;

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
  const visibly = (w: number, id: string) =>
    tree.nodes.some((n) => n.w === w && n.id === id && (n.f & NODE_FLAGS.visible) !== 0);
  /** A window that is all such controls, by what it is. */
  const wholeWindow = (w: number) => {
    const id = tree.nodes.find((n) => n.w === w && n.id && SCREEN_IDS.test(n.id))?.id;
    if (id)
      return /global_?actions/.test(id) ? 'the power menu' : "Settings' erase-all-data screen";
    // iOS's power-off screen by its slider's id in any language: its Emergency SOS has none known here
    return visibly(w, IOS_SLIDER) ? "iOS's power-off screen" : undefined;
  };
  /** What a finger coming down at `p` in a system window reaches, as the system routes it: the smallest clickable thing. */
  const hitAt = (p: Point) => {
    const w = windowAt(tree, p);
    if (w === undefined || !system(w)) return undefined;
    const here = tree.nodes.flatMap((n, i) => (n.w === w && contains(n, p) ? [{ n, i }] : []));
    const smallest = (xs: typeof here) => xs.sort((a, b) => area(a.n) - area(b.n))[0];
    return { w, here, hit: smallest(here.filter((x) => clickable(x.n))) ?? smallest(here) };
  };
  return {
    /** What a finger coming down at `p` acts on of such controls. */
    at(p: Point) {
      const reached = hitAt(p);
      if (!reached) return undefined;
      const { w, here, hit } = reached;
      // a clickable thing acts as all it holds; anything else only as itself
      const said = hit && (clickable(hit.n) ? named(hit.i) : ownControl(hit.n));
      // iOS's power-off slider by its id in any language, which holds the button a finger lands on
      const slider = here.some((x) => x.n.id === IOS_SLIDER)
        ? `the control ${IOS_SLIDER}`
        : undefined;
      // the power-off screen's Cancel, by its id in any language, is the way off it
      return said ?? slider ?? (hit?.n.id === IOS_CANCEL ? undefined : wholeWindow(w));
    },
    /**
     * The button of a system alert a finger at `p` places a call by, as iOS's of a link the app opened: Call by its words,
     * and in any language each button but a Cancel of an alert that names a phone number and no more.
     */
    callAt(p: Point) {
      const hit = hitAt(p)?.hit;
      const alert = hit && clickable(hit.n) ? alertOf(tree, hit.i) : undefined;
      if (!hit || alert === undefined) return undefined;
      const label = (hit.n.d ?? hit.n.t ?? '').trim();
      const prompt = within(alert).some((n) => aNumber(n.t) || aNumber(n.d));
      const calls = CALL_WORDS.test(plain(label)) || (prompt && !CANCEL_WORDS.test(plain(label)));
      return calls ? (label ? JSON.stringify(label) : 'a button') : undefined;
    },
    /**
     * Whether a finger at `p` lands on iOS's Control Center: its power button has no id, nor any mark that leaves its other
     * buttons alone, so all of it is taken for that button.
     */
    inControlCenter(p: Point) {
      const w = windowAt(tree, p);
      return w !== undefined && system(w) && visibly(w, IOS_CONTROL_CENTER);
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

/** The app a key or typed text goes to: the window with the focus, else the top one of an app. */
const focusedApp = (tree: Tree) =>
  (
    tree.windows.find((w) => w.focused) ??
    tree.windows.filter((w) => w.type === 1).sort((a, b) => b.layer - a.layer)[0]
  )?.pkg;

/**
 * A look the guard could not take, as the refusal of the input it was for: no input goes where the guard cannot tell
 * whether it reaches such a control, `under`.
 */
const unseen = (e: unknown, what: string, under: string) => {
  const cause = e instanceof DeviceError ? e : undefined;
  return new ToolError(
    `${what}: ${(e as Error).message}`,
    cause?.code ?? 'INTERNAL',
    // a look that keeps failing would refuse every input: the person's way past it is named
    `${cause?.hint ?? 'read the screen and try again'}: appdyno sends no input where it cannot tell whether ${under}; a person who allows those controls ahead in this server's own command line skips the look: ${ALLOW_POWER}`,
    false,
  );
};

/**
 * The app a call's link opens in on the device, a maker's own dialer among them: asked once a session, and again after
 * a failure, which sends nothing, as that input could be a touch on a dialer that no list here names.
 */
const dialers = new WeakMap<Session, Promise<string | undefined>>();
async function dialerOf(s: Session) {
  const ask = async () => s.device.apps.opener('tel:112');
  const known = dialers.get(s) ?? ask();
  dialers.set(s, known);
  return known.catch((e: unknown) => {
    if (dialers.get(s) === known) dialers.delete(s);
    throw unseen(
      e,
      'the device could not say which app places its calls, to tell whether this input may place one',
      'it may place a call',
    );
  });
}

/** The languages whose words `WORDS` holds. */
const WORDS_IN = /^(en|tr)([-_]|$)/i;

/**
 * Settings in a language of no words here leaves its resets and erase to the ids, which iOS's have none of: putting a
 * system app in one, or the whole device and so Settings with it, asks the person as those controls do. `pkg`: the app
 * given a language of its own; none, the whole device.
 */
export async function askLanguage(policy: Policy, s: Session, language: string, pkg?: string) {
  if (!language || WORDS_IN.test(language)) return;
  // a device of an sdk below 33, Android 13, keeps no language for an app: the whole device takes it
  const sdk = s.device.hello?.sdk;
  const perApp = sdk === undefined || sdk >= 33;
  if (pkg && perApp && !SYSTEM.test(pkg)) return;
  await approveLanguage(policy, s, pkg && perApp ? pkg : 'the whole device', language);
}

/** What a touch at `p` would act on of the system's power, emergency and erase controls: its words, or undefined. */
export const powerControlAt = (tree: Tree, p: Point) => controls(tree).at(p);

const HELP_PRESSES = 3;
const HELP_MS = 5_000;
const pressed = new WeakMap<Session, number[]>();

/** What of the system's power, emergency and erase controls an input would act on, if any. */
/** What an input would act on, as the question says it, and what the refusal's hint says a person can do instead. */
type Reached = { what: string; ahead?: string };

async function reaches(s: Session, input: Input): Promise<Reached | undefined> {
  if (input.key && SIDE_KEYS.has(input.key)) {
    const now = Date.now();
    const recent = [...(pressed.get(s) ?? []).filter((t) => now - t < HELP_MS), now];
    pressed.set(s, recent);
    return recent.length >= HELP_PRESSES
      ? {
          what: `${input.key} pressed ${recent.length} times in a row, which calls for help on many phones`,
        }
      : undefined;
  }
  if (input.key && LEAVES.has(input.key)) return undefined;
  // shortcut: the read a touch was aimed by, which may be up to 20 s old when no client of this server acted since
  // (Session.beforeTouch, Session.fresh);
  // a dialog a person opens by hand in that time is not seen: read again here if a person's hand must be allowed for
  const screen = s.fresh ?? (await s.current());
  const read = screen.tree;
  const how = input.types ? 'typing into' : input.key ? `the ${input.key} key on` : 'a touch on';
  // the system's chooser, which answers where no dialer is the default, has no dot in its name as an app's id has
  const dialer = await dialerOf(s);
  const phone = (pkg?: string) =>
    pkg && (PHONE.test(pkg) || (pkg === dialer && pkg.includes('.'))) ? pkg : undefined;
  // a dial pad takes digits and Enter by keys as it does by touch
  const call = input.points.length
    ? input.points.map((p) => phone(read.windows[windowAt(read, p) ?? -1]?.pkg)).find(Boolean)
    : phone(focusedApp(read));
  if (call) return { what: `${how} the phone app ${call}, which may place a call` };
  /** What a read holds of such controls for this input, a call's first. */
  const judged = (t: Tree): Reached | undefined => {
    const found = controls(t);
    const calls = input.points.map((p) => found.callAt(p)).find(Boolean);
    if (calls) return { what: `${how} ${calls} of a system alert, which places a call` };
    const what = actsOn(found, input);
    if (what) return { what: `${how} ${what}, the system's own power, emergency or erase control` };
    return input.points.some((p) => found.inControlCenter(p))
      ? { what: `${how} Control Center, which holds the power button`, ahead: CONTROL_CENTER_AHEAD }
      : undefined;
  };
  const said = judged(read);
  if (said) return said;
  const over = await overTheApp(s, screen);
  return over && judged(over);
}

/**
 * The home screen app's read, where what it shows over the app may be in no read of the screen: iOS's Control Center and
 * power-off screen, Notification Center. A read whose only system window is an alert has the alert alone, as the runner
 * captures that, and not what came with it; undefined where there is nothing to take or nothing over the app.
 */
export async function overTheApp(s: Session, screen: Screen) {
  const t = screen.tree;
  const port = s.device.platformScreen;
  const sees = t.windows.some((w, i) => SYSTEM.test(w.pkg ?? '') && !port.overApp(t, i));
  return s.device.systemTree && !sees ? homeRead(s, screen) : undefined;
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
    throw unseen(
      e,
      'the home screen app could not be read, to tell whether Control Center or the power-off screen is over the app',
      'a power, emergency or erase control is under it',
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
    const reached = await reaches(s, input);
    if (reached) await approvePower(policy, s, reached.what, reached.ahead);
  };
