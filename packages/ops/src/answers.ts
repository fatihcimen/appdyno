import {
  osName,
  diffScreens,
  diffText,
  pause,
  personNeeded,
  PICTURE_TEXT,
  renderFolded,
  reportProgress,
  UNCHANGED,
  type ActOptions,
  type Screen,
  type ScreenDiff,
} from '@appdyno/core';
import type { ActResult, TextResult } from '@appdyno/protocol';
import { appDeath } from './app-death.js';
import type { ServerContext } from './context.js';
import { redact } from './policy.js';
import type { ActionOut } from './schemas.js';
import type { Session } from './session.js';
import { refusedAction, reply } from './tool.js';

/** After an action: quiet window and cap of the on-device settle (the window: docs/reference/protocol.md, measured). */
export const SETTLE = { quietMs: 200, maxMs: 3_000 } as const;
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

/** The app check: a permission prompt points to alert; another app in front is said. */
function appCheck(s: Session, screen: Screen) {
  if (s.wordless && screen.elements.some((e) => e.type === PICTURE_TEXT))
    return `\nno words in the tree: these were read from the picture, and their places are near${s.pictureLevel === 'fast' ? FAST_READ : ''}`;
  if (s.pictureFailed)
    return `\nno words in the tree, and none from the picture: ${s.pictureFailed}`;
  const person = s.device.platformScreen.personPrompt(screen.tree, screen.elements);
  if (person) return needsPerson(person);
  if (s.device.platformScreen.alertButton(screen.elements, 'allow'))
    return '\na system permission prompt is open: answer it with alert';
  if (!s.appId || !screen.foreground || screen.foreground === s.appId) return '';
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
  const h = s.device.hello!;
  return {
    serial: s.device.serial,
    model: h.model,
    os: osName(s.device.platform, s.device.hello!.osVersion),
    ...(h.sdk !== undefined && { sdk: h.sdk }),
    screen: h.screen,
    agentVersion: h.agentVersion,
  };
}

function show(s: Session, screen: Screen) {
  s.remember(screen);
  s.shown = screen.list;
}

/** Reads until two reads in a row have the same layout, at most `maxMs` (after a link or a launch). */
async function settleRead(s: Session, maxMs: number = SETTLE.maxMs) {
  const end = Date.now() + maxMs;
  let screen = await s.read();
  while (Date.now() < end) {
    await pause(200);
    const next = await s.read();
    if (next.hash === screen.hash) return { screen: next, settled: true };
    screen = next;
  }
  return { screen, settled: false };
}

type Shown = Session['shown'];

/** What an action's answer says beside what it did. */
type Findings = {
  diff?: string | undefined;
  d?: ScreenDiff | undefined;
  fg?: string;
  settled?: boolean | undefined;
  changed?: boolean | undefined;
  busy?: string[];
  appDied?: ActionOut['appDied'];
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
  ...(o.appDied && { appDied: o.appDied }),
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
  settleMs?: number | undefined;
  /** What a `scroll_to` looked for is there: it compares with its own last swipe, not with before the call. */
  found?: boolean;
  /** A launch of what is in front expects no change. */
  launched?: boolean;
};

const headerOf = (screen: Screen, clean: Clean) =>
  `${screen.foreground ? `foreground: ${screen.foreground}\n` : ''}${renderFolded(screen.list, clean)}`;

/** What every action says of the screen after it: changed or not, what kept it busy, the app's fate. */
async function afterAction(
  clean: Clean,
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
  const fg = await noticed(s, screen, changed === false || !!o.launched);
  const appDied = await appDeath(s, screen, o.pid, o.started, clean);
  const busy = o.settled === false ? o.busy : [];
  const moving =
    o.settled === false ? ` (${MAYBE_MOVING}${busy.length ? `: ${busy.join('; ')}` : ''})` : '';
  const notes = [
    ...(appDied
      ? [`the app died: ${appDied.reason}${appDied.file ? ` (${appDied.file})` : ''}`]
      : []),
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
      appDied,
      notes,
      settleMs: o.settleMs,
      found: o.found,
    }),
  );
}

/** Runs a device action with the settle and read `read` asks for. */
async function act(
  clean: Clean,
  s: Session,
  read: ReadMode,
  run: (o: ActOptions) => Promise<ActResult | TextResult>,
  done: string | ((r: ActResult | TextResult) => string),
  found: () => boolean = () => false,
) {
  const started = Date.now();
  const before = s.shown;
  const opts: ActOptions =
    read === 'none'
      ? { settle: false, read: 'none' }
      : { settle: SETTLE, read: 'tree', ...(s.fresh && { before: s.fresh.hash }) };
  // alongside the action, so that it costs the answer no time
  const pidNow =
    s.appPid ??
    (read !== 'none' && s.appId ? s.device.appPid?.(s.appId).catch(() => undefined) : undefined);
  const r: ActResult = await run(opts).catch(refusedAction);
  // the last read before the action, which a ref's lookup may have just made
  const base = s.fresh?.list ?? before;
  s.acted();
  const said = typeof done === 'string' ? done : done(r);
  const pid = await pidNow;
  const isFound = found();
  if (read === 'none' || !r.tree)
    return reply(said, summaryOf(clean, said, undefined, { found: isFound }));
  const screen = await s.seen(r.tree);
  return afterAction(clean, s, said, read, screen, {
    pid,
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
  });
}

async function afterChange(
  clean: Clean,
  s: Session,
  done: string,
  read: ReadMode,
  launched = false,
) {
  const started = Date.now();
  const before = s.shown;
  const base = s.fresh?.list ?? before;
  s.acted();
  // a launch or a link may start a new process on purpose
  s.appPid = undefined;
  if (read === 'none') return reply(done, summaryOf(clean, done));
  reportProgress('waiting for the screen to settle');
  const { screen, settled } = await settleRead(s);
  return afterAction(clean, s, done, read, screen, {
    before,
    base,
    settled,
    ms: Date.now() - started,
    busy: busyReasons(undefined, screen),
    started,
    pid: undefined,
    launched,
  });
}

/** How actions run and answer: the settle, the read it asks for, the screen and what changed on it. */
export function answersFor(ctx: ServerContext) {
  const clean = (s: string) => redact(ctx.policy, s);
  return {
    clean,
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
    ) => act(clean, s, read, run, done, found),
    settleRead,
    afterChange: (s: Session, done: string, read: ReadMode, launched?: boolean) =>
      afterChange(clean, s, done, read, launched),
  };
}

export type Answers = ReturnType<typeof answersFor>;
