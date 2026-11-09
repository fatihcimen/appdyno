import { pause, reportProgress } from '@appdyno/core';
import type { ActionOut } from './schemas.js';
import type { Session } from './session.js';

/** A report can be stamped a moment before the host's clock says the action began. */
const CLOCK_SLACK_MS = 2_000;
/** A crash report is written within moments of the death. */
const REPORT_TRIES = 4;
const REPORT_GAP_MS = 700;

type Clean = (s: string) => string;

/** What a report says of the app's end since `since`; a new process with no report is no death. */
async function reportOf(s: Session, since: number, clean: Clean, tries = REPORT_TRIES) {
  for (let i = 0; s.appId && i < tries; i++) {
    const { reports } = await s.device
      .crashes({ app: s.appId, since: since - CLOCK_SLACK_MS, limit: 1 })
      .catch(() => ({ reports: [] }));
    const r = reports[0];
    if (r) return { reason: clean(r.reason), ...(r.file && { file: r.file }) };
    await pause(REPORT_GAP_MS).catch(() => undefined);
  }
  return undefined;
}

/** What to do once the app died under a call that failed for it. */
export const DIED_HINT = 'launch_app starts it again, and crashes says why it died';

/** An answer's line of the app's end. */
export const diedLine = ({ reason, file }: NonNullable<ActionOut['appDied']>) =>
  `the app died: ${reason}${file ? ` (${file})` : ''}`;

/**
 * The app's end during an action: its process is gone from the front, or another one has taken over
 * (Android restarts a crashed app at once, so the screen alone would not tell). `ran`: it was in front on the read
 * before the action, or the action launched it; an app not running then, with no process before either, did not die
 * in it, as one a link never opened.
 */
export async function appDeath(
  s: Session,
  foreground: string | undefined,
  wasPid: string | undefined,
  since: number,
  clean: Clean,
  ran: boolean,
) {
  if (!s.appId) return undefined;
  if (s.device.appPid) {
    const pid = await s.device.appPid(s.appId).catch(() => wasPid);
    s.appPid = pid;
    if (wasPid && pid !== wasPid) {
      reportProgress(
        pid
          ? 'the app has a new process: looking for its crash report'
          : 'the app has no process: looking for its crash report',
      );
      // a new process with no report is no death, as a link may start one; none at all is one, a crash dialog over it
      const report = await reportOf(s, since, clean);
      return (
        report ?? (pid ? undefined : { reason: 'its process is gone and no crash report says why' })
      );
    }
  }
  if (!foreground || foreground === s.appId || !(ran || wasPid)) return undefined;
  if (await s.device.appRunning(s.appId).catch(() => true)) return undefined;
  reportProgress('the app is gone: looking for its crash report');
  return (
    (await reportOf(s, since, clean)) ?? {
      reason: 'its process is gone and no crash report says why',
    }
  );
}

/**
 * The app's end under a call that failed: as `appDeath` for an app that `ran`, else a crash report since `since`, read
 * once, as the failure has waited already. The system restarts a crashed app, and where nothing knew its process before,
 * only the report tells.
 */
export async function diedUnder(
  s: Session,
  foreground: string | undefined,
  wasPid: string | undefined,
  since: number,
  clean: Clean,
  ran: boolean,
) {
  const gone = ran ? await appDeath(s, foreground, wasPid, since, clean, true) : undefined;
  return gone ?? reportOf(s, since, clean, 1);
}
