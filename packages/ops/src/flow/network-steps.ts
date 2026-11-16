import type { FlowStep } from '@appdyno/flows';
import { ruleStep } from '../network-rules.js';
import { stepOf, unrecorded } from './aim.js';

/**
 * A `network` call as the steps of a flow: each rule set is a `mock` step and `strict` a `network strict`, which a
 * replay sets and takes back at its end, and a `check` a `request`. A capture, a throttle and a clearing have no step; `looks` are the actions
 * that change nothing, and leave none.
 */
export function networkSteps(
  a: Record<string, unknown>,
  looks: readonly string[],
): FlowStep | FlowStep[] | undefined {
  const rules = a.action === 'mock' ? ((a.rules as string[] | undefined) ?? []) : [];
  const steps = [
    ...rules.map((rule) => ({ ...ruleStep(rule), line: 0 })),
    ...(a.strict === undefined
      ? []
      : [stepOf('network', {}, { name: 'strict', ...(a.strict === false && { value: 'off' }) })]),
  ];
  if (steps.length > 0) return steps;
  if (a.action === 'check')
    return stepOf(
      'request',
      {},
      {
        part: a.contains as string | undefined,
        method: a.method as string | undefined,
        status: a.status as string | undefined,
        has: a.has as string | undefined,
        timeoutMs: a.timeoutMs as number | undefined,
      },
    );
  return looks.includes(a.action as string) ||
    (a.action === 'mock' && !a.rules) ||
    (a.action === 'throttle' && a.throttle === undefined)
    ? undefined
    : unrecorded(`network ${String(a.action)}`);
}
