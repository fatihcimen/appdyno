import { pause, reportProgress, type Screen } from '@appdyno/core';
import type { Session } from './session.js';

/** A report can be stamped a moment before the host's clock says the action began. */
const CLOCK_SLACK_MS = 2_000;
/** A crash report is written within moments of the death. */
const REPORT_TRIES = 4;
const REPORT_GAP_MS = 700;

type Clean = (s: string) => string;

/** What a report says of the app's end since `since`; a new process with no report is no death. */
async function reportOf(s: Session, since: number, clean: Clean) {
  for (let i = 0; s.appId && i < REPORT_TRIES; i++) {
    const { reports } = await s.device
      .crashes({ app: s.appId, since: since - CLOCK_SLACK_MS, limit: 1 })
      .catch(() => ({ reports: [] }));
    const r = reports[0];
    if (r) return { reason: clean(r.reason), ...(r.file && { file: r.file }) };
    await pause(REPORT_GAP_MS).catch(() => undefined);
  }
  return undefined;
}

/**
 * The app's end during an action: its process is gone from the front, or another one has taken over
 * (Android restarts a crashed app at once, so the screen alone would not tell).
 */
export async function appDeath(
  s: Session,
  screen: Screen,
  wasPid: string | undefined,
  since: number,
  clean: Clean,
) {
  if (!s.appId) return undefined;
  if (s.device.appPid) {
    const pid = await s.device.appPid(s.appId).catch(() => wasPid);
    s.appPid = pid;
    if (wasPid && pid && pid !== wasPid) {
      reportProgress('the app has a new process: looking for its crash report');
      return reportOf(s, since, clean);
    }
  }
  if (!screen.foreground || screen.foreground === s.appId) return undefined;
  if (await s.device.appRunning(s.appId).catch(() => true)) return undefined;
  reportProgress('the app is gone: looking for its crash report');
  return (
    (await reportOf(s, since, clean)) ?? {
      reason: 'its process is gone and no crash report says why',
    }
  );
}
