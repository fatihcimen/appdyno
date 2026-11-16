import type { FlowStep } from './format.js';
import { mockRule } from './mock.js';
import { FlowError, quote, show, tokens } from './tokens.js';

/** As the `visual` tool takes a name: no folder in it, so a picture stays in the folder it is kept in. */
const PICTURE_NAME = /^[\w.-]{1,100}$/;
const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
// a mask may start off the screen's edge
const PLACE = String.raw`(-?\d+(?:\.\d+)?)`;
const RECT = new RegExp(`^${PLACE},${PLACE},${NUMBER},${NUMBER}$`);
/** A status a request is asked for by: one, a class of them, or a failure on its way. */
export const STATUS = /^(\d{3}|\dxx|failed)$/;
const MASK_KEYS = ['id', 'role', 'text'] as const;

const POINT = new RegExp(`^${NUMBER},${NUMBER}$`);

/** Where a `drag` step lets go: a point `x,y` in tap units, or an element by selector words, as `id=bin`. */
export function dropOf(value: string, line = 0): { x: number; y: number } | { selector: Mask } {
  const [x, y] = POINT.exec(value)?.slice(1).map(Number) ?? [];
  if (x !== undefined && y !== undefined) return { x, y };
  const wrong = new FlowError(`to is x,y or id=, role=, text=: ${value}`, line);
  return { selector: wordsOf(value, line, wrong) };
}

/** What a `visual` step leaves out of its comparison, as the `visual` tool takes it. */
export type Mask = {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  id?: string;
  role?: string;
  text?: string;
};

/** A mask's words in a flow: `x,y,w,h` in tap units, or selector words, `id=clock` or `role=image text="Map"`. */
export function maskOf(value: string, line = 0): Mask {
  const wrong = () => new FlowError(`a mask is x,y,w,h or id=, role=, text=: ${value}`, line);
  const rect = RECT.exec(value)?.slice(1).map(Number);
  if (rect) {
    const [x, y, w, h] = rect;
    if (!w || !h) throw new FlowError(`a mask has a width and a height: ${value}`, line);
    return { x, y, w, h };
  }
  return wordsOf(value, line, wrong());
}

/** Selector words in one value, `id=clock` or `role=image text="Map"`: what names an element inside a step's argument. */
function wordsOf(value: string, line: number, wrong: FlowError) {
  const words: Mask = {};
  for (const t of tokens(value, line)) {
    const key = MASK_KEYS.find((k) => k === t.key);
    if (!key) throw wrong;
    words[key] = t.value;
  }
  if (Object.keys(words).length === 0) throw wrong;
  return words;
}

/** A mask as a flow writes it, which `maskOf` reads back. */
export function maskText(m: Mask): string {
  const words = [
    ...(m.id !== undefined ? [`id=${show(m.id)}`] : []),
    ...(m.role !== undefined ? [`role=${show(m.role)}`] : []),
    ...(m.text !== undefined ? [`text=${quote(m.text)}`] : []),
  ];
  return words.length > 0 ? words.join(' ') : [m.x, m.y, m.w, m.h].map(Number).join(',');
}

/** The settings a line names with no value, each a one-shot that takes none, or none it needs. */
export const VALUELESS_SETTINGS: readonly string[] = ['shake', 'memory_warning'];

/** A `mock` line is a rule, or with no request what rules are made of and what becomes of a request none takes. */
function checkMock(st: FlowStep, line: number) {
  const { from, unmatched, ...rule } = st.args;
  if (st.args.request !== undefined) return void mockRule(st, line);
  if (from === undefined && unmatched === undefined)
    throw new FlowError('mock needs request', line);
  if (Object.keys(rule).length > 0)
    throw new FlowError('mock: with no request, only from= and unmatched=', line);
  if (unmatched !== undefined && unmatched !== 'pass' && unmatched !== 'fail')
    throw new FlowError(`mock: unmatched is pass or fail: ${String(unmatched)}`, line);
}

/** The longest a check waits, as the tools' own. */
const MAX_WAIT_MS = 15_000;

const whole = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** What the checks a run makes itself need: a count, what the clipboard holds, an audit's threshold. */
function checkOwnStep(st: FlowStep, line: number) {
  const a = st.args;
  const no = (why: string) => new FlowError(`${st.action}: ${why}`, line);
  const ranged = a.min !== undefined || a.max !== undefined;
  if (st.action === 'assert' && a.check !== 'count') {
    if (ranged) throw no('min and max are for check=count');
    return;
  }
  if (a.timeoutMs !== undefined && !(whole(a.timeoutMs) && Number(a.timeoutMs) <= MAX_WAIT_MS))
    throw no(`timeoutMs is 0 to ${MAX_WAIT_MS}`);
  if (st.action === 'assert') {
    if (st.selector?.index !== undefined) throw no('check=count counts every match: no index');
    if (a.expect !== undefined) throw no('check=count takes no expect: give the count');
    if ((a.equals !== undefined) === ranged)
      throw no('check=count takes equals=3, or min= and max=, one or the other');
    // a name is filled when the flow runs
    if (a.equals !== undefined && !/^\d+$|\$\{/.test(String(a.equals)))
      throw no(`equals is a count: ${String(a.equals)}`);
    if ([a.min, a.max].some((v) => v !== undefined && !whole(v)))
      throw no('min and max are whole numbers');
  }
  if (st.action === 'clipboard') {
    const given = [a.text, a.equals, a.contains].filter((v) => v !== undefined).length;
    if (given !== 1)
      throw no('a text to put there, or equals= or contains= to check what it holds, one of them');
    if (a.text !== undefined && a.timeoutMs !== undefined) throw no('timeoutMs is for a check');
  }
  if (st.action === 'audit' && a.max !== undefined && !whole(a.max))
    throw no('max is a whole number of issues');
}

/** What a `screenshot`, `visual` or `setting` line needs beyond its words, refused as its line's error. */
export function checkDeviceStep(st: FlowStep, line: number) {
  const a = st.args;
  if (st.action === 'assert' || st.action === 'clipboard' || st.action === 'audit')
    checkOwnStep(st, line);
  if (st.action === 'mock') checkMock(st, line);
  if (
    st.action === 'network' &&
    (a.name !== 'strict' || !['on', 'off', undefined].includes(a.value as string | undefined))
  )
    throw new FlowError('network: strict, strict on or strict off', line);
  if (st.action === 'request' && a.status !== undefined && !STATUS.test(String(a.status)))
    throw new FlowError(`request: status is 404, 4xx or failed: ${String(a.status)}`, line);
  if (st.action === 'drag') {
    if (a.to === undefined)
      throw new FlowError('drag needs to: a point x,y or an element, as to="id=bin"', line);
    // a name is filled when the flow runs
    const drop = String(a.to).includes('${') ? undefined : dropOf(String(a.to), line);
    if (drop && 'x' in drop && !st.flags.includes('coordinates'))
      throw new FlowError('drag: a point to let go at is flagged !coordinates', line);
  }
  for (const name of st.action === 'prepare' ? ((a.gives as string[] | undefined) ?? []) : [])
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name))
      throw new FlowError(`prepare: gives names are like MY_NAME: ${name}`, line);
  if ((st.action === 'screenshot' || st.action === 'visual') && !PICTURE_NAME.test(String(a.name)))
    throw new FlowError(
      `${st.action}: a name is letters, digits, dot, dash and underscore: ${String(a.name)}`,
      line,
    );
  if (st.action === 'visual') {
    if (typeof a.tolerance === 'number' && !(a.tolerance >= 0 && a.tolerance <= 100))
      throw new FlowError('visual: tolerance is a percent of the pixels, 0 to 100', line);
    for (const m of (a.mask as string[] | undefined) ?? []) maskOf(m, line);
  }
  if (st.action !== 'setting') return;
  if (a.name === 'restore' && Object.keys(a).length > 1)
    throw new FlowError(
      'setting restore puts back every setting changed: it takes nothing more',
      line,
    );
  if (a.name !== 'restore' && a.value === undefined && !VALUELESS_SETTINGS.includes(String(a.name)))
    throw new FlowError(
      `setting ${String(a.name)} needs a value, as in setting dark_mode on`,
      line,
    );
}
