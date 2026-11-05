import type { MirrorSession } from '@appdyno/core';
import { activityFollower, type ActivityLine } from '../activity.js';
import { handoffRequest } from './handoff.js';

const POLL_MS = 250;
/** The pill goes this long after the last call. */
const DRIVING_MS = 2_000;
const ARGS_SHOWN = 200;

/** What a tool said it did, as a person reads it: `tapped e12 "Sign in"` is `Tapped Sign in`. */
export const spokenDone = (done: string | undefined) => {
  if (!done) return undefined;
  const plain = done
    .replace(/\b[a-z]?\d+ "((?:[^"\\]|\\.)*)"/g, '$1')
    .replace(/ \((up|down|left|right)\)$/, '');
  return plain.charAt(0).toUpperCase() + plain.slice(1);
};

const forWindow = ({ at, tool, ms, ok, args, done }: ActivityLine) => ({
  op: 'activity',
  at,
  time: new Date(at).toLocaleTimeString(),
  tool,
  ms,
  ok,
  args: JSON.stringify(args).slice(0, ARGS_SHOWN),
  ...(done && { done: spokenDone(done) }),
});

/** Tells a window what other processes do on its device: calls, and a request for a person. No socket. */
export function followDevice(
  serial: string,
  session: Pick<MirrorSession, 'tell'>,
  each?: () => void,
) {
  const lines = activityFollower(serial);
  let lastCall = 0;
  let driving = false;
  let banner: string | undefined;
  const timer = setInterval(() => {
    each?.();
    const now = Date.now();
    for (const line of lines()) {
      lastCall = now;
      driving = true;
      session.tell({
        op: 'agent',
        driving: true,
        tool: line.tool,
        ...(line.client && { client: line.client }),
      });
      session.tell(forWindow(line));
      if (line.touched) session.tell({ op: 'touchAt', ...line.touched, agent: true });
    }
    if (driving && now - lastCall >= DRIVING_MS) {
      driving = false;
      session.tell({ op: 'agent', driving: false });
    }
    const request = handoffRequest(serial);
    if (request?.id !== banner) {
      banner = request?.id;
      session.tell(
        request
          ? { op: 'banner', id: request.id, text: request.reason, needsDone: true, sound: true }
          : { op: 'banner' },
      );
    }
  }, POLL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
