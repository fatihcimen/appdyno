import { describe, expect, it } from 'vitest';
import { insideRows, renderFolded, type ScreenElement } from '../src/index.js';

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
