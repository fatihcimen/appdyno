import { NODE_FLAGS as F, type ActParams, type Tree } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { holdsText, typeByKeys, typesByKeys } from '../src/sim-keys.js';

/** A form with one text field at 0..200 x 100..140, holding `text`, with the focus or not, and the keyboard up or not. */
const box = (...b: [number, number, number, number]) => b;
const form = (text: string, focused: boolean, secure = false): Tree => ({
  windows: [],
  nodes: [
    { p: -1, w: 0, c: 'Application', b: box(0, 0, 400, 800), f: F.visible },
    {
      p: 0,
      w: 0,
      c: secure ? 'SecureTextField' : 'TextField',
      ...(text && { t: text }),
      b: box(0, 100, 200, 140),
      f: F.visible | F.editable | (focused ? F.focused : 0) | (secure ? F.password : 0),
    },
    ...(focused ? [{ p: 0, w: 0, c: 'Keyboard', b: box(0, 500, 400, 800), f: F.visible }] : []),
  ],
  truncated: false,
  elapsedMs: 1,
  hash: 'h',
});

/** A field that takes the focus when touched and types what its keys say; `drops`: the key numbers it loses. */
function field(
  opts: { focused?: boolean; text?: string; secure?: boolean; drops?: number[] } = {},
) {
  let focused = opts.focused ?? false;
  let text = opts.text ?? '';
  let keys = 0;
  const sent: ActParams[] = [];
  const keyboard = {
    read: () =>
      Promise.resolve(form(opts.secure ? '•'.repeat(text.length) : text, focused, opts.secure)),
    send: (a: ActParams) => {
      sent.push(a);
      if (a.kind === 'tap') focused = true;
      if (a.kind === 'key' && a.modifiers?.includes('command')) text = '';
      else if (a.kind === 'key' && a.key === 'delete') text = text.slice(0, -1);
      else if (a.kind === 'key' && a.key !== 'enter' && !opts.drops?.includes(keys++))
        text += a.modifiers?.includes('shift') ? a.key.toUpperCase() : a.key;
      return Promise.resolve(true);
    },
    keyboardOpen: (t: Tree) => t.nodes.some((n) => n.c === 'Keyboard'),
  };
  return { keyboard, sent, text: () => text };
}

const AT = { x: 100, y: 120 };

describe("typing by a simulator's keys", () => {
  it('is for what a US keyboard has', () => {
    expect(typesByKeys('Ada Lovelace 5551234567 !?')).toBe(true);
    expect(typesByKeys('Kapı zili')).toBe(false);
  });

  it('reads a field back by the runner’s rule, a formatting one by its letters and digits', () => {
    expect(holdsText('(599) 999-9900', '', '5999999900', false)).toBe(true);
    expect(holdsText('(599) 999-900', '', '5999999900', false)).toBe(false);
    expect(holdsText('Ada', 'Ada', 'Ada', true)).toBe(true);
    expect(holdsText('AdaAda', 'Ada', 'Ada', true)).toBe(false);
  });

  it('touches the field, waits for its focus, and types each key, a capital with shift held', async () => {
    const f = field();
    const r = await typeByKeys('Ada', { at: AT }, f.keyboard);
    expect(r).toMatchObject({ mode: 'keys', verified: true });
    expect(f.text()).toBe('Ada');
    expect(f.sent[0]).toEqual({ kind: 'tap', ...AT });
    expect(f.sent[1]).toEqual({ kind: 'key', key: 'A', modifiers: ['shift'] });
  });

  it('types again, slower, what a field that formats lost, once it knows all it must hold', async () => {
    const f = field({ drops: [4] });
    const r = await typeByKeys('5999999900', { at: AT }, f.keyboard);
    expect(r?.verified).toBe(true);
    expect(f.text()).toBe('5999999900');
  });

  it('says a field holds other text where it held some before, and does not type it again', async () => {
    const f = field({ focused: true, text: 'x', drops: [1] });
    const r = await typeByKeys('abc', { at: AT }, f.keyboard);
    expect(r?.verified).toBe(false);
    expect(f.text()).toBe('xac');
  }, 5_000);

  it('replaces by selecting all and deleting it first, and gives no verdict on a secure field', async () => {
    const f = field({ focused: true, text: 'old', secure: true });
    const r = await typeByKeys('hunter2', { at: AT, replace: true }, f.keyboard);
    expect(r).not.toHaveProperty('verified');
    expect(f.text()).toBe('hunter2');
  });

  it('leaves to the runner a point with no field, or no field with the focus', async () => {
    expect(await typeByKeys('a', { at: { x: 300, y: 600 } }, field().keyboard)).toBeUndefined();
    expect(await typeByKeys('a', {}, field().keyboard)).toBeUndefined();
  });
});
