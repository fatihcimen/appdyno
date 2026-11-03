import { describe, expect, it } from 'vitest';
import {
  diffText,
  insideRows,
  renderFolded,
  renderScreen,
  type ScreenElement,
} from '../src/index.js';

const element = (
  ref: string,
  role: string,
  label: string,
  y: number,
  o: Partial<ScreenElement> = {},
): ScreenElement => ({
  ref,
  role,
  label,
  name: label,
  nameKind: 'label',
  rect: { x: 0, y: y - 20, width: 400, height: 40 },
  x: 200,
  y,
  flags: [],
  ...o,
});
const row = (ref: string, label: string, y: number) =>
  element(ref, 'cell', label, y, { flags: ['clickable'] });
const inner = (rect: { y: number }) => ({ rect: { x: 40, y: rect.y, width: 100, height: 20 } });

describe('what repeats in an answer', () => {
  it('leaves out a plain element a row already says, and counts it', () => {
    const list = [
      row('@a', 'General Manage it', 100),
      element('@b', 'text', 'General', 90, inner({ y: 85 })),
      element('@c', 'text', 'Title', 300),
    ];
    expect([...insideRows(list)].map((e) => e.ref)).toEqual(['@b']);
    expect(renderFolded(list).split('\n')).toEqual([
      '3 elements: ref role "label" x,y flags; 1 inside rows, by find',
      '@a cell "General Manage it" 200,100 clickable',
      '@c text "Title" 200,300',
    ]);
  });

  it('keeps what a row does not say or what acts or shows a state by itself', () => {
    const y = inner({ y: 85 });
    const kept = [
      element('@part', 'text', 'On', 90, y),
      element('@elsewhere', 'text', 'Online', 500),
      element('@button', 'button', 'Online', 90, y),
      element('@tick', 'image', 'Online', 90, { ...y, flags: ['checked'] }),
      element('@link', 'text', 'Online', 90, { ...y, flags: ['clickable'] }),
    ];
    expect(insideRows([row('@a', 'Online status', 100), ...kept]).size).toBe(0);
  });

  it('leaves out a control of the row’s name at its place, not one elsewhere in it or with a state', () => {
    const at = { rect: { x: 0, y: 80, width: 400, height: 40 } };
    const list = [
      row('@a', 'General', 100),
      element('@same', 'button', 'General', 100, { ...at, flags: ['clickable'] }),
      element('@twice', 'button', 'General General', 100, { ...at, flags: ['clickable'] }),
      element('@elsewhere', 'button', 'General', 100, {
        rect: { x: 300, y: 80, width: 40, height: 40 },
        x: 320,
        flags: ['clickable'],
      }),
      element('@other', 'button', 'More', 100, { ...at, flags: ['clickable'] }),
      element('@on', 'switch', 'General', 100, { ...at, flags: ['clickable', 'checked'] }),
    ];
    expect([...insideRows(list)].map((e) => e.ref)).toEqual(['@same', '@twice']);
  });

  it('keeps the first of two alike at the same place', () => {
    const twice = [
      element('@one', 'button', 'Dictate', 100, { flags: ['clickable'] }),
      element('@two', 'button', 'Dictate', 100, { flags: ['clickable'] }),
    ];
    expect([...insideRows(twice)].map((e) => e.ref)).toEqual(['@two']);
  });

  it('knows a long text cut short in the row and in what it holds', () => {
    const list = [
      row('@a', 'Apple Account, Sign in to access your iCloud data, the App …', 100),
      element(
        '@b',
        'text',
        'Sign in to access your iCloud data, the App Store, Apple se…',
        90,
        inner({ y: 85 }),
      ),
      element(
        '@c',
        'text',
        'Sign in to something else entirely that is also rather lon…',
        90,
        inner({ y: 85 }),
      ),
    ];
    expect([...insideRows(list)].map((e) => e.ref)).toEqual(['@b']);
  });

  it('leaves out what is inside a text field and its own name says', () => {
    const list = [
      element('@f', 'textField', 'Search', 100),
      element('@i', 'image', 'Search', 90, inner({ y: 85 })),
    ];
    expect([...insideRows(list)].map((e) => e.ref)).toEqual(['@i']);
  });

  it('says a context only for what it tells apart, and only so far', () => {
    const lines = renderFolded([
      element('@a', 'text', 'General', 40, { refContext: 'Settings' }),
      element('@b', 'button', '', 60, { id: 'x', refContext: 'Search' }),
      element('@c', 'button', 'Add', 80, { refContext: 'Milk' }),
      element('@d', 'button', 'Add', 90, { refContext: `${'long '.repeat(20)}end` }),
    ]).split('\n');
    expect(lines[1]).toBe('@a text "General" 200,40');
    expect(lines[2]).toBe('@b button "" id=x 200,60 — Search');
    expect(lines[3]).toBe('@c button "Add" 200,80 — Milk');
    expect(lines[4]).toBe(`@d button "Add" 200,90 — ${'long '.repeat(8).slice(0, 39)}…`);
  });

  it('hides a secret in a context before cutting it, and leaves a context whole outside an answer', () => {
    const secret = 'x'.repeat(50);
    const list = [
      element('@c', 'button', 'Add', 80, { refContext: `the ${secret} one` }),
      element('@d', 'button', 'Add', 90, { refContext: 'Milk' }),
    ];
    const text = renderFolded(list, (s) => s.replace(secret, '•••'));
    expect(text).toContain('— the ••• one');
    expect(text).not.toContain('xxx');
    expect(renderScreen(list)).toContain(`— the ${secret} one`);
    expect(diffText({ added: [list[0]!], removed: [], changed: [] }, 9)).toContain(
      `— the ${secret} one`,
    );
  });

  it('puts rows under one header when their context is the same and so tells nothing', () => {
    const lines = renderFolded(
      [418, 471, 559].map((y, i) =>
        element(`@c${i}`, 'button', 'chevron', y, { refContext: 'Manage it' }),
      ),
    ).split('\n');
    expect(lines.slice(1)).toEqual([
      'button x=200: ref "label" y',
      '@c0 "chevron" 418',
      '@c1 "chevron" 471',
      '@c2 "chevron" 559',
    ]);
  });

  it('says a label given twice over once', () => {
    const lines = renderFolded([row('@a', 'General General', 100)]).split('\n');
    expect(lines[1]).toBe('@a cell "General" 200,100 clickable');
  });

  it('puts three or more rows alike under one header, each with its ref, label and place', () => {
    const list = [
      element('@t', 'text', 'Settings', 40),
      row('@a', 'One One', 100),
      row('@b', 'Two "2"', 152),
      row('@c', 'Three', 204),
      row('@far', 'Four', 256),
    ];
    list[4]!.x = 300;
    expect(renderFolded(list).split('\n').slice(1)).toEqual([
      '@t text "Settings" 200,40',
      'cell x=200 clickable: ref "label" y',
      '@a "One" 100',
      '@b "Two \\"2\\"" 152',
      '@c "Three" 204',
      '@far cell "Four" 300,256 clickable',
    ]);
  });

  it('leaves two rows as they are, and what only its context tells apart', () => {
    const plain = renderFolded([row('@a', 'One', 100), row('@b', 'Two', 152)]);
    expect(plain).not.toContain('x=200');
    const told = [
      row('@a', 'Add', 100),
      { ...row('@b', 'Add', 152), refContext: 'Milk' },
      { ...row('@c', 'Add', 204), refContext: 'Eggs' },
    ];
    expect(renderFolded(told)).toContain('@b cell "Add" 200,152 clickable — Milk');
    expect(renderFolded([element('@i', 'button', '', 100, { id: 'close' })])).toContain('id=close');
  });

  it('hides a secret in folded rows too', () => {
    const list = [row('@a', 's3cret', 100), row('@b', 'Two', 152), row('@c', 'Three', 204)];
    const text = renderFolded(list, (s) => s.replace('s3cret', '•••'));
    expect(text).toContain('@a "•••" 100');
    expect(text).not.toContain('s3cret');
  });
});
