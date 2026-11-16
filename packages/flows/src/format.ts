/**
 * The flow file: one line per step, so that a failure names its line for nothing, a review reads as a
 * list of actions and a diff shows the step that changed. JSON would need a position-keeping parser for
 * that line and YAML a dependency. Values are bare words or JSON strings, so escapes and Unicode cost
 * nothing.
 *
 *   # a comment
 *   app dev.appdyno.fixture
 *   tag smoke login
 *   param NAME
 *   secret PASSWORD_INPUT
 *   launch
 *   type "${NAME}" id=name_input replace
 *   tap role=button text="Send"
 *   assert id=result check=text equals="Sent: ${NAME}"
 *   tap id=add_button index=2 !ambiguous
 *   launch language=tr arg=-UITests env=API_URL=https://staging.example
 *   run shared/logout.flow
 *   only ios tap text="Allow Once"
 *
 * `setup shared/sign-in.flow` and `teardown shared/sign-out.flow` among the first lines name a file whose steps run
 * before and after this one's: see `composeFlow`.
 *
 * Values of `param` and `secret` come from `--param` or the environment and are never in the file. `$${`
 * is a literal `${`. `!flag` marks a step a person should look at.
 */

import { checkDeviceStep } from './device-steps.js';
import { SPECS, type Spec } from './specs.js';
import { FlowError, quote, show, tokens, WORD, type Token } from './tokens.js';

export { FlowError } from './tokens.js';

export type FlowSelector = { id?: string; role?: string; text?: string; index?: number };

/**
 * `ambiguous`: picked by its index among several. `coordinates`: nothing named it. `running`: a launch that found the
 * app running, on a screen a replay goes on from only if the app is on it then. `review`: a number a recording took from
 * what it found, for a person to set.
 */
export type Flag = 'ambiguous' | 'coordinates' | 'running' | 'review';

/** The platforms a step may be kept to: `only ios` before it, or around several lines closed by `end`. */
export const PLATFORMS = ['ios', 'android'] as const;
export type Only = (typeof PLATFORMS)[number];

/** Whether a step is one of a run on `platform`: the device decides, never what its screen shows. */
export const runsOn = (st: FlowStep, platform: string | undefined) =>
  !st.only || !platform || st.only === platform;

type Scalar = string | number | boolean;

export type FlowStep = {
  action: Action;
  /** The file's line, 1-based; 0 for a step not read from a file. */
  line: number;
  /** The file it was written in, when another flow runs it: see `composeFlow`. */
  file?: string;
  /** The one platform it runs on: on the other it is skipped, and said to be. */
  only?: Only;
  selector?: FlowSelector;
  args: Record<string, Scalar | string[]>;
  flags: Flag[];
};

export type Flow = {
  app?: string;
  /** What `appdyno test --tag` selects it by. */
  tags: string[];
  params: string[];
  secrets: string[];
  steps: FlowStep[];
  /** The files its `setup` and `teardown` lines name, as written: paths from this file. */
  setupFile?: string;
  teardownFile?: string;
  /** Their steps once read in, with the folders' own: what runs before the first step, and after the last or a failure. */
  setup?: FlowStep[];
  teardown?: FlowStep[];
};

export type Action = keyof typeof SPECS;

const NUMERIC_WORDS = new Set(['lat', 'lon']);
/** Words a file has bare where they can be: a typed text or a URL is always quoted, so it never reads as a word. */
const BARE_WORDS = new Set(['key', 'direction', 'name', 'value', 'type']);
const SELECTOR_KEYS = ['id', 'role', 'text'] as const;
const FLAGS: readonly string[] = ['ambiguous', 'coordinates', 'running', 'review'] satisfies Flag[];
const NAME = /^[A-Z_][A-Z0-9_]*$/;
/** A placeholder, or the escape of one. */
const PLACEHOLDER = /\$\$\{|\$\{([^}]*)\}/g;

const isPhase = (word: string) => word === 'setup' || word === 'teardown';

const specOf = (action: string): Spec | undefined =>
  Object.hasOwn(SPECS, action) ? SPECS[action as Action] : undefined;

const numberOf = (value: string, what: string, line: number) => {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n)) throw new FlowError(`${what} needs a number`, line);
  return n;
};

function parseStep(action: string, rest: Token[], line: number): FlowStep {
  const spec = specOf(action);
  if (!spec)
    throw new FlowError(`no step ${action}; steps: ${Object.keys(SPECS).join(', ')}`, line);
  const step: FlowStep = { action: action as Action, line, args: {}, flags: [] };
  const words = [...(spec.words ?? [])];
  const select = spec.target !== undefined;
  const point = spec.target === 'point' || spec.target === 'point-needed';
  for (const t of rest) {
    if (t.key === undefined && !t.quoted && t.value.startsWith('!')) {
      const flag = t.value.slice(1);
      if (!FLAGS.includes(flag)) throw new FlowError(`no flag !${flag}`, line);
      step.flags.push(flag as Flag);
      continue;
    }
    if (t.key === undefined && !t.quoted && spec.bool?.includes(t.value)) {
      step.args[t.value] = true;
      continue;
    }
    if (t.key === undefined) {
      const name = words.shift()?.replace('?', '');
      if (!name) throw new FlowError(`${action}: unexpected word ${t.value}`, line);
      step.args[name] = NUMERIC_WORDS.has(name) ? numberOf(t.value, name, line) : t.value;
      continue;
    }
    const k = t.key;
    if (k === 'ref')
      throw new FlowError('a ref names an element for one session: use a selector', line);
    if (select && (SELECTOR_KEYS as readonly string[]).includes(k)) {
      (step.selector ??= {})[k as (typeof SELECTOR_KEYS)[number]] = t.value;
    } else if (select && k === 'index') {
      (step.selector ??= {}).index = numberOf(t.value, 'index', line);
    } else if (point && (k === 'x' || k === 'y')) {
      step.args[k] = numberOf(t.value, k, line);
    } else if (point && k === 'screen') {
      step.args.screen = t.value;
    } else if (spec.list?.includes(k)) {
      if ((k === 'env' || k === 'data') && t.value.indexOf('=') < 1)
        throw new FlowError(`${k} is NAME=value: ${t.value}`, line);
      step.args[k] = [...((step.args[k] as string[] | undefined) ?? []), t.value];
    } else if (spec.text?.includes(k)) {
      step.args[k] = t.value;
    } else if (spec.number?.includes(k)) {
      step.args[k] = numberOf(t.value, k, line);
    } else if (spec.bool?.includes(k)) {
      if (t.value !== 'true' && t.value !== 'false')
        throw new FlowError(`${k} is true or false`, line);
      step.args[k] = t.value === 'true';
    } else throw new FlowError(`${action} has no ${k}`, line);
  }
  const missing = words.filter((w) => !w.endsWith('?'));
  if (missing.length > 0) throw new FlowError(`${action} needs ${missing.join(', ')}`, line);
  const named = step.selector && (step.selector.id || step.selector.role || step.selector.text);
  if (step.selector && !named)
    throw new FlowError(`${action}: an index needs id, role or text`, line);
  const placed = step.args.x !== undefined || step.args.y !== undefined;
  if (placed && (step.args.x === undefined || step.args.y === undefined))
    throw new FlowError(`${action}: give x and y`, line);
  if (placed && step.selector) throw new FlowError(`${action}: a selector or x, y, not both`, line);
  if (placed && !step.flags.includes('coordinates'))
    throw new FlowError(`${action}: raw coordinates are flagged !coordinates`, line);
  if ((spec.target === 'needed' && !named) || (spec.target === 'point-needed' && !named && !placed))
    throw new FlowError(`${action} needs a target: id, role or text`, line);
  checkDeviceStep(step, line);
  return step;
}

/** The names a string's placeholders use. */
const namesIn = (value: string, line: number) =>
  [...value.matchAll(PLACEHOLDER)].flatMap(([whole, name]) => {
    // `$${` is the one match without a name
    if (name === undefined) return [];
    if (!NAME.test(name)) throw new FlowError(`no such placeholder: ${whole}`, line);
    return [name];
  });

const stringsOf = (st: FlowStep) => [
  ...Object.values(st.args)
    .flat()
    .filter((v) => typeof v === 'string'),
  ...SELECTOR_KEYS.flatMap((k) => st.selector?.[k] ?? []),
];

/** The names a step needs a value for. */
export const namesOf = (st: FlowStep) => stringsOf(st).flatMap((v) => namesIn(v, st.line));

/** The names a `prepare` step gives a value to, for the steps after it. */
export const givesOf = (st: FlowStep) =>
  st.action === 'prepare' ? ((st.args.gives as string[] | undefined) ?? []) : [];

export function parseFlow(text: string): Flow {
  const flow: Flow = { tags: [], params: [], secrets: [], steps: [] };
  const lines = text.split(/\r?\n/);
  let appLine = 0;
  /** An `only` with no step after it, open until `end`: every step between is that platform's. */
  let block: { only: Only; line: number } | undefined;
  for (const [i, raw] of lines.entries()) {
    const line = i + 1;
    const toks = tokens(raw, line);
    const [head] = toks;
    if (!head) continue;
    if (head.quoted || head.key !== undefined)
      throw new FlowError(`a line starts with a step: ${raw.trim()}`, line);
    const word = head.value;
    if (word === 'tag') {
      if (flow.steps.length > 0 || block) throw new FlowError('tag comes before the steps', line);
      const tags = toks.slice(1);
      if (tags.length === 0 || tags.some((t) => t.key !== undefined || !WORD.test(t.value)))
        throw new FlowError('tag takes words: tag smoke login', line);
      flow.tags.push(...tags.map((t) => t.value));
      continue;
    }
    if (word === 'app' || word === 'param' || word === 'secret' || isPhase(word)) {
      if (flow.steps.length > 0 || block)
        throw new FlowError(`${word} comes before the steps`, line);
      const value = toks[1];
      if (!value || toks.length !== 2 || value.key !== undefined)
        throw new FlowError(`${word} takes one word`, line);
      if (isPhase(word)) {
        const key = word === 'setup' ? 'setupFile' : 'teardownFile';
        if (flow[key] !== undefined) throw new FlowError(`one ${word} per flow`, line);
        if (!value.value.endsWith('.flow'))
          throw new FlowError(`${word} names a .flow file: ${value.value}`, line);
        flow[key] = value.value;
        continue;
      }
      if (word === 'app') {
        if (flow.app !== undefined) throw new FlowError('one app per flow', line);
        flow.app = value.value;
        appLine = line;
        continue;
      }
      if (!NAME.test(value.value))
        throw new FlowError(`${word} names are like MY_NAME: ${value.value}`, line);
      if (flow.params.includes(value.value) || flow.secrets.includes(value.value))
        throw new FlowError(`${value.value} is declared twice`, line);
      (word === 'param' ? flow.params : flow.secrets).push(value.value);
      continue;
    }
    if (word === 'end') {
      if (!block || toks.length > 1) throw new FlowError('end closes an only block, alone', line);
      block = undefined;
      continue;
    }
    if (word !== 'only') {
      const step = parseStep(word, toks.slice(1), line);
      flow.steps.push(block ? { ...step, only: block.only } : step);
      continue;
    }
    const [, on, action, ...rest] = toks;
    const only = PLATFORMS.find((p) => p === on?.value && on.key === undefined && !on.quoted);
    if (!only) throw new FlowError('only takes ios or android: only ios tap id=allow', line);
    if (block)
      throw new FlowError(`this is inside the only ${block.only} of line ${block.line}`, line);
    if (!action) block = { only, line };
    else if (action.quoted || action.key !== undefined)
      throw new FlowError(`only ${only} is followed by a step: ${raw.trim()}`, line);
    else flow.steps.push({ ...parseStep(action.value, rest, line), only });
  }
  if (block) throw new FlowError(`only ${block.only} is not closed: end closes it`, block.line);
  const declared = new Set([...flow.params, ...flow.secrets]);
  const undeclared = (name: string, line: number) => {
    if (!declared.has(name))
      throw new FlowError(`\${${name}} is not declared: add param ${name} or secret ${name}`, line);
  };
  if (flow.app) for (const n of namesIn(flow.app, appLine)) undeclared(n, appLine);
  for (const st of flow.steps)
    for (const n of [...namesOf(st), ...givesOf(st)]) undeclared(n, st.line);
  if (flow.steps.length === 0) throw new FlowError('a flow has at least one step', 0);
  return flow;
}

/** A selector as a flow's file has it. */
const selectorWords = (s: FlowSelector | undefined) => [
  ...(s?.id !== undefined ? [`id=${show(s.id)}`] : []),
  ...(s?.role !== undefined ? [`role=${show(s.role)}`] : []),
  ...(s?.text !== undefined ? [`text=${quote(s.text)}`] : []),
  ...(s?.index !== undefined ? [`index=${s.index}`] : []),
];

export const selectorLine = (s: FlowSelector) => selectorWords(s).join(' ');

/** One step as its line. */
export function stepLine(st: FlowStep): string {
  const spec: Spec = SPECS[st.action];
  const words = (spec.words ?? []).flatMap((w): (string | number | boolean)[] => {
    const name = w.replace('?', '');
    const v = st.args[name];
    // a list is never a word
    if (v === undefined || Array.isArray(v)) return [];
    return typeof v === 'string' ? [BARE_WORDS.has(name) ? show(v) : quote(v)] : [v];
  });
  const named = new Set((spec.words ?? []).map((w) => w.replace('?', '')));
  const rest = Object.entries(st.args)
    .filter(([k]) => !named.has(k))
    .flatMap(([k, v]) => {
      if (Array.isArray(v)) return v.map((x) => `${k}=${show(x)}`);
      if (typeof v === 'boolean') return v ? k : `${k}=false`;
      return typeof v === 'number' ? `${k}=${v}` : `${k}=${show(v)}`;
    });
  const selector = selectorWords(st.selector);
  const only = st.only ? ['only', st.only] : [];
  return [...only, st.action, ...words, ...selector, ...rest, ...st.flags.map((f) => `!${f}`)].join(
    ' ',
  );
}

/** A flow as its file; `parseFlow` reads it back. */
export const flowText = (flow: Flow) => {
  const headed =
    flow.app || flow.tags.length || flow.params.length || flow.secrets.length || flow.setupFile;
  return [
    ...(flow.app ? [`app ${show(flow.app)}`] : []),
    ...(flow.tags.length > 0 ? [`tag ${flow.tags.join(' ')}`] : []),
    ...flow.params.map((p) => `param ${p}`),
    ...flow.secrets.map((p) => `secret ${p}`),
    ...(flow.setupFile ? [`setup ${show(flow.setupFile)}`] : []),
    ...(flow.teardownFile ? [`teardown ${show(flow.teardownFile)}`] : []),
    ...(headed || flow.teardownFile ? [''] : []),
    ...flow.steps.map(stepLine),
    '',
  ].join('\n');
};

/** A literal as a flow's string: only what would read as a placeholder changes. */
export const escapeLiteral = (s: string) => s.replace(/\$\{/g, '$$$${');

const fill = (value: string, values: Record<string, string>) =>
  value.replace(PLACEHOLDER, (m, name: string | undefined) =>
    name === undefined ? '${' : (values[name] ?? m),
  );

/** A step with each string of its arguments and its selector through `f`. */
export function mapStrings(st: FlowStep, f: (value: string) => string): FlowStep {
  const args = Object.fromEntries(
    Object.entries(st.args).map(([k, v]) => [
      k,
      typeof v === 'string' ? f(v) : Array.isArray(v) ? v.map((x) => f(x)) : v,
    ]),
  );
  const s = st.selector;
  return {
    ...st,
    args,
    ...(s && {
      selector: {
        ...(s.id !== undefined && { id: f(s.id) }),
        ...(s.role !== undefined && { role: f(s.role) }),
        ...(s.text !== undefined && { text: f(s.text) }),
        ...(s.index !== undefined && { index: s.index }),
      },
    }),
  };
}

/** A step with its placeholders filled. */
export const fillStep = (st: FlowStep, values: Record<string, string>) =>
  mapStrings(st, (v) => fill(v, values));

/** A name a placeholder may have: `param` and `secret` take only these. */
export const isName = (name: string) => NAME.test(name);

/** The app's id with its placeholders filled. */
export const fillApp = (app: string, values: Record<string, string>) => fill(app, values);

/**
 * A flow's steps in the order a run takes them: its setup, its own from `from`, its teardown. With a platform, the
 * ones a run there takes.
 */
export const stepsInOrder = (flow: Flow, from = 1, platform?: string) =>
  [...(flow.setup ?? []), ...flow.steps.slice(from - 1), ...(flow.teardown ?? [])].filter((st) =>
    runsOn(st, platform),
  );

/**
 * Values for the names of a flow's steps from `--param`, then `env`: an env file's, and a command line's own
 * environment. A missing one is refused before anything runs, by name: a value in the message would be stored by
 * whatever keeps the log. A name a `prepare` step gives needs none in the steps after it, nor one only a step of the
 * other platform uses.
 */
export function valuesFor(
  flow: Flow,
  params: Record<string, string>,
  env: Record<string, string | undefined>,
  from = 1,
  platform?: string,
): Record<string, string> {
  const needed = new Set(flow.app ? namesIn(flow.app, 0) : []);
  const given = new Set<string>();
  for (const st of stepsInOrder(flow, from, platform)) {
    for (const n of namesOf(st)) if (!given.has(n)) needed.add(n);
    for (const n of givesOf(st)) given.add(n);
  }
  const values: Record<string, string> = {};
  // a value a person gave by name stands, whatever a prepare step prints for it
  for (const name of given) if (params[name] !== undefined) values[name] = params[name];
  const missing: string[] = [];
  for (const name of needed) {
    const v = params[name] ?? env[name];
    if (v === undefined) missing.push(name);
    else values[name] = v;
  }
  const [first] = missing;
  if (first !== undefined)
    throw new FlowError(
      `no value for ${missing.join(', ')}: give --param ${first}=... (params), or it in an env file, or on the command line in the environment`,
      0,
    );
  return values;
}
