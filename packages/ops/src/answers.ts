import {
  alertButton,
  diffScreens,
  diffText,
  renderScreen,
  UNCHANGED,
  type ActOptions,
  type Screen,
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

  /** The answer of an action: what was done, the app check and the screen after it. */
  const answer = (
    s: Session,
    done: string,
    read: ReadMode,
    before: Session['shown'],
    r?: ActResult,
  ) => {
    if (read === 'none' || !r?.tree) return reply(done, summary(done));
    const screen = s.screenOf(r.tree);
    show(s, screen);
    const moving = r.settle && !r.settle.settled ? ` (${MAYBE_MOVING})` : '';
    const d = read === 'diff' && before ? diffScreens(before, screen.list) : undefined;
    const diff = d && diffText(d, screen.list.length, clean);
    const fg = foreground(s, screen);
    return reply(
      `${done}${fg}${moving}\n${diff ?? header(s, screen)}`,
      summary(done, screen, { diff, d, fg, settled: r.settle?.settled }),
    );
  };

  /** The structured answer of an action (ActionOut). */
  const summary = (
    done: string,
    screen?: Screen,
    o: { diff?: string; d?: ReturnType<typeof diffScreens>; fg?: string; settled?: boolean } = {},
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
    warnings: [...(o.fg ? [o.fg.trim()] : []), ...(o.settled === false ? [MAYBE_MOVING] : [])],
  });

  /** Runs a device action with the settle and read `read` asks for. */
  const act = async (
    s: Session,
    read: ReadMode,
    run: (o: ActOptions) => Promise<ActResult | TextResult>,
    done: string | ((r: ActResult | TextResult) => string),
  ) => {
    const before = s.shown;
    const opts: ActOptions =
      read === 'none'
        ? { settle: false, read: 'none' }
        : { settle: SETTLE, read: 'tree', ...(s.fresh && { before: s.fresh.hash }) };
    const r = await run(opts).catch(refused);
    s.acted();
    return answer(s, typeof done === 'string' ? done : done(r), read, before, r);
  };

  /** Reads until two reads in a row have the same layout, at most `maxMs` (after a link or a launch). */
  const settleRead = async (s: Session, maxMs = SETTLE.maxMs) => {
    const end = Date.now() + maxMs;
    let screen = await s.read();
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 200));
      const next = await s.read();
      if (next.hash === screen.hash) return { screen: next, settled: true };
      screen = next;
    }
    return { screen, settled: false };
  };

  const afterChange = async (s: Session, done: string, read: ReadMode) => {
    const before = s.shown;
    s.acted();
    if (read === 'none') return reply(done, summary(done));
    const { screen, settled } = await settleRead(s);
    show(s, screen);
    const d = read === 'diff' && before ? diffScreens(before, screen.list) : undefined;
    const diff = d && diffText(d, screen.list.length, clean);
    const fg = foreground(s, screen);
    return reply(
      `${done}${fg}${settled ? '' : ` (${MAYBE_MOVING})`}\n${diff ?? header(s, screen)}`,
      summary(done, screen, { diff, d, fg, settled }),
    );
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
