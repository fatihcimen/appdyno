import { inCall } from '@appdyno/core';
import { NODE_FLAGS as F, type ActParams, type Tree } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { holdsText, typeByKeys, typesByKeys } from '../src/sim-keys.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';

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

/**
 * A field that takes the focus when touched and types what its keys say; `drops`: the key numbers it loses; `layout`:
 * the letters of keys another layout than US gives them; `dash`: where a field that formats puts a dash once the text is
 * longer, and takes it away with the character after it.
 */
function field(
  opts: {
    focused?: boolean;
    text?: string;
    secure?: boolean;
    drops?: number[];
    layout?: Record<string, string>;
    dash?: number;
  } = {},
) {
  const dash = opts.dash ?? Infinity;
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
      else if (a.kind === 'key' && a.key === 'delete') {
        text = text.slice(0, -1);
        // the dash goes with the last character after it
        if (text.length === dash + 1) text = text.slice(0, dash);
      } else if (a.kind === 'key' && a.key !== 'enter' && !opts.drops?.includes(keys++))
        text += a.modifiers?.includes('shift')
          ? a.key.toUpperCase()
          : (opts.layout?.[a.key] ?? a.key);
      if (text.length > dash && text[dash] !== '-')
        text = `${text.slice(0, dash)}-${text.slice(dash)}`;
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

  it(
    'types again, slower, what a field that formats lost, once it knows all it must hold',
    fakeTimed(async () => {
      const f = field({ drops: [4] });
      const r = await typeByKeys('5999999900', { at: AT }, f.keyboard);
      expect(r).toMatchObject({ verified: true });
      expect(f.text()).toBe('5999999900');
    }),
  );

  it(
    'takes back what keys added to a field that held text, for the runner to type after it',
    fakeTimed(async () => {
      const f = field({ focused: true, text: 'x', drops: [1] });
      expect(await typeByKeys('abc', { at: AT }, f.keyboard)).toBe('append');
      expect(f.text()).toBe('x');
      // as a Turkish Q layout types quick: what the field held stays, never cleared
      const tr = field({ focused: true, text: 'Hello ', layout: { i: 'ı' } });
      expect(await typeByKeys('quick', { at: AT }, tr.keyboard)).toBe('append');
      expect(tr.text()).toBe('Hello ');
      expect(tr.sent.filter((a) => a.kind === 'key' && a.modifiers?.includes('command'))).toEqual(
        [],
      );
      // a field that formats takes its dash with the last character after it: no delete more than it takes
      const gsm = field({ focused: true, text: '(599) 999', layout: { '1': '!' }, dash: 9 });
      expect(await typeByKeys('12', { at: AT }, gsm.keyboard)).toBe('append');
      expect(gsm.text()).toBe('(599) 999');
    }),
    15_000,
  );

  it('replaces by selecting all and deleting it first', async () => {
    const f = field({ focused: true, text: 'old' });
    const r = await typeByKeys('hunter2', { at: AT, replace: true }, f.keyboard);
    expect(r).toMatchObject({ verified: true });
    expect(f.text()).toBe('hunter2');
  });

  it('leaves a secure field to the runner, touching nothing, as its dots cannot be read back', async () => {
    const f = field({ focused: true, text: 'old', secure: true });
    expect(await typeByKeys('hunter2', { at: AT, replace: true }, f.keyboard)).toBeUndefined();
    expect(f.sent).toEqual([]);
  });

  it(
    'clears for the runner what keys of a layout that is not US typed twice, as a Turkish Q one types quick',
    fakeTimed(async () => {
      const f = field({ layout: { i: 'ı', '-': '*' } });
      expect(await typeByKeys('quick-i', { at: AT }, f.keyboard)).toBe('retype');
      expect(f.text()).toBe('');
      expect(f.sent.filter((a) => a.kind === 'key' && a.key === 'enter')).toEqual([]);
    }),
    10_000,
  );

  it('types no key more once its call is stopped, as for its app having died', async () => {
    const stop = new AbortController();
    const f = field({ focused: true });
    const send = f.keyboard.send;
    f.keyboard.send = (a) => {
      if (f.sent.length === 2) stop.abort();
      return send(a);
    };
    const typing = () => typeByKeys('abcdef', { at: AT }, f.keyboard);
    await expect(inCall({ signal: stop.signal }, typing)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    expect(f.text()).toBe('abc');
  });

  it(
    'takes back no long text, and presses no Enter after a read-back that says the text is wrong, saying so',
    fakeTimed(async () => {
      // as a Turkish Q layout types a sentence after what the field held: 300 deletes would hold the device for 30 s
      const f = field({ focused: true, text: 'Done. ', layout: { i: 'ı' } });
      const sentence = 'this is a sentence of more than forty letters';
      const r = await typeByKeys(sentence, { at: AT, submit: true }, f.keyboard);
      expect(r).toMatchObject({ mode: 'keys', verified: false, submitted: false });
      const keys = (key: string) => f.sent.filter((a) => a.kind === 'key' && a.key === key);
      expect([keys('delete'), keys('enter')]).toEqual([[], []]);
    }),
  );

  it(
    'stops taking back once its call is stopped',
    fakeTimed(async () => {
      const stop = new AbortController();
      const f = field({ focused: true, text: 'x', layout: { a: 'q' } });
      const send = f.keyboard.send;
      f.keyboard.send = (a) => {
        if (a.kind === 'key' && a.key === 'delete') stop.abort();
        return send(a);
      };
      const typing = () => typeByKeys('aaaa', { at: AT }, f.keyboard);
      await expect(inCall({ signal: stop.signal }, typing)).rejects.toMatchObject({
        code: 'CANCELLED',
      });
      expect(f.sent.filter((a) => a.kind === 'key' && a.key === 'delete')).toHaveLength(1);
    }),
  );

  it('presses no Enter, and clears nothing, for a call stopped meanwhile', async () => {
    const stop = new AbortController();
    const f = field({ focused: true });
    const read = f.keyboard.read;
    // the app dies once the last key is typed, while the field is read back
    f.keyboard.read = () => (f.text() === 'abc' && stop.abort(), read());
    const typing = () => typeByKeys('abc', { at: AT, submit: true }, f.keyboard);
    await expect(inCall({ signal: stop.signal }, typing)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    expect(f.sent.filter((a) => a.kind === 'key' && a.key === 'enter')).toEqual([]);
    const old = field({ focused: true, text: 'old' });
    const replacing = () => typeByKeys('new', { at: AT, replace: true }, old.keyboard);
    const stopped = new AbortController();
    stopped.abort();
    await expect(inCall({ signal: stopped.signal }, replacing)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    expect(old.sent).toEqual([]);
  });

  it('leaves to the runner a point with no field, or no field with the focus', async () => {
    expect(await typeByKeys('a', { at: { x: 300, y: 600 } }, field().keyboard)).toBeUndefined();
    expect(await typeByKeys('a', {}, field().keyboard)).toBeUndefined();
  });
});
