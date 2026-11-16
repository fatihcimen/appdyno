import { type Flag, type FlowSelector, type FlowStep, selectorLine } from '@appdyno/flows';
import type { Session } from '../session.js';
import type { Step } from '../step-schemas.js';
import { type Aim, type Size, stepOf, unrecorded } from './aim.js';

/** A target as the flat form the ops take. */
export type Target = { ref?: string; x?: number; y?: number; selector?: FlowSelector };

type Args = Record<string, unknown>;

const text = (v: unknown) => v as string | undefined;

/**
 * What a flow had no step for, each as the step that replays it. What stays unrecorded is what no line could say for a
 * person to read and mend: fingers' own paths, and a script run in a page.
 */

/** A push that was sent; a call with no type and nothing to send listed what the device takes, and sent nothing. */
export function pushStep(a: Args, data: Args): FlowStep | undefined {
  const sent = a.data as Record<string, string> | undefined;
  // a line's `data=` is a name up to its first `=`: a name that holds one has no line that reads back as it
  if (Object.keys(sent ?? {}).some((k) => k.includes('='))) return unrecorded('send_push');
  if (data.types) return undefined;
  return stepOf(
    'push',
    {},
    {
      // a title or body alone went as an alert, and is written as what it went as
      type: text(a.type) ?? 'alert',
      app: text(a.app),
      title: text(a.title),
      body: text(a.body),
      image: text(a.image),
      data: sent && Object.entries(sent).map(([k, v]) => `${k}=${v}`),
      payload: text(a.payload),
    },
  );
}

/** A click in a web view: a page's id is this session's, so a click on the page that was showing finds the one showing then. */
export const webClickStep = (a: Args, data: Args) =>
  stepOf(
    'web_click',
    {},
    { css: text(a.selector), page: a.page === data.page ? undefined : text(a.page) },
  );

/** An audit: what it found then is no standard, so the step keeps the count, flagged for a person to set. */
export const auditStep = (a: Args, data: Args) =>
  stepOf(
    'audit',
    { flags: ['review'] },
    {
      types: (a.types as string[] | undefined)?.join(','),
      max: (data.issues as unknown[]).length,
    },
  );

/**
 * A drag's record: from its target, named as a tap's is, in a straight line to where it was let go. That is an element
 * where the agent named one a selector finds alone, else a point, which holds for this size of screen as a tap's does.
 */
export async function dragRecord(
  aim: (s: Session, t: Target) => Promise<Aim>,
  size: (s: Session) => Promise<Size | undefined>,
  s: Session,
  st: Extract<Step, { action: 'drag' }>,
) {
  const from = await aim(s, st);
  const end = st.to.x !== undefined && st.to.y !== undefined ? undefined : await aim(s, st.to);
  const drop = end?.selector && !end.flags?.length ? selectorLine(end.selector) : undefined;
  const point = drop
    ? undefined
    : (end?.element ?? (st.to.x !== undefined && st.to.y !== undefined ? st.to : undefined));
  const screen = point && (await size(s));
  return () => {
    const to = drop ?? (point && `${String(point.x)},${String(point.y)}`);
    if (!(from.selector || from.args) || !to)
      return unrecorded('swipe_screen to, of an element gone from the screen');
    const flags: Flag[] = [
      ...new Set<Flag>([...(from.flags ?? []), ...(point ? ['coordinates' as const] : [])]),
    ];
    return stepOf(
      'drag',
      { ...from, flags },
      {
        to,
        holdMs: st.holdMs,
        durationMs: st.durationMs,
        ...(screen && { screen: `${screen.w}x${screen.h}` }),
      },
    );
  };
}
