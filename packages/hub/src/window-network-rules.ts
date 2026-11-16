import type { ViewerControl } from '@appdyno/core';
import { stepLine } from '@appdyno/flows';
import { captures, ruleLine, ruleStep, ruleSwitched } from '@appdyno/ops';

/** The parts of a rule a window has a field for; what has none stays as the words of its line, in `match`. */
const FIELDS = [
  'method',
  'host',
  'path',
  'match',
  'status',
  'body',
  'delayMs',
  'fail',
  'to',
] as const;
export type RuleFields = Partial<Record<(typeof FIELDS)[number], string>>;

/** The words of a line that have a field of their own. */
const OWN: readonly string[] = ['request', 'method', 'status', 'body', 'delayMs', 'fail', 'to'];

/**
 * A rule's line as the fields of a window: its request as a host and a path, each thing it does in its own field, and
 * the rest of what it must match, with what else it says, as they are written.
 */
export function ruleFields(line: string): RuleFields {
  const st = ruleStep(line);
  const a = st.args;
  const request = String(a.request);
  const slash = request.indexOf('/');
  const rest = Object.fromEntries(Object.entries(a).filter(([k]) => !OWN.includes(k)));
  const parts: Record<string, string | number | boolean | string[] | undefined> = {
    method: a.method,
    host: slash < 0 ? request : request.slice(0, slash),
    path: slash < 0 ? undefined : request.slice(slash),
    match: stepLine({ ...st, args: rest }).replace(/^mock ?/, '') || undefined,
    status: a.status,
    body: a.body,
    delayMs: a.delayMs,
    fail: a.fail,
    to: a.to,
  };
  return Object.fromEntries(
    FIELDS.flatMap((k) => {
      const v = parts[k];
      return typeof v === 'string' || typeof v === 'number' ? [[k, String(v)]] : [];
    }),
  );
}

/**
 * The line of the rule a window's fields make, as the op writes it: refused in the op's words where they make none. A
 * body and a host to send to are quoted as they were typed; the words of `match` are a line's own, and go in as they
 * are.
 */
export function fieldsLine(f: RuleFields): string {
  const word = (key: 'method' | 'status' | 'delayMs' | 'fail', quoted = false) => {
    const v = f[key]?.trim();
    return v ? [`${key}=${quoted ? JSON.stringify(v) : v}`] : [];
  };
  const text = (key: 'body' | 'to') => (f[key] ? [`${key}=${JSON.stringify(f[key])}`] : []);
  return ruleLine(
    [
      JSON.stringify(`${f.host?.trim() ?? ''}${f.path?.trim() ?? ''}`),
      ...word('method'),
      ...(f.match?.trim() ? [f.match.trim()] : []),
      ...word('status'),
      ...text('body'),
      ...word('delayMs'),
      ...word('fail'),
      ...text('to'),
    ].join(' '),
  );
}

/** A rule with its parts, for a window's fields: its line alone where that reads as no rule. */
export const withFields = (rule: { rule: string }) => {
  try {
    return { ...rule, fields: ruleFields(rule.rule) };
  } catch {
    return rule;
  }
};

/**
 * What a person changes of the probe's rules, its speed and what it holds beside them, each by the op an agent makes
 * the change with, through `change`.
 */
export function ruleControls(
  serial: string,
  change: (args: Record<string, unknown>, done: string) => Promise<void>,
) {
  const lines = () => captures.read(serial)?.rules ?? [];
  const setRules = (rules: string[]) => change({ action: 'mock', rules }, 'Rules set');
  return {
    networkRules: (m: ViewerControl<'networkRules'>) => setRules(m.rules),
    networkRuleSwitch: (m: ViewerControl<'networkRuleSwitch'>) =>
      setRules(lines().map((line, i) => (i === m.at ? ruleSwitched(line, m.on) : line))),
    /** In place of the rule at `at`, or after the rest: refused as the op refuses a line. */
    networkRuleFields: async ({ at, fields }: ViewerControl<'networkRuleFields'>) => {
      const next = [...lines()];
      next.splice(at >= 0 && at < next.length ? at : next.length, 1, fieldsLine(fields));
      await setRules(next);
    },
    networkKeep: ({ strict, unmatched }: ViewerControl<'networkKeep'>) =>
      change(
        {
          action: 'mock',
          ...(strict !== undefined && { strict }),
          ...(unmatched !== undefined && { unmatched }),
        },
        'Rules set',
      ),
    networkThrottle: (m: ViewerControl<'networkThrottle'>) =>
      change({ action: 'throttle', throttle: m.value }, 'Speed set'),
  };
}
