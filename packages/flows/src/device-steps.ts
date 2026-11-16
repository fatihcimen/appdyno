import type { FlowStep } from './format.js';
import { mockRule } from './mock.js';
import { FlowError, quote, show, tokens } from './tokens.js';

/** As the `visual` tool takes a name: no folder in it, so a picture stays in the folder it is kept in. */
const PICTURE_NAME = /^[\w.-]{1,100}$/;
const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
// a mask may start off the screen's edge
const PLACE = String.raw`(-?\d+(?:\.\d+)?)`;
const RECT = new RegExp(`^${PLACE},${PLACE},${NUMBER},${NUMBER}$`);
const MASK_KEYS = ['id', 'role', 'text'] as const;

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
  const mask: Mask = {};
  for (const t of tokens(value, line)) {
    const key = MASK_KEYS.find((k) => k === t.key);
    if (!key) throw wrong();
    mask[key] = t.value;
  }
  if (Object.keys(mask).length === 0) throw wrong();
  return mask;
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

/** What a `screenshot`, `visual` or `setting` line needs beyond its words, refused as its line's error. */
export function checkDeviceStep(st: FlowStep, line: number) {
  const a = st.args;
  if (st.action === 'mock') mockRule(st, line);
  if (
    st.action === 'network' &&
    (a.name !== 'strict' || !['on', 'off', undefined].includes(a.value as string | undefined))
  )
    throw new FlowError('network: strict, strict on or strict off', line);
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
