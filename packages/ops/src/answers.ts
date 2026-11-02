import {
  alertButton,
  diffScreens,
  diffText,
  pause,
  renderScreen,
  reportProgress,
  UNCHANGED,
  type ActOptions,
  type Screen,
  type ScreenDiff,
} from '@appdyno/core';
import type { ActResult, TextResult } from '@appdyno/protocol';
import type { ServerContext } from './context.js';
import { redact } from './policy.js';
import type { ActionOut } from './schemas.js';
import { refused, type Session } from './session.js';
import { reply } from './tool.js';

/** After an action: quiet window and cap of the on-device settle (the window: docs/protocol.md, measured). */
export const SETTLE = { quietMs: 200, maxMs: 3_000 } as const;
const MAYBE_MOVING = 'the screen may still be changing';
/** A report can be stamped a moment before the host's clock says the action began. */
const CLOCK_SLACK_MS = 2_000;
/** A crash report is written within moments of the death. */
const REPORT_TRIES = 4;
const REPORT_GAP_MS = 700;

const noChange = (ms: number) =>
  `no change seen in ${ms} ms; if a slow reaction is expected, use wait_for`;
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

/** How actions run and answer: the settle, the read it asks for, the screen and what changed on it. */
export function answersFor(ctx: ServerContext) {
  const clean = (s: string) => redact(ctx.policy, s);

  const header = (s: Session, screen: Screen) =>
    `${screen.foreground ? `foreground: ${screen.foreground}\n` : ''}${renderScreen(screen.list, clean)}`;

  /** The app check: a permission prompt points to dismiss_alert; another app in front is said. */
  const foreground = (s: Session, screen: Screen) => {
    if (alertButton(screen.elements, s.device.platform, 'allow'))
      return '\na system permission prompt is open: answer it with dismiss_alert';
    if (!s.appId || !screen.foreground || screen.foreground === s.appId) return '';
    return `\nWARNING: the app is not in the foreground (${screen.foreground}): if it crashed, bring it back with launch_app`;
  };

  /** The OS as people name it: Android 14, iOS 18.2. */
  const osName = (s: Session) =>
    `${s.device.platform === 'ios' ? 'iOS' : 'Android'} ${s.device.hello!.osVersion}`;

  const info = (s: Session) => {
    const h = s.device.hello!;
    return {
      serial: s.device.serial,
      model: h.model,
      os: osName(s),
      ...(h.sdk !== undefined && { sdk: h.sdk }),
      screen: h.screen,
      agentVersion: h.agentVersion,
    };
  };

  const show = (s: Session, screen: Screen) => {
    s.remember(screen);
    s.shown = screen.list;
  };

  /** The app's end, when its process is gone: its report's reason, or that none says why. */
  const death = async (s: Session, since: number) => {
    const { appRunning, crashes } = s.device;
    if (!s.appId || !appRunning) return undefined;
    if (await appRunning.call(s.device, s.appId).catch(() => true)) return undefined;
    reportProgress('the app is gone: looking for its crash report');
    for (let i = 0; crashes && i < REPORT_TRIES; i++) {
      const { reports } = await crashes
        .call(s.device, { app: s.appId, since: since - CLOCK_SLACK_MS, limit: 1 })
        .catch(() => ({ reports: [] }));
      const r = reports[0];
      if (r) return { reason: clean(r.reason), ...(r.file && { file: r.file }) };
      await pause(REPORT_GAP_MS).catch(() => undefined);
    }
    return { reason: 'its process is gone and no crash report says why' };
  };

  /** What every action says of the screen after it: changed or not, what kept it busy, the app's fate. */
  const after = async (
    s: Session,
    done: string,
    read: ReadMode,
    screen: Screen,
    o: {
      before: Session['shown'];
      base: Session['shown'];
      settled: boolean | undefined;
      ms: number;
      busy: string[];
      started: number;
    },
  ) => {
    show(s, screen);
    const d = read === 'diff' && o.before ? diffScreens(o.before, screen.list) : undefined;
    const diff = d && diffText(d, screen.list.length, clean);
    const fg = foreground(s, screen);
    const appDied =
      fg && s.appId && screen.foreground !== s.appId ? await death(s, o.started) : undefined;
    const changed = o.base ? differs(diffScreens(o.base, screen.list)) : undefined;
    const busy = o.settled === false ? o.busy : [];
    const moving =
      o.settled === false ? ` (${MAYBE_MOVING}${busy.length ? `: ${busy.join('; ')}` : ''})` : '';
    const notes = [
      ...(appDied
        ? [`the app died: ${appDied.reason}${appDied.file ? ` (${appDied.file})` : ''}`]
        : []),
      ...(changed === false ? [noChange(o.ms)] : []),
    ];
    return reply(
      [`${done}${fg}${moving}`, ...notes, diff ?? header(s, screen)].join('\n'),
      summary(done, screen, {
        diff,
        d,
        fg,
        settled: o.settled,
        changed,
        busy,
        appDied,
        notes,
      }),
    );
  };

  /** The answer of an action: what was done, the app check and the screen after it. */
  const answer = (
    s: Session,
    done: string,
    read: ReadMode,
    before: Session['shown'],
    base: Session['shown'],
    started: number,
    r?: ActResult,
  ) => {
    if (read === 'none' || !r?.tree) return reply(done, summary(done));
    return after(s, done, read, s.screenOf(r.tree), {
      before,
      base,
      settled: r.settle?.settled,
      ms: r.settle?.ms ?? Date.now() - started,
      busy: busyReasons(r, s.screenOf(r.tree)),
      started,
    });
  };

  /** The structured answer of an action (ActionOut). */
  const summary = (
    done: string,
    screen?: Screen,
    o: {
      diff?: string | undefined;
      d?: ScreenDiff | undefined;
      fg?: string;
      settled?: boolean | undefined;
      changed?: boolean | undefined;
      busy?: string[];
      appDied?: ActionOut['appDied'];
      notes?: string[];
    } = {},
  ): ActionOut => ({
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
    ...(o.changed !== undefined && { changed: o.changed }),
    ...(o.busy?.length && { busy: o.busy }),
    ...(o.appDied && { appDied: o.appDied }),
    warnings: [
      ...(o.fg ? [o.fg.trim()] : []),
      ...(o.settled === false ? [MAYBE_MOVING] : []),
      ...(o.notes ?? []),
    ],
  });

  /** Runs a device action with the settle and read `read` asks for. */
  const act = async (
    s: Session,
    read: ReadMode,
    run: (o: ActOptions) => Promise<ActResult | TextResult>,
    done: string | ((r: ActResult | TextResult) => string),
  ) => {
    const started = Date.now();
    const before = s.shown;
    const opts: ActOptions =
      read === 'none'
        ? { settle: false, read: 'none' }
        : { settle: SETTLE, read: 'tree', ...(s.fresh && { before: s.fresh.hash }) };
    const r = await run(opts).catch(refused);
    // the last read before the action, which a ref's lookup may have just made
    const base = s.fresh?.list ?? before;
    s.acted();
    return answer(s, typeof done === 'string' ? done : done(r), read, before, base, started, r);
  };

  /** Reads until two reads in a row have the same layout, at most `maxMs` (after a link or a launch). */
  const settleRead = async (s: Session, maxMs = SETTLE.maxMs) => {
    const end = Date.now() + maxMs;
    let screen = await s.read();
    while (Date.now() < end) {
      await pause(200).catch(refused);
      const next = await s.read();
      if (next.hash === screen.hash) return { screen: next, settled: true };
      screen = next;
    }
    return { screen, settled: false };
  };

  const afterChange = async (s: Session, done: string, read: ReadMode) => {
    const started = Date.now();
    const before = s.shown;
    const base = s.fresh?.list ?? before;
    s.acted();
    if (read === 'none') return reply(done, summary(done));
    reportProgress('waiting for the screen to settle');
    const { screen, settled } = await settleRead(s);
    return after(s, done, read, screen, {
      before,
      base,
      settled,
      ms: Date.now() - started,
      busy: busyReasons(undefined, screen),
      started,
    });
  };

  return {
    clean,
    header,
    foreground,
    osName,
    info,
    show,
    answer,
    summary,
    act,
    settleRead,
    afterChange,
  };
}

export type Answers = ReturnType<typeof answersFor>;
