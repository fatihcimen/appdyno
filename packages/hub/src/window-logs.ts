import { pause, type Device, type LogLevel, type ViewerMessage } from '@appdyno/core';
import { checkApp, redact, redactLog, type ServerContext } from '@appdyno/ops';
import type { WindowSession } from './controls.js';

/** Between one read of the log and the next, once the first has answered: `log show` may take seconds. */
const LOG_LOOK_MS = 2_000;
/** How often what is in front is asked again, as the Performance pane asks. */
const APP_LOOK_MS = 5_000;
/** What one read brings at most, as the `logs` tool's default, and how long a line may be, as it cuts one. */
const MOST_LINES = 200;
const LONGEST = 2_000;
const CRASHES = 5;
const LEVELS: readonly LogLevel[] = ['verbose', 'debug', 'info', 'warn', 'error'];
export const OPEN_AN_APP = 'Open an app of yours to read its log';
/** What an iPhone's driver tells an agent of a running app's log, its commands and tool names left out. */
export const NO_PHONE_LOG =
  "An iPhone gives this Mac no log of an app while it runs. Its crash reports are under Crashes, and Console on this Mac shows the phone's own log.";
const personal = (said: string) =>
  said.startsWith("devicectl cannot read a running app's log") ? NO_PHONE_LOG : said;

type Front = { id?: string; name?: string; why?: string };

/**
 * A window's Logs pane: the log of the app in front, read as `logs` reads it, redacted as it redacts, and its crash
 * reports as `crashes` gives them. Nothing is read while the pane does not show, and nothing is cleared on the device.
 */
export function windowLogs(
  ctx: ServerContext,
  device: Device,
  session: () => Pick<WindowSession, 'tell'>,
) {
  let wanted = false;
  let level: LogLevel = 'info';
  let running: Promise<void> | undefined;
  let app: Front | undefined;
  let looked = 0;
  let crashesDue = false;
  /** Where the last read ended: the newest line's time, and the lines of that time, which the next read gives again. */
  let since: number | undefined;
  let atSince = new Set<string>();
  /** What a read began under: one that answers after the app or the level changed is of what no longer shows. */
  let turn = 0;
  let said = '';
  /** The device said it gives no log of a running app at all, which holds for each app that comes to the front. */
  let noLog = false;

  const tell = (m: Record<string, unknown>) => session().tell({ op: 'logs', ...m });
  /** A note under the pane's controls, said once until it changes. */
  const note = (text: string) => {
    if (text === said) return {};
    said = text;
    return { note: text };
  };

  /** The app in front, where it is a person's own and the server may read it; else why not. */
  const front = async (): Promise<Front | undefined> => {
    const id = await (device.frontApp?.() ?? device.foreground()).catch(() => null);
    // a device that cannot say now says later: what was followed stays
    if (id === null) return undefined;
    const known = id ? await device.apps.listApps(false).catch(() => []) : [];
    const own = known.find((a) => a.id === id);
    if (!own) return { why: OPEN_AN_APP };
    try {
      checkApp(ctx.policy, own.id);
    } catch (e) {
      return { name: own.name, why: (e as Error).message };
    }
    return { id: own.id, name: own.name };
  };

  const startOver = () => {
    turn++;
    since = undefined;
    atSince = new Set();
    // a device that gives no log gives none for the next app either: its note stands, and what works on a log stays hidden
    tell({
      reset: true,
      ...(app?.name && { app: app.name }),
      ...(noLog ? {} : note(app?.why ?? '')),
    });
  };

  const follow = async () => {
    if (app && Date.now() - looked < APP_LOOK_MS) return;
    looked = Date.now();
    const now = await front();
    if (!now || (app && now.id === app.id && now.why === app.why)) return;
    app = now;
    crashesDue = true;
    startOver();
  };

  /** The app's crash reports, as `crashes` gives them: its reason and the head of each, redacted. */
  const crashes = async () => {
    const id = app?.id;
    if (!id) {
      session().tell({ op: 'crashes', reports: [] });
      return;
    }
    const r = await device
      .crashes({ app: id, limit: CRASHES })
      .catch((e: unknown) => ({ reports: [], note: (e as Error).message }));
    if (app?.id !== id) return;
    session().tell({
      op: 'crashes',
      reports: r.reports.map((c) => ({
        at: c.at,
        reason: redact(ctx.policy, c.reason),
        ...(c.detail && { detail: redactLog(ctx.policy, c.detail).slice(0, 1_000) }),
        ...(c.file && { file: c.file }),
        ...(c.symbolicated && { symbolicated: c.symbolicated }),
      })),
      ...(r.note && { note: r.note }),
    });
  };

  /** What came since the last read: a line of the same time as the last one shown comes again, and is left out. */
  const read = async () => {
    const id = app?.id;
    if (!id) return;
    const began = turn;
    const r = await device.logs({
      app: id,
      level,
      maxLines: MOST_LINES,
      timed: true,
      ...(since !== undefined && { since }),
    });
    if (turn !== began) return;
    const was = since;
    // a line with no time is new only on the first read: past that, nothing tells it from one already shown
    const fresh = r.lines
      .map((text, i) => ({ text, mark: r.marks?.[i] }))
      .filter(({ text, mark }) =>
        mark
          ? was === undefined || mark.at > was || (mark.at === was && !atSince.has(text))
          : !atSince.has(text),
      )
      .slice(-MOST_LINES);
    const last = fresh.at(-1)?.mark?.at;
    if (last !== undefined) {
      if (last !== since) atSince = new Set();
      since = last;
    }
    for (const l of fresh) if (!l.mark || l.mark.at === last) atSince.add(l.text);
    const lines = fresh.map(({ text, mark }) => ({
      text: redactLog(ctx.policy, text).slice(0, LONGEST),
      ...(mark?.level && { level: mark.level }),
    }));
    const why = personal(r.note ?? '');
    noLog ||= why === NO_PHONE_LOG;
    const noted = note(why);
    // `none`: no log comes here at all, so the pane hides what works on one
    if (lines.length || 'note' in noted)
      tell({ lines, ...noted, ...(noted.note === NO_PHONE_LOG && { none: true }) });
  };

  const loop = async () => {
    while (wanted) {
      await follow().catch(() => undefined);
      if (crashesDue) {
        crashesDue = false;
        void crashes();
      }
      await read().catch((e: unknown) => {
        const noted = note((e as Error).message);
        if ('note' in noted) tell(noted);
      });
      await pause(LOG_LOOK_MS);
    }
    running = undefined;
  };

  return {
    /** The pane shows, or not, at a level; false: the message is another's. */
    onWindow(m: ViewerMessage): boolean {
      if (m.op !== 'paneWatch' || m.pane !== 'logs') return false;
      const asked = LEVELS.find((l) => l === m.level) ?? level;
      if (asked !== level) {
        level = asked;
        if (app) startOver();
      }
      const on = m.on === true;
      // shown again, its reports may be new; a pause takes up where it stopped
      if (on && !wanted) crashesDue = true;
      wanted = on;
      if (wanted) running ??= loop();
      return true;
    },

    /** The window closed. */
    end() {
      wanted = false;
    },
  };
}
