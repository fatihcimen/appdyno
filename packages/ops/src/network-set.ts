import { must } from '@appdyno/core';
import type { ServerContext } from './context.js';
import type { Asked, networkAnswers } from './network-answer.js';
import { readCapture, setKept, setRules, setThrottle, type Capture } from './network-capture.js';
import { ruleFromRequest, rulesFromHar } from './network-from.js';
import { checkApp } from './policy.js';
import type { Session } from './session.js';
import { ToolError } from './tool.js';

/** What a rule that fails a request, or a throttle, does not reach: said with each. */
const APP_ONLY =
  "only the app's URLSession requests: the system still reads the Mac's network as it is";
export const STRICT_ON =
  'strict on: an action fails when a request of the app got a 5xx or failed on its way, unless a rule made it';
const UNMATCHED_FAIL =
  'unmatched fail: a request of the app that no rule takes fails, as with no network';

/** What `mock` and `throttle` are asked to set: with none of it they list what holds. */
export type Setting = {
  action: 'mock' | 'throttle';
  rules?: string[] | undefined;
  add?: boolean | undefined;
  from?: string | undefined;
  unmatched?: 'pass' | 'fail' | undefined;
  strict?: boolean | undefined;
  throttle?: string | undefined;
};

/**
 * What the probe does to the app's requests, set by `mock` and `throttle`: its rules, given or made of answers, what
 * becomes of a request no rule takes, whether a failed request fails an action, and how slow the network is.
 */
export function networkSetting(
  ctx: ServerContext,
  { clean, detailOf, controlAnswer }: ReturnType<typeof networkAnswers>,
) {
  /** Rules of what was answered: a request of the capture that runs by its id, or each answer of a HAR file. */
  const rulesFrom = async (s: Session, now: Capture | undefined, from: string, asked: Asked) => {
    if (!/^\d+$/.test(from)) return rulesFromHar(ctx.policy, from, asked, clean);
    if (!now)
      throw new ToolError(
        `from ${from} is a request of a capture, and none runs: start one, or give a .har file`,
        'NOT_FOUND',
      );
    const one = (await readCapture(s, now, true))?.entries.find((e) => e.id === Number(from));
    if (!one) throw new ToolError(`no request ${from} in this capture`, 'NOT_FOUND');
    const detail = await detailOf(s, now)(Number(from));
    return ruleFromRequest(ctx.policy, one, detail, clean, asked.overwrite);
  };

  return async (
    s: Session,
    now: Capture | undefined,
    target: string | undefined,
    { action, rules, add, from, unmatched, strict, throttle }: Setting,
    asked: Asked,
  ) => {
    const made = from === undefined ? undefined : await rulesFrom(s, now, from, asked);
    const sets = action === 'mock' ? (rules ?? made?.lines) : throttle;
    const keeps = (strict ?? unmatched) !== undefined;
    if (sets === undefined && !keeps) return controlAnswer(s, now, []);
    if (target) checkApp(ctx.policy, target);
    const lines = [...(rules ?? []), ...(made?.lines ?? [])];
    const set =
      sets === undefined
        ? undefined
        : action === 'mock'
          ? // what was made of answers joins the rules that are there, unless rules came with it to replace them
            await setRules(s, ctx.policy, target, lines, add ?? rules === undefined)
          : await setThrottle(s, target, throttle ?? 'full');
    const kept = keeps ? await setKept(s, target, { strict, unmatched }) : undefined;
    const capture = must(kept?.capture ?? set?.capture, 'the capture');
    const did = [
      ...((set ?? kept)?.started
        ? [`started a capture by the probe: ${String(target)} was restarted with it`]
        : []),
      ...(set
        ? [
            `${action === 'mock' ? 'rules set' : `throttle ${capture.throttle ?? 'full'}`}: for ${APP_ONLY}; ended by capture_network stop`,
          ]
        : []),
      ...(made?.notes ?? []),
      ...(strict === undefined ? [] : [strict ? STRICT_ON : 'strict off']),
      ...(unmatched === undefined
        ? []
        : [unmatched === 'fail' ? UNMATCHED_FAIL : 'unmatched pass']),
    ];
    return controlAnswer(s, capture, did, made?.lines);
  };
}
