import { pause, reportProgress, stoppable } from '@appdyno/core';
import type { Session } from './session.js';
import { ToolError } from './tool.js';

/** An action this long under way has its app's process watched, as a crash under it can hold the device's answer. */
const WATCH_AFTER_MS = 1_000;
const WATCH_GAP_MS = 500;
/** What a death under an action says of the app's log. */
const LAST_LINES = 8;
/** The newest lines looked through for one that says why. */
const LOOKED_AT = 60;
const LINE_CHARS = 200;

/** A report can be stamped a moment before the host's clock says the action began. */
const CLOCK_SLACK_MS = 2_000;
/** A crash report is written within moments of the death. */
const REPORT_TRIES = 4;
const REPORT_GAP_MS = 700;

type Clean = (s: string) => string;

/** Why the app ended, and the report that says so; `held`: by its crash dialog, which none is written before. */
/** `unreported`: no report has come of it yet, which the system may still write. */
export type Died = { reason: string; file?: string; held?: true; unreported?: true };

/**
 * The app a death is looked for in: the one selected, else the one in front as the action aimed, which a launch or a
 * link earlier in a batch opened with no app selected.
 */
export const aimedApp = (s: Session, at = s.fresh) => s.appId ?? at?.foreground;

/**
 * The app as a step began, by what was last seen in front: the one selected, else that one; whether it was in front;
 * its process. A step that fails as it is gone failed for its death.
 */
export function asStepBegan(s: Session, seen: string | undefined) {
  const app = s.appId ?? seen;
  return { app, up: !!app && seen === app, pid: s.appPid };
}

/** What a report says of the app's end since `since`; a new process with no report is no death. */
async function reportOf(
  s: Session,
  app: string | undefined,
  since: number,
  clean: Clean,
  tries = REPORT_TRIES,
) {
  for (let i = 0; app && i < tries; i++) {
    const { reports } = await s.device
      .crashes({ app, since: since - CLOCK_SLACK_MS, limit: 1 })
      .catch(() => ({ reports: [] }));
    const r = reports[0];
    if (r) return { reason: clean(r.reason), ...(r.file && { file: r.file }) };
    await pause(REPORT_GAP_MS).catch(() => undefined);
  }
  return undefined;
}

/**
 * Whether the system holds the app's process for its crash dialog, Android's "keeps stopping": the process stays, with
 * its pid, until the dialog is answered, and no report is written meanwhile, so only this tells that death.
 */
const heldForDialog = async (s: Session, app: string) =>
  (await s.device.appCrashing?.(app).catch(() => false)) ?? false;

/**
 * A death, as its report says, else as it was seen: a process held for its crash dialog, read once as that writes none
 * meanwhile, or no process. A new process with no report is no death, as a link may start one. What every check of a
 * death answers by, during an action and after it.
 */
async function deathOf(
  s: Session,
  app: string,
  since: number,
  clean: Clean,
  seen: { held: boolean; pid?: string | undefined },
): Promise<Died | undefined> {
  const report = await reportOf(s, app, since, clean, seen.held ? 1 : REPORT_TRIES);
  if (report) return report;
  if (seen.held)
    return {
      reason: 'the system holds its process for its crash dialog, and no crash report says why yet',
      held: true,
    };
  return seen.pid
    ? undefined
    : { reason: 'its process is gone, and no crash report says why yet', unreported: true };
}

/** The process an action's answer names, 0 for none, where it was asked for one: an older agent names none. */
export const pidInAnswer = (asked: string | undefined, r: { pid?: number | undefined }) =>
  asked && r.pid !== undefined ? { pid: r.pid > 0 ? String(r.pid) : undefined } : undefined;

/** What to do once the app died under a call that failed for it: while its crash dialog holds it, its log says why. */
export const diedHint = (d: Died) =>
  d.held
    ? 'logs says why it died now, and crashes once alert answers its crash dialog; launch_app starts it again after'
    : d.unreported
      ? // a simulator on a loaded Mac wrote its report a minute after the end
        'launch_app starts it again, and crashes says why it died once the system has written its report, which can take a minute'
      : 'launch_app starts it again, and crashes says why it died';

/** An answer's line of the app's end. */
export const diedLine = ({ reason, file }: Died) =>
  `the app died: ${reason}${file ? ` (${file})` : ''}`;

/** An action whose app died under it, refused with what it did, why the app died and its last lines. */
export class AppDied extends ToolError {}

/**
 * The app's end during an action: its process is gone from the front, or another one has taken over
 * (Android restarts a crashed app at once, so the screen alone would not tell). `ran`: it was in front on the read
 * before the action, or the action launched it; an app not running then, with no process before either, did not die
 * in it, as one a link never opened. `now`: the process after the action, as the action's own answer told it.
 */
export async function appDeath(
  s: Session,
  app: string | undefined,
  foreground: string | undefined,
  wasPid: string | undefined,
  since: number,
  clean: Clean,
  ran: boolean,
  now?: { pid: string | undefined },
) {
  if (!app) return undefined;
  if (s.device.appPid) {
    // what the device could not tell is the process known before
    const asked =
      now ??
      (await s.device.appPid(app).then(
        (p) => ({ pid: p }),
        () => undefined,
      ));
    const pid = asked ? asked.pid : wasPid;
    s.sawProcess(app, pid);
    // another process than before, or none of an app that ran where none was known before, as one a touch aimed at
    // with no app selected: the system's "keeps stopping" over its screen leaves it the one in front
    if (wasPid ? pid !== wasPid : !!asked && ran && !pid) {
      reportProgress(
        pid
          ? 'the app has a new process: looking for its crash report'
          : 'the app has no process: looking for its crash report',
      );
      // none at all is a death, a crash dialog over it
      return deathOf(s, app, since, clean, { held: false, pid });
    }
  }
  if (foreground === app || !(ran || wasPid)) return undefined;
  // "keeps stopping" stands over the app's screen, which then has no app in front, and none if dropbox's rate limit
  // drops its report
  const held = await heldForDialog(s, app);
  if (!held && (!foreground || (await s.device.appRunning(app).catch(() => true))))
    return undefined;
  reportProgress('the app is gone: looking for its crash report');
  return deathOf(s, app, since, clean, { held });
}

/**
 * The app's end under a call that failed: as `appDeath` for an app that `ran`, else a crash report since `since`, read
 * once, as the failure has waited already. The system restarts a crashed app, and where nothing knew its process before,
 * only the report tells.
 */
export async function diedUnder(
  s: Session,
  app: string | undefined,
  foreground: string | undefined,
  wasPid: string | undefined,
  since: number,
  clean: Clean,
  ran: boolean,
) {
  const gone = ran ? await appDeath(s, app, foreground, wasPid, since, clean, true) : undefined;
  return gone ?? reportOf(s, app, since, clean, 1);
}

/**
 * The app's end while an action is still under way: its process gone, held for its crash dialog, or another one in its
 * place with a crash report.
 */
async function deathWhile(
  s: Session,
  app: string,
  wasPid: string | undefined,
  since: number,
  clean: Clean,
) {
  const pid = s.device.appPid ? await s.device.appPid(app).catch(() => wasPid) : undefined;
  // a process not known before the action is only looked for: none is an end, any one is the app's
  const gone = !s.device.appPid
    ? !(await s.device.appRunning(app).catch(() => true))
    : wasPid
      ? pid !== wasPid
      : !pid;
  // asked only of the same process, in some 40 ms on an emulator against the watch's 500 ms between looks
  const held = !gone && (await heldForDialog(s, app));
  if (!gone && !held) return undefined;
  s.sawProcess(app, pid);
  reportProgress(
    held
      ? 'the system holds the app for its crash dialog: looking for its crash report'
      : 'the app went away during the action: looking for its crash report',
  );
  return deathOf(s, app, since, clean, { held, pid });
}

/**
 * The app's end under an action whose own answer failed as the app it was reading ended (an iOS runner that lost it):
 * its process gone, else a report since the action began, looked for as long as one takes to be written. No read of
 * the screen goes with it, as that is what failed.
 */
export async function endedUnder(
  s: Session,
  app: string,
  wasPid: string | undefined,
  since: number,
  clean: Clean,
) {
  return (await deathWhile(s, app, wasPid, since, clean)) ?? reportOf(s, app, since, clean);
}

/** Lines that say why, the surest first: a stack's head, where its tail says only where. */
const WHY = [
  /fatal|uncaught|terminating/i,
  /exception/i,
  /\berror\b(?!\s*[:=]\s*0\b)|crash|abort/i,
];

/**
 * The app's last log lines, a dead process's own where the device can read them: from the newest that says why, else
 * the newest.
 */
async function lastLines(s: Session, app: string, pid: string | undefined, cleanLog: Clean) {
  const { lines } = await s.device
    .logs({ app, level: 'info', maxLines: LOOKED_AT, ...(pid && { pid }) })
    .catch(() => ({ lines: [] as string[] }));
  const newest = lines.slice(-LOOKED_AT);
  // the newest: an earlier crash of the app may still be among these lines
  const why = WHY.map((p) => newest.findLastIndex((l) => p.test(l))).find((i) => i >= 0) ?? -1;
  const shown = why < 0 ? newest.slice(-LAST_LINES) : newest.slice(why, why + LAST_LINES);
  return shown.map((l) => cleanLog(l).slice(0, LINE_CHARS));
}

/**
 * The refusal of an action whose app died under it: what the action did, why, and the app's last log lines. A report
 * not written yet is looked for once more after them, as a simulator writes its own seconds after the end.
 */
export async function diedRefusal(
  s: Session,
  app: string,
  done: string,
  d: Died,
  o: { wasPid: string | undefined; since: number; clean: Clean; cleanLog: Clean },
) {
  const lines = await lastLines(s, app, o.wasPid, o.cleanLog);
  const said = d.file ? d : ((await reportOf(s, app, o.since, o.clean, 1)) ?? d);
  return new AppDied(
    [
      `${done ? `${done}; ` : ''}${diedLine(said)}`,
      ...(lines.length ? ['its last log lines:', ...lines] : []),
    ].join('\n'),
    'APP_NOT_RUNNING',
    diedHint(said),
    true,
  );
}

/**
 * Watches the selected app's process while `action` runs, from a second in: a crash under a touch held an iPhone
 * simulator's answer for its whole 15 s, which then read as a stuck agent. An end it finds before the action answers
 * refuses with `APP_NOT_RUNNING`, the crash report's reason and the app's last log lines, however long those take to
 * read; the action is stopped there, so that a scroll's next stroke or a key's next press never reaches the device,
 * and its own answer, when it comes, goes unread.
 */
export async function watched<T>(
  s: Session,
  action: () => Promise<T>,
  o: {
    app: string;
    wasPid: string | undefined;
    since: number;
    done: string;
    clean: Clean;
    cleanLog: Clean;
  },
): Promise<T> {
  let over = false;
  const stop = new AbortController();
  const acting = stoppable(stop.signal, action);
  const watch = async (): Promise<Died> => {
    await pause(WATCH_AFTER_MS);
    while (!over) {
      const died = await deathWhile(s, o.app, o.wasPid, o.since, o.clean);
      if (died) return died;
      await pause(WATCH_GAP_MS);
    }
    // the action answered first: this watch has nothing to say
    return new Promise<never>(() => undefined);
  };
  try {
    // the race is to the death being known, not to its whole answer: one that took the log's seconds lost to the
    // action's answer, and what was read before it was dropped, so that its own check found no app that ran
    const first = await Promise.race([acting.then((r) => ({ r })), watch().then((d) => ({ d }))]);
    if ('r' in first) return first.r;
    over = true;
    // before the refusal's seconds of reading: the call that comes after it may be on the app started again
    stop.abort();
    acting.catch(() => undefined);
    // the touch went out, and what was read before it says nothing of the screen now
    s.acted();
    throw await diedRefusal(s, o.app, o.done, first.d, o);
  } finally {
    over = true;
  }
}
