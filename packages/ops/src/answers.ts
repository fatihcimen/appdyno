import {
  must,
  osName,
  diffScreens,
  diffText,
  personNeeded,
  PICTURE_TEXT,
  renderFolded,
  reportProgress,
  UNCHANGED,
  type ActOptions,
  type Screen,
  type ScreenDiff,
  type SystemAlert,
} from '@appdyno/core';
import { SETTLE_DEFAULT, type ActResult, type TextResult } from '@appdyno/protocol';
import { aimedApp, appDeath, diedRefusal, pidInAnswer, watched } from './app-death.js';
import type { ServerContext } from './context.js';
import { redact, redactLog } from './policy.js';
import type { ActionOut } from './schemas.js';
import type { Session } from './session.js';
import { refusedAction, reply } from './tool.js';

/** After an action: quiet window and cap of the on-device settle (the window: docs/reference/protocol.md, measured). */
export const SETTLE = SETTLE_DEFAULT;
const MAYBE_MOVING = 'the screen may still be changing';
const FAST_READ =
  '; read at the fast level: letters outside English, French, Italian, German, Spanish and Portuguese may be wrong';

const noChange = (ms: number, watchedMs?: number) =>
  `no change seen in ${ms} ms${watchedMs ? `, and no system alert in ${(watchedMs / 1000).toFixed(1)} s` : ''}; if a slow reaction is expected, use wait_for`;
const differs = (d: ScreenDiff) => d.added.length + d.removed.length + d.changed.length > 0;

/** What is known to keep a screen busy: the agent's own reasons, the wait its settle took, a spinner on the screen. */
export function busyReasons(r: ActResult | undefined, screen: Screen): string[] {
  const spinner = screen.list.find((e) => /progress|spinner|activity.?indicator/i.test(e.role));
  return [
    ...(r?.settle?.quietMs && r.settle.quietMs > SETTLE.quietMs
      ? [`the device is loaded (quiet window stretched to ${r.settle.quietMs} ms)`]
      : []),
    ...(r?.animationWaitMs ? [`the app's animations ran ${Math.round(r.animationWaitMs)} ms`] : []),
    ...(spinner
      ? [`a progress indicator is showing${spinner.label ? ` (${spinner.label})` : ''}`]
      : []),
  ];
}

export type ReadMode = 'diff' | 'full' | 'none';

type Clean = (s: string) => string;

const needsPerson = (what: string) => `\nneeds a person: ${what}. hand_off asks yours, and waits`;

/** A system alert by its own words and buttons, whatever it asks: a permission, or a link's "Open in …?". */
export const systemAsks = (a: SystemAlert) =>
  `the system asks: ${a.texts.join(' ')} (${a.buttons.map((b) => b.label).join(', ')}): answer it with alert`;

/** The app check: a system alert points to alert; another app in front is said. */
function appCheck(s: Session, screen: Screen) {
  if (screen.foreground === s.appId) s.leftTheApp(false);
  if (s.wordless && screen.elements.some((e) => e.type === PICTURE_TEXT))
    return `\nno words in the tree: these were read from the picture, and their places are near${s.pictureLevel === 'fast' ? FAST_READ : ''}`;
  if (s.pictureFailed)
    return `\nno words in the tree, and none from the picture: ${s.pictureFailed}`;
  const person = s.device.platformScreen.personPrompt(screen.tree, screen.elements);
  if (person) return needsPerson(person);
  // any the system shows over the app, a permission's or an app's crash ("keeps stopping"), by its words and buttons
  const asks = s.device.platformScreen.systemAlert(screen.tree, screen.elements);
  if (asks) return `\n${systemAsks(asks)}`;
  // an iOS alert of two buttons has an allow by its place, the one a link's "Open in …?" asks with too
  if (s.device.platformScreen.alertButton(screen.elements, 'allow'))
    return '\na system alert is open: answer it with alert';
  if (!s.appId || !screen.foreground || screen.foreground === s.appId || s.leftApp) return '';
  return `\nWARNING: the app is not in the foreground (${screen.foreground}): if it crashed, bring it back with launch_app`;
}

/**
 * The app check, and what the system shows that no read of the app has. That second look costs a read, so an action
 * takes it only when nothing changed, which is all such a prompt leaves on the app.
 */
async function noticed(s: Session, screen: Screen, lookFurther = true) {
  const fg = appCheck(s, screen);
  if (fg || !lookFurther || !s.device.systemWords) return fg;
  const words = await s.device.systemWords().catch(() => []);
  const person = personNeeded({ texts: words, buttons: [] });
  return person ? needsPerson(person) : '';
}

function info(s: Session) {
  const h = must(s.device.hello, "the agent's hello");
  return {
    serial: s.device.serial,
    model: h.model,
    os: osName(s.device.platform, h.osVersion),
    ...(h.sdk !== undefined && { sdk: h.sdk }),
    screen: h.screen,
    agentVersion: h.agentVersion,
  };
}

function show(s: Session, screen: Screen) {
  s.remember(screen);
  s.show(screen.list);
}

/** Until the layout has held for the settle's quiet window, at most `maxMs` (after a link or a launch). */
const settleRead = (s: Session, maxMs: number = SETTLE.maxMs) => s.settle(SETTLE.quietMs, maxMs);

type Shown = Session['shown'];

/** What an action's answer says beside what it did. */
type Findings = {
  diff?: string | undefined;
  d?: ScreenDiff | undefined;
  fg?: string;
  settled?: boolean | undefined;
  changed?: boolean | undefined;
  busy?: string[];
  notes?: string[];
  settleMs?: number | undefined;
  moving?: boolean | undefined;
  found?: boolean | undefined;
};

/** The structured answer of an action (ActionOut). */
const summaryOf = (clean: Clean, done: string, screen?: Screen, o: Findings = {}): ActionOut => ({
  done: clean(done),
  screen: !screen
    ? 'none'
    : o.diff === undefined
      ? 'full'
      : o.diff.startsWith(UNCHANGED)
        ? 'unchanged'
        : 'diff',
  ...(o.d && {
    changes: {
      added: o.d.added.length,
      removed: o.d.removed.length,
      changed: o.d.changed.length,
    },
  }),
  ...(screen && { elements: screen.list.length }),
  ...(screen?.foreground && { foreground: screen.foreground }),
  ...(o.settled !== undefined && { settled: o.settled }),
  ...(o.moving && { moving: true }),
  ...(o.settleMs !== undefined && { settleMs: o.settleMs }),
  ...(o.changed !== undefined && { changed: o.changed }),
  ...(o.busy?.length && { busy: o.busy }),
  ...(o.found && { found: true }),
  warnings: [
    ...(o.fg ? [o.fg.trim()] : []),
    ...(o.settled === false ? [MAYBE_MOVING] : []),
    ...(o.notes ?? []),
  ],
});

/** How an action went, for the answer that reads the screen after it. */
type Aftermath = {
  before: Shown;
  base: Shown;
  settled: boolean | undefined;
  moving?: boolean | undefined;
  ms: number;
  /** What the device watched for a system alert, past `ms`. */
  idleMs?: number | undefined;
  busy: string[];
  started: number;
  pid: string | undefined;
  /** The app's process once the action was over, as its agent told it with the answer: none to ask after it. */
  pidNow?: { pid: string | undefined } | undefined;
  settleMs?: number | undefined;
  /** What a `scroll_to` looked for is there: it compares with its own last swipe, not with before the call. */
  found?: boolean;
  /** The app a launch started: a launch of what is in front expects no change. */
  launched?: string | undefined;
  /** The app was in front on the last read before the action, or the action launched it. */
  ran: boolean;
  /** The app a death is looked for in: `aimedApp`, or the one a launch started with none selected. */
  app: string | undefined;
  /** What the change itself says beside the screen: a turn the window did not take. */
  notes?: string[];
};

/** Whether the selected app was in front on the last read before an action: what it ran as when the action began. */
const inFront = (s: Session) => !!s.appId && s.fresh?.foreground === s.appId;

const headerOf = (screen: Screen, clean: Clean) =>
  `${screen.foreground ? `foreground: ${screen.foreground}\n` : ''}${renderFolded(screen.list, clean)}`;

/**
 * What every action says of the screen after it: changed or not, what kept it busy. An app that died under it refuses
 * it with `APP_NOT_RUNNING`, as the watch during the action does.
 */
async function afterAction(
  clean: Clean,
  cleanLog: Clean,
  s: Session,
  done: string,
  read: ReadMode,
  screen: Screen,
  o: Aftermath,
) {
  show(s, screen);
  const d = read === 'diff' && o.before ? diffScreens(o.before, screen.list) : undefined;
  const diff = d && diffText(d, screen.list.length, clean);
  const changed = o.base && !o.found ? differs(diffScreens(o.base, screen.list)) : undefined;
  const appDied = await appDeath(
    s,
    o.app,
    screen.foreground,
    o.pid,
    o.started,
    clean,
    o.ran,
    o.pidNow,
  );
  if (appDied && o.app)
    throw await diedRefusal(s, o.app, done, appDied, {
      wasPid: o.pid,
      since: o.started,
      clean,
      cleanLog,
    });
  const fg = await noticed(s, screen, changed === false || !!o.launched);
  const busy = o.settled === false ? o.busy : [];
  const moving =
    o.settled === false ? ` (${MAYBE_MOVING}${busy.length ? `: ${busy.join('; ')}` : ''})` : '';
  const notes = [
    ...(o.notes ?? []),
    ...(changed === false && !o.launched ? [noChange(o.ms, o.idleMs)] : []),
  ];
  return reply(
    [`${done}${fg}${moving}`, ...notes, diff ?? headerOf(screen, clean)].join('\n'),
    summaryOf(clean, done, screen, {
      diff,
      d,
      fg,
      settled: o.settled,
      moving: o.moving,
      changed,
      busy,
      notes,
      settleMs: o.settleMs,
      found: o.found,
    }),
  );
}

/** Runs a device action with the settle and read `read` asks for. */
async function act(
  clean: Clean,
  cleanLog: Clean,
  s: Session,
  read: ReadMode,
  run: (o: ActOptions) => Promise<ActResult | TextResult>,
  done: string | ((r: ActResult | TextResult) => string),
  found: () => boolean = () => false,
) {
  const started = Date.now();
  const before = s.shown;
  // the app's process after the action comes with the answer where the device can tell it
  const pidOf = read !== 'none' && s.device.appPid ? s.appId : undefined;
  const opts: ActOptions =
    read === 'none'
      ? { settle: false, read: 'none' }
      : {
          settle: SETTLE,
          read: 'tree',
          ...(s.fresh && { before: s.fresh.hash }),
          ...(pidOf && { pidOf }),
        };
  // before the action, where not known: one read beside it took the process a crash had already restarted as the app's
  const pid =
    s.appPid ??
    (read !== 'none' && s.appId
      ? await s.device.appPid?.(s.appId).catch(() => undefined)
      : undefined);
  // a crash under the action is said once its process goes, where the device's answer could wait for long
  const action = () => run(opts).catch(refusedAction);
  const { result: r, aimedAt } = await s.aiming((): Promise<ActResult> =>
    read !== 'none' && s.appId && (pid || inFront(s))
      ? watched(s, action, {
          app: s.appId,
          wasPid: pid,
          since: started,
          done: typeof done === 'string' ? done : '',
          clean,
          cleanLog,
        })
      : action(),
  );
  // the last read before the action, which a ref's lookup may have just made
  const base = aimedAt?.list ?? before;
  const aimed = aimedAt?.hash;
  const app = aimedApp(s, aimedAt);
  const ran = !!app && aimedAt?.foreground === app;
  s.acted();
  if (read === 'none') s.skippedSettle(aimed);
  const said = typeof done === 'string' ? done : done(r);
  const isFound = found();
  if (read === 'none' || !r.tree)
    return reply(said, summaryOf(clean, said, undefined, { found: isFound }));
  const screen = await s.seen(r.tree);
  return afterAction(clean, cleanLog, s, said, read, screen, {
    app,
    pid,
    // an older agent says nothing of it, and is asked after the action as before
    pidNow: pidInAnswer(pidOf, r),
    before,
    base,
    settled: r.settle?.settled,
    moving: r.settle?.moving,
    ms: r.settle?.ms ?? Date.now() - started,
    idleMs: r.settle?.idleMs,
    busy: busyReasons(r, screen),
    started,
    settleMs: r.settle?.ms,
    found: isFound,
    ran,
  });
}

/** What a change waits for once the device has taken it, and what its answer says if that never came. */
type Ready = { met: (x: Screen) => boolean; otherwise: string };

/** What a change did, said once the screen it left is known: none with no read. */
type Said = string | ((screen: Screen | undefined) => string);
const saidOf = (said: Said, screen?: Screen) => (typeof said === 'string' ? said : said(screen));

/** What a change is compared with, and whether the selected app was in front as it began. */
type Was = { before: Shown; base: Shown; ran: boolean };

/**
 * A change on the device by its call alone, as a launch, a link or a turn, and what its answer compares with: the newest
 * read it made itself, else the last one before it, as a read beside it may already show what it did.
 */
async function changing<T>(s: Session, change: () => Promise<T>) {
  const before = s.shown;
  const { result, aimedAt } = await s.aiming(change);
  const ran = !!s.appId && aimedAt?.foreground === s.appId;
  return { result, was: { before, base: aimedAt?.list ?? before, ran } satisfies Was };
}

async function afterChange(
  clean: Clean,
  cleanLog: Clean,
  s: Session,
  { before, base, ran: wasInFront }: Was,
  said: Said,
  read: ReadMode,
  launched?: string,
  ready?: Ready,
  maxMs: number = SETTLE.maxMs,
) {
  // with no app selected, the one launched is the one whose death is looked for
  const app = s.appId ?? launched;
  const ran = wasInFront || (!!launched && launched === app);
  const started = Date.now();
  s.acted();
  // a launch or a link may start a new process on purpose
  s.forgetProcess();
  // what the screen shows once the change has reached it, as a turn's call returns before the screen turns: what a read
  // gets meanwhile is the screen before, or a window with nothing on it yet
  const notes = ready && !(await s.until(ready.met, SETTLE.maxMs)).met ? [ready.otherwise] : [];
  if (read === 'none')
    return reply(
      [saidOf(said), ...notes].join('\n'),
      summaryOf(clean, saidOf(said), undefined, { notes }),
    );
  reportProgress('waiting for the screen to settle');
  const { screen, settled } = await settleRead(s, maxMs);
  return afterAction(clean, cleanLog, s, saidOf(said, screen), read, screen, {
    app,
    before,
    base,
    settled,
    ms: Date.now() - started,
    busy: busyReasons(undefined, screen),
    started,
    pid: undefined,
    launched,
    ran,
    notes,
  });
}

/** How actions run and answer: the settle, the read it asks for, the screen and what changed on it. */
export function answersFor(ctx: ServerContext) {
  const clean = (s: string) => redact(ctx.policy, s);
  const cleanLog = (l: string) => redactLog(ctx.policy, l);
  return {
    clean,
    cleanLog,
    header: (screen: Screen) => headerOf(screen, clean),
    noticed,
    info,
    show,
    summary: (done: string, screen?: Screen, o?: Findings) => summaryOf(clean, done, screen, o),
    act: (
      s: Session,
      read: ReadMode,
      run: (o: ActOptions) => Promise<ActResult | TextResult>,
      done: string | ((r: ActResult | TextResult) => string),
      found?: () => boolean,
    ) => act(clean, cleanLog, s, read, run, done, found),
    settleRead,
    changing,
    afterChange: (
      s: Session,
      was: Was,
      said: Said,
      read: ReadMode,
      launched?: string,
      ready?: Ready,
      maxMs?: number,
    ) => afterChange(clean, cleanLog, s, was, said, read, launched, ready, maxMs),
  };
}

export type Answers = ReturnType<typeof answersFor>;
