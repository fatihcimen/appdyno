import type { ViewerControl } from '@appdyno/core';
import { mockRule, stepLine } from '@appdyno/flows';
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

export const RULE_MOVED = 'That rule was changed elsewhere';

/** A rule's own name: the same on and off, and another once what it takes or does is changed. */
export const ruleId = (line: string) => mockRule(ruleStep(line)).id;

/** A rule with its name and its parts, for a window's fields: its line alone where that reads as no rule. */
export const withFields = (rule: { rule: string }) => {
  try {
    return { ...rule, id: ruleId(rule.rule), fields: ruleFields(rule.rule) };
  } catch {
    return rule;
  }
};

/**
 * What a probe's capture holds beside its requests, as a window is told it: its rules with what each took, its throttle,
 * and whether a failed request fails an action and one no rule takes fails, as the op an agent sets them by lists
 * them. `elsewhere` says that they are not what this window was last told, and that it did not change them: an agent
 * did, or another window.
 */
export function heldBy(
  serial: string,
  op: (args: Record<string, unknown>) => Promise<{ data: Record<string, unknown> | undefined }>,
) {
  let known: string | undefined;
  /** What held after this window's own last change: a read that was under way then may tell it late. */
  let own: string | undefined;
  let mine = false;
  const held = {
    /** A new capture holds nothing yet for anyone to have changed. */
    forget: () => {
      known = undefined;
      own = undefined;
    },
    /** What holds once `change` is done is this window's own doing. */
    async changing(change: () => Promise<void>) {
      mine = true;
      try {
        await change();
        // read here too: the window's own read may have been skipped for one already under way
        await held.now();
      } finally {
        mine = false;
      }
    },
    async now() {
      const { data } = await op({ action: 'mock' });
      const c = captures.read(serial);
      if (!data) return {};
      const holds = {
        rules: ((data.rules as { rule: string }[] | undefined) ?? []).map(withFields),
        throttle: typeof data.throttle === 'string' ? data.throttle : 'full',
        strict: c?.strict === true,
        unmatched: c?.unmatched ?? ('pass' as const),
      };
      const now = JSON.stringify([
        holds.rules.map((r) => r.rule),
        holds.throttle,
        holds.strict,
        holds.unmatched,
      ]);
      if (mine) own = now;
      const elsewhere = known !== undefined && now !== known && !mine && now !== own;
      known = now;
      return { ...holds, ...(elsewhere && { elsewhere }) };
    },
  };
  return held;
}

/**
 * What a person changes of the probe's rules, its speed and what it holds beside them, each by the op an agent makes
 * the change with, through `change`. One rule at a time, by its name, in the list as it stands the moment the change
 * is made: a rule an agent added since the window last read is kept, and a rule that is no longer there is said to
 * have been changed elsewhere, through `moved`, with nothing set.
 */
export function ruleControls(
  serial: string,
  change: (args: Record<string, unknown>, done: string) => Promise<void>,
  moved: () => Promise<void>,
) {
  const lines = () => captures.read(serial)?.rules ?? [];
  /** The list with the rule of that name changed by `to`, or taken out where it gives none; nothing where it is gone. */
  const one = async (id: string, done: string, to: (line: string) => string | undefined) => {
    const now = lines();
    const at = now.findIndex((line) => ruleId(line) === id);
    if (at < 0) return moved();
    const next = to(now[at] ?? '');
    const rules = now.flatMap((line, i) =>
      // a rule changed into one that is there already is that one, once
      i === at ? (next === undefined ? [] : [next]) : line === next ? [] : [line],
    );
    await change({ action: 'mock', rules }, done);
  };
  return {
    /** A new rule after the rest, as the op adds one; with `id`, in place of the rule of that name, on or off as it was. */
    networkRuleSave: async ({ id, rule, fields }: ViewerControl<'networkRuleSave'>) => {
      const line = rule === undefined ? fieldsLine(fields ?? {}) : ruleLine(rule);
      if (id === undefined)
        return change({ action: 'mock', rules: [line], add: true }, 'Rule added');
      await one(id, 'Rule saved', (was) =>
        'off' in ruleStep(was).args && !('off' in ruleStep(line).args)
          ? ruleSwitched(line, false)
          : line,
      );
    },
    networkRuleRemove: ({ id }: ViewerControl<'networkRuleRemove'>) =>
      one(id, 'Rule removed', () => undefined),
    networkRuleSwitch: ({ id, on }: ViewerControl<'networkRuleSwitch'>) =>
      one(id, on ? 'Rule turned on' : 'Rule turned off', (was) => ruleSwitched(was, on)),
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
