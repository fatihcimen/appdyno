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
 *   run shared/logout.flow
 *
 * Values of `param` and `secret` come from `--param` or the environment and are never in the file. `$${`
 * is a literal `${`. `!flag` marks a step a person should look at.
 */

export type FlowSelector = { id?: string; role?: string; text?: string; index?: number };

/** `ambiguous`: picked by its index among several. `coordinates`: nothing named it. */
export type Flag = 'ambiguous' | 'coordinates';

type Scalar = string | number | boolean;

export type FlowStep = {
  action: Action;
  /** The file's line, 1-based; 0 for a step not read from a file. */
  line: number;
  /** The file it was written in, when another flow runs it: see `composeFlow`. */
  file?: string;
  selector?: FlowSelector;
  args: Record<string, Scalar>;
  flags: Flag[];
};

export type Flow = {
  app?: string;
  /** What `appdyno test --tag` selects it by. */
  tags: string[];
  params: string[];
  secrets: string[];
  steps: FlowStep[];
};

/** A file that cannot be read as a flow, at its line. */
export class FlowError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(line ? `line ${line}: ${message}` : message);
  }
}

type Spec = {
  /** Words in order; `?` at the end of a name: may be left out. */
  words?: string[];
  /** Selectors, and x, y where `point` too: a target. `needed`: a step that has no meaning without one. */
  target?: 'optional' | 'needed' | 'point' | 'point-needed';
  text?: string[];
  number?: string[];
  bool?: string[];
};

const SPECS = {
  launch: { words: ['app?'] },
  stop: { words: ['app?'] },
  tap: { target: 'point-needed' },
  long_press: { target: 'point-needed', number: ['durationMs'] },
  double_tap: { target: 'point-needed' },
  type: {
    words: ['text'],
    target: 'point',
    bool: ['replace', 'submit'],
  },
  press_key: { words: ['key'], number: ['count'] },
  swipe: { words: ['direction'], target: 'point', number: ['distance', 'durationMs'] },
  scroll_to: { target: 'needed', text: ['direction'], number: ['maxSwipes'] },
  wait_for: { target: 'needed', bool: ['gone'], number: ['timeoutMs'] },
  assert: {
    target: 'needed',
    text: ['check', 'equals'],
    bool: ['expect'],
    number: ['timeoutMs'],
  },
  open_link: { words: ['url'] },
  set_location: { words: ['lat', 'lon'] },
  alert: { words: ['answer'] },
  hide_keyboard: {},
  /** An action the format has no step for: replay stops here rather than go on without it. */
  unrecorded: { words: ['what'] },
  /** Another flow's steps go here: `composeFlow` replaces it before anything runs. */
  run: { words: ['file'] },
} as const satisfies Record<string, Spec>;

export type Action = keyof typeof SPECS;

const NUMERIC_WORDS = new Set(['lat', 'lon']);
const SELECTOR_KEYS = ['id', 'role', 'text'] as const;
const FLAGS: readonly string[] = ['ambiguous', 'coordinates'] satisfies Flag[];
const NAME = /^[A-Z_][A-Z0-9_]*$/;
const WORD = /^[\w.:/@+-]+$/;
/** A placeholder, or the escape of one. */
const PLACEHOLDER = /\$\$\{|\$\{([^}]*)\}/g;

const specOf = (action: string): Spec | undefined =>
  Object.hasOwn(SPECS, action) ? SPECS[action as Action] : undefined;

/** A line's tokens: a word, or `key=value`, with a value in JSON's quotes if it needs them. */
function tokens(text: string, line: number): { key?: string; value: string; quoted: boolean }[] {
  const out: { key?: string; value: string; quoted: boolean }[] = [];
  let i = 0;
  const quoted = () => {
    let end = i + 1;
    while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
    if (end >= text.length) throw new FlowError('a quote is not closed', line);
    const raw = text.slice(i, end + 1);
    i = end + 1;
    try {
      return JSON.parse(raw) as string;
    } catch {
      throw new FlowError(`not a quoted string: ${raw}`, line);
    }
  };
  const word = () => {
    const start = i;
    while (i < text.length && !/[\s=]/.test(text[i]!)) i++;
    return text.slice(start, i);
  };
  while (i < text.length) {
    if (/\s/.test(text[i]!)) {
      i++;
      continue;
    }
    if (text[i] === '#') break;
    if (text[i] === '"') {
      out.push({ value: quoted(), quoted: true });
      continue;
    }
    const first = word();
    if (text[i] !== '=') {
      out.push({ value: first, quoted: false });
      continue;
    }
    i++;
    if (text[i] === '"') out.push({ key: first, value: quoted(), quoted: true });
    else {
      const start = i;
      while (i < text.length && !/\s/.test(text[i]!)) i++;
      out.push({ key: first, value: text.slice(start, i), quoted: false });
    }
  }
  return out;
}

const numberOf = (value: string, what: string, line: number) => {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n)) throw new FlowError(`${what} needs a number`, line);
  return n;
};

function parseStep(action: string, rest: ReturnType<typeof tokens>, line: number): FlowStep {
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
  return step;
}

/** The names a string's placeholders use. */
const namesIn = (value: string, line: number) =>
  [...value.matchAll(PLACEHOLDER)].flatMap((m) => {
    if (m[0] === '$${') return [];
    if (!NAME.test(m[1]!)) throw new FlowError(`no such placeholder: ${m[0]}`, line);
    return [m[1]!];
  });

const stringsOf = (st: FlowStep) => [
  ...Object.values(st.args).filter((v) => typeof v === 'string'),
  ...SELECTOR_KEYS.flatMap((k) => st.selector?.[k] ?? []),
];

/** The names a step needs a value for. */
export const namesOf = (st: FlowStep) => stringsOf(st).flatMap((v) => namesIn(v, st.line));

export function parseFlow(text: string): Flow {
  const flow: Flow = { tags: [], params: [], secrets: [], steps: [] };
  const lines = text.split(/\r?\n/);
  let appLine = 0;
  for (const [i, raw] of lines.entries()) {
    const line = i + 1;
    const toks = tokens(raw, line);
    if (toks.length === 0) continue;
    const head = toks[0]!;
    if (head.quoted || head.key !== undefined)
      throw new FlowError(`a line starts with a step: ${raw.trim()}`, line);
    const word = head.value;
    if (word === 'tag') {
      if (flow.steps.length > 0) throw new FlowError('tag comes before the steps', line);
      const tags = toks.slice(1);
      if (tags.length === 0 || tags.some((t) => t.key !== undefined || !WORD.test(t.value)))
        throw new FlowError('tag takes words: tag smoke login', line);
      flow.tags.push(...tags.map((t) => t.value));
      continue;
    }
    if (word === 'app' || word === 'param' || word === 'secret') {
      if (flow.steps.length > 0) throw new FlowError(`${word} comes before the steps`, line);
      const value = toks[1];
      if (!value || toks.length !== 2 || value.key !== undefined)
        throw new FlowError(`${word} takes one word`, line);
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
    flow.steps.push(parseStep(word, toks.slice(1), line));
  }
  const declared = new Set([...flow.params, ...flow.secrets]);
  const undeclared = (name: string, line: number) => {
    if (!declared.has(name))
      throw new FlowError(`\${${name}} is not declared: add param ${name} or secret ${name}`, line);
  };
  if (flow.app) for (const n of namesIn(flow.app, appLine)) undeclared(n, appLine);
  for (const st of flow.steps) for (const n of namesOf(st)) undeclared(n, st.line);
  if (flow.steps.length === 0) throw new FlowError('a flow has at least one step', 0);
  return flow;
}

const show = (value: string) => (WORD.test(value) ? value : JSON.stringify(value));
/** A text always in quotes where a word might read as something else. */
const quote = (value: string) => JSON.stringify(value);

/** One step as its line. */
export function stepLine(st: FlowStep): string {
  const spec: Spec = SPECS[st.action];
  const words = (spec.words ?? []).flatMap((w): (string | number | boolean)[] => {
    const name = w.replace('?', '');
    const v = st.args[name];
    if (v === undefined) return [];
    return typeof v === 'string' ? [name === 'key' || name === 'direction' ? v : quote(v)] : [v];
  });
  const named = new Set((spec.words ?? []).map((w) => w.replace('?', '')));
  const s = st.selector;
  const selector = [
    ...(s?.id !== undefined ? [`id=${show(s.id)}`] : []),
    ...(s?.role !== undefined ? [`role=${show(s.role)}`] : []),
    ...(s?.text !== undefined ? [`text=${quote(s.text)}`] : []),
    ...(s?.index !== undefined ? [`index=${s.index}`] : []),
  ];
  const rest = Object.entries(st.args)
    .filter(([k]) => !named.has(k))
    .map(([k, v]) => {
      if (typeof v === 'boolean') return v ? k : `${k}=false`;
      return typeof v === 'number' ? `${k}=${v}` : `${k}=${show(v)}`;
    });
  return [st.action, ...words, ...selector, ...rest, ...st.flags.map((f) => `!${f}`)].join(' ');
}

/** A flow as its file; `parseFlow` reads it back. */
export const flowText = (flow: Flow) =>
  [
    ...(flow.app ? [`app ${show(flow.app)}`] : []),
    ...(flow.tags.length > 0 ? [`tag ${flow.tags.join(' ')}`] : []),
    ...flow.params.map((p) => `param ${p}`),
    ...flow.secrets.map((p) => `secret ${p}`),
    ...(flow.app || flow.tags.length || flow.params.length || flow.secrets.length ? [''] : []),
    ...flow.steps.map(stepLine),
    '',
  ].join('\n');

/** A literal as a flow's string: only what would read as a placeholder changes. */
export const escapeLiteral = (s: string) => s.replace(/\$\{/g, '$$$${');

const fill = (value: string, values: Record<string, string>) =>
  value.replace(PLACEHOLDER, (m, name: string | undefined) =>
    m === '$${' ? '${' : (values[name!] ?? m),
  );

/** A step with its placeholders filled. */
export function fillStep(st: FlowStep, values: Record<string, string>): FlowStep {
  const args = Object.fromEntries(
    Object.entries(st.args).map(([k, v]) => [k, typeof v === 'string' ? fill(v, values) : v]),
  );
  const s = st.selector;
  return {
    ...st,
    args,
    ...(s && {
      selector: {
        ...(s.id !== undefined && { id: fill(s.id, values) }),
        ...(s.role !== undefined && { role: fill(s.role, values) }),
        ...(s.text !== undefined && { text: fill(s.text, values) }),
        ...(s.index !== undefined && { index: s.index }),
      },
    }),
  };
}

/** The app's id with its placeholders filled. */
export const fillApp = (app: string, values: Record<string, string>) => fill(app, values);

/**
 * Values for the names of a flow's steps from `--param`, then the environment. A missing one is refused
 * before anything runs, by name: a value in the message would be stored by whatever keeps the log.
 */
export function valuesFor(
  flow: Flow,
  params: Record<string, string>,
  env: Record<string, string | undefined>,
  from = 1,
): Record<string, string> {
  const needed = new Set([
    ...flow.steps.slice(from - 1).flatMap(namesOf),
    ...(flow.app ? namesIn(flow.app, 0) : []),
  ]);
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of needed) {
    const v = params[name] ?? env[name];
    if (v === undefined) missing.push(name);
    else values[name] = v;
  }
  if (missing.length > 0)
    throw new FlowError(
      `no value for ${missing.join(', ')}: give --param ${missing[0]}=... or set it in the environment`,
      0,
    );
  return values;
}
