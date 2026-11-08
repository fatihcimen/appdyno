import type { Screen, ScreenElement } from '@appdyno/core';
import { selectIn } from '@appdyno/core';
import { assert, describe, expect, it } from 'vitest';
import {
  bestSelector,
  elementAt,
  parseFlow,
  Recording,
  type FlowStep,
  type RecordingState,
} from '../src/index.js';

const el = (
  ref: string,
  role: string,
  label: string,
  id?: string,
  rect = { x: 0, y: 0, width: 100, height: 40 },
): ScreenElement => ({
  ref,
  role,
  label,
  ...(id && { id }),
  name: id ?? label,
  nameKind: id ? 'id' : 'label',
  rect,
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
  flags: [],
});

const on = (list: ScreenElement[], raw: Record<string, Record<string, unknown>> = {}) =>
  ({
    list,
    elements: list.map((e) => ({ type: e.role, ref: e.ref, ...raw[e.ref] })),
  }) as unknown as Pick<Screen, 'list' | 'elements'>;

describe('the selector a target is recorded with', () => {
  it('takes an id that alone finds it', () => {
    const e = el('@a', 'button', 'Send', 'submit');
    expect(bestSelector(on([e, el('@b', 'button', 'Send')]), e)).toEqual({
      selector: { id: 'submit' },
    });
  });

  it('takes role and text when there is no id, or the id is on several', () => {
    const e = el('@a', 'button', 'Send');
    expect(bestSelector(on([e, el('@b', 'text', 'Sent')]), e)).toEqual({
      selector: { role: 'button', text: 'Send' },
    });
    const twin = el('@a', 'button', 'Keep', 'dup');
    expect(bestSelector(on([twin, el('@b', 'button', 'Drop', 'dup')]), twin)).toEqual({
      selector: { role: 'button', text: 'Keep' },
    });
  });

  it('tells a title from a button by role', () => {
    const b = el('@b', 'button', 'Login');
    const screen = on([el('@t', 'text', 'Login'), b]);
    const { selector } = bestSelector(screen, b);
    expect(selector).toEqual({ role: 'button', text: 'Login' });
    expect(selectIn(screen.list, selector)).toEqual([b]);
  });

  it('takes the text alone where the role is no name another platform shares', () => {
    const e = el('@a', 'tappable', 'Row');
    expect(bestSelector(on([e]), e)).toEqual({ selector: { text: 'Row' } });
  });

  it('records an index and how many it chose from when nothing alone finds it', () => {
    const list = [
      el('@a', 'button', 'Add', 'add_button'),
      el('@b', 'button', 'Add', 'add_button'),
      el('@c', 'button', 'Add', 'add_button'),
    ];
    const [, , third] = list;
    assert(third);
    const c = bestSelector(on(list), third);
    expect(c).toEqual({ selector: { id: 'add_button', index: 2 }, ambiguous: 3 });
    assert(c.selector.index !== undefined);
    expect(selectIn(list, c.selector)[c.selector.index]).toBe(third);
  });

  it('judges a label as replay will: a part of a longer one does not count as another match', () => {
    const add = el('@a', 'button', 'Add');
    expect(bestSelector(on([add, el('@b', 'button', 'Add to basket')]), add)).toEqual({
      selector: { role: 'button', text: 'Add' },
    });
  });

  it("skips Android's own ids, which name no thing in the app", () => {
    const ok = el('@a', 'button', 'OK', 'button1');
    const screen = on([ok], { '@a': { identifier: 'android:id/button1' } });
    expect(bestSelector(screen, ok)).toEqual({ selector: { role: 'button', text: 'OK' } });
  });

  it('never names a field by what it holds, which changes as it is typed in', () => {
    const f = el('@a', 'textField', 'typed value');
    const screen = on([f, el('@b', 'textField', 'Other')], { '@a': { text: 'typed value' } });
    expect(bestSelector(screen, f)).toEqual({
      selector: { role: 'textField', index: 0 },
      ambiguous: 2,
    });
  });

  it('names an empty field by its placeholder', () => {
    const f = el('@a', 'textField', 'Your name');
    expect(bestSelector(on([f]), f).selector).toEqual({ role: 'textField', text: 'Your name' });
  });
});

describe('the element under a point', () => {
  const size = { w: 1000, h: 2000 };
  const button = el('@b', 'button', 'Send', undefined, { x: 100, y: 100, width: 200, height: 50 });
  const card = el('@c', 'tappable', 'Card', undefined, { x: 0, y: 0, width: 500, height: 200 });

  it('is the smallest that holds it', () => {
    expect(elementAt([card, button], { x: 150, y: 120 }, size)).toBe(button);
  });

  it('is none on an empty place, a slider, or a large area where the point itself counts', () => {
    expect(elementAt([button], { x: 900, y: 900 }, size)).toBeUndefined();
    const slider = el('@s', 'slider', 'Volume', undefined, { x: 0, y: 0, width: 500, height: 50 });
    expect(elementAt([slider], { x: 400, y: 20 }, size)).toBeUndefined();
    const pad = el('@p', 'tappable', 'Pad', undefined, { x: 0, y: 0, width: 1000, height: 1000 });
    expect(elementAt([pad], { x: 400, y: 400 }, size)).toBeUndefined();
  });
});

describe('secrets in a recording', () => {
  const state = (): RecordingState => ({ serial: 's', running: true, steps: [], known: [] });
  const type = (text: string): FlowStep => ({ action: 'type', line: 0, args: { text }, flags: [] });

  it('turns a password into a named parameter, and every echo of it after', () => {
    const r = new Recording({ ...state(), app: 'dev.app' });
    r.learnSecret('hunter2', 'password_input');
    r.add(type('hunter2'));
    r.add({
      action: 'assert',
      line: 0,
      selector: { text: 'Hello hunter2!' },
      args: { check: 'text', equals: 'xhunter2y' },
      flags: [],
    });
    const text = r.text();
    expect(text).not.toContain('hunter2');
    expect(text).toContain('secret PASSWORD_INPUT');
    expect(text).toContain('type "${PASSWORD_INPUT}"');
    expect(text).toContain('text="Hello ${PASSWORD_INPUT}!"');
    expect(text).toContain('equals="x${PASSWORD_INPUT}y"');
    expect(parseFlow(text).secrets).toEqual(['PASSWORD_INPUT']);
  });

  it('keeps no value where it is kept between commands, only a digest', () => {
    const r = new Recording(state());
    r.learnSecret('hunter2', 'pass');
    r.add(type('hunter2'));
    expect(JSON.stringify(r.state)).not.toContain('hunter2');
    // the next command is another process: it still knows the echo
    const next = new Recording(JSON.parse(JSON.stringify(r.state)) as RecordingState);
    expect(next.scrub('Hi hunter2')).toBe('Hi ${PASS}');
  });

  it('turns what APPDYNO_SECRETS lists into SECRET_n, in any field', () => {
    const r = new Recording(state(), ['gizli-kod', 'other']);
    r.add(type('prefix gizli-kod and other'));
    const text = r.text();
    expect(text).not.toContain('gizli-kod');
    expect(text).toContain('type "prefix ${SECRET_1} and ${SECRET_2}"');
    expect(parseFlow(text).secrets).toEqual(['SECRET_1', 'SECRET_2']);
    expect(JSON.stringify(r.state)).not.toContain('gizli-kod');
  });

  it('gives two passwords of a field two names, and one password one', () => {
    const r = new Recording(state());
    r.learnSecret('one', 'pin');
    r.learnSecret('one', 'pin');
    r.learnSecret('two', 'pin');
    r.learnSecret('three', undefined);
    expect(r.state.known.map((k) => k.name)).toEqual(['PIN', 'PIN_2', 'PASSWORD']);
  });

  it("takes the first app named as the flow's, and keeps another on its step", () => {
    const r = new Recording(state());
    const launch = (app: string): FlowStep => ({
      action: 'launch',
      line: 0,
      args: { app },
      flags: [],
    });
    r.add(launch('dev.one'));
    r.add(launch('dev.two'));
    r.add(launch('dev.one'));
    expect(r.text()).toBe('app dev.one\n\nlaunch\nlaunch "dev.two"\nlaunch\n');
  });

  it('leaves a literal ${ typed by the agent a literal', () => {
    const r = new Recording(state());
    r.add(type('a ${B} c'));
    const f = parseFlow(r.text());
    expect(f.secrets).toEqual([]);
    expect(f.steps[0]?.args.text).toBe('a $${B} c');
  });
});
