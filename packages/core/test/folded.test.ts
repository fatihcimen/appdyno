import { describe, expect, it } from 'vitest';
import { must } from '../src/must.js';
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
      '3 elements: ref role "label" x,y flags; 1 inside rows, by selector',
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
    expect([...insideRows(list)].map((e) => e.ref)).toEqual(['@a', '@same', '@twice']);
  });

  it("says a toggle row once, by its toggle, as SwiftUI's four parts of one Toggle say it", () => {
    // as Settings' Display & Text Size reads on iOS 26: the cell, the toggle, its label as a button, its switch
    const at = (x: number, y: number, width: number, height: number) => ({
      rect: { x, y, width, height },
      x: Math.round(x + width / 2),
      y: Math.round(y + height / 2),
    });
    const clickable: Partial<ScreenElement> = { flags: ['clickable'] };
    const list = [
      element('@c', 'cell', 'Bold Text 0', 160, { ...at(20, 134, 362, 53), ...clickable }),
      element('@t', 'switch', 'Bold Text', 160, { ...at(36, 146, 330, 28), ...clickable }),
      element('@b', 'button', 'Bold Text', 160, { ...at(36, 150, 71, 20), ...clickable }),
      element('@s', 'switch', '0', 160, { ...at(305, 146, 63, 28), ...clickable }),
      element('@o', 'cell', 'On/Off Labels', 319, { ...at(20, 293, 362, 52), ...clickable }),
      element('@p', 'switch', 'On/Off Labels', 319, { ...at(299, 305, 63, 28), ...clickable }),
      element('@l', 'cell', 'Larger Text, Off', 213, { ...at(20, 187, 362, 53), ...clickable }),
    ];
    expect([...insideRows(list)].map((e) => e.ref).sort()).toEqual(['@b', '@c', '@o', '@s']);
  });

  it('says a row and its toggle at one place by the toggle, on or off', () => {
    // as a Flutter switch tile reads on Android: the row, then its switch, alike in words and place
    const tile = (ref: string, label: string, y: number, on: boolean) => [
      element(`${ref}-row`, 'tappable', label, y, { flags: ['clickable'] }),
      element(ref, 'switch', label, y, { flags: on ? ['clickable', 'checked'] : ['clickable'] }),
    ];
    const list = [...tile('@off', 'Greyscale', 100, false), ...tile('@on', 'Eraser', 200, true)];
    expect([...insideRows(list)].map((e) => e.ref)).toEqual(['@off-row', '@on-row']);
    expect(renderFolded(list).split('\n').slice(1)).toEqual([
      '@off switch "Greyscale" 200,100 clickable',
      '@on switch "Eraser" 200,200 clickable checked',
    ]);
  });

  it('keeps the first of two alike at the same place', () => {
    const twice = [
      element('@one', 'button', 'Dictate', 100, { flags: ['clickable'] }),
      element('@two', 'button', 'Dictate', 100, { flags: ['clickable'] }),
    ];
    expect([...insideRows(twice)].map((e) => e.ref)).toEqual(['@two']);
  });

  it('leaves out the words of a web link and of a footnote, which the link says', () => {
    const web = (o: Partial<ScreenElement>) => ({
      ...o,
      flags: ['web' as const, ...(o.flags ?? [])],
    });
    const link = { rect: { x: 100, y: 80, width: 160, height: 40 } };
    const note = { rect: { x: 300, y: 80, width: 30, height: 40 }, x: 315 };
    const mark = (x: number) => web({ rect: { x, y: 80, width: 10, height: 40 }, x: x + 5 });
    const list = [
      element('@link', 'tappable', 'Constantinople', 100, web({ ...link, flags: ['clickable'] })),
      element('@note', 'tappable', '[b]', 100, web({ ...note, flags: ['clickable'] })),
      element('@words', 'text', 'Constantinople', 100, web(link)),
      element('@open', 'text', '[', 100, mark(300)),
      element('@b', 'text', 'b', 100, mark(310)),
      element('@close', 'text', ']', 100, mark(320)),
      element('@comma', 'text', ',', 100, mark(270)),
    ];
    expect([...insideRows(list)].map((e) => e.ref)).toEqual(['@words', '@open', '@b', '@close']);
  });

  it('says an element the app gives twice at one place once', () => {
    const bar = { rect: { x: 62, y: 755, width: 278, height: 30 }, x: 201 };
    const list = [
      element('@bar', 'text', 'Horizontal scroll bar, 1 page', 770, bar),
      element('@bar-2', 'text', 'Horizontal scroll bar, 1 page', 770, bar),
      element('@other', 'text', 'Horizontal scroll bar, 1 page', 900, bar),
    ];
    expect([...insideRows(list)].map((e) => e.ref)).toEqual(['@bar-2']);
  });

  it('keeps a text said once where boxes around it carry its words at its centre', () => {
    const box = (y: number, height: number, x = 0, width = 400) => ({
      rect: { x, y, width, height },
    });
    const two = [
      element('@outer', 'text', 'Title', 100, box(60, 80)),
      element('@inner', 'text', 'Title', 100, box(90, 20, 100, 200)),
    ];
    expect(insideRows(two).size).toBe(1);
    expect(renderFolded(two)).toContain('"Title"');
    const three = [
      element('@outer', 'text', 'Title', 100, box(40, 120)),
      element('@middle', 'text', 'Title', 100, box(60, 80, 50, 300)),
      element('@inner', 'text', 'Title', 100, box(90, 20, 100, 200)),
    ];
    expect([...insideRows(three)].map((e) => e.ref)).toEqual(['@outer', '@middle']);
  });

  it('says an alert named by its title once, at the title', () => {
    const title = '“NetNewsWire” Would Like to Send You Notifications';
    const list = [
      element('@alert', 'text', title, 451, {
        rect: { x: 41, y: 344, width: 320, height: 214 },
        refContext: 'Don’t Allow',
      }),
      element('@title', 'text', title, 387, {
        rect: { x: 71, y: 366, width: 260, height: 42 },
        refContext: 'Notifications may include alerts',
      }),
      element('@body', 'text', 'Notifications may include alerts', 445, {
        rect: { x: 71, y: 416, width: 260, height: 58 },
      }),
    ];
    expect([...insideRows(list)].map((e) => e.ref)).toEqual(['@alert']);
    expect(renderFolded(list)).not.toContain(' — ');
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

  it('knows a short text whose end the row cut away', () => {
    const list = [
      row('@a', 'Show link previews Show a quick preview of articles when ta…', 100),
      element(
        '@b',
        'text',
        'Show a quick preview of articles when tapping on links.',
        90,
        inner({ y: 85 }),
      ),
      element('@c', 'text', 'Show a quick preview of something else.', 90, inner({ y: 85 })),
      element('@d', 'text', 'tapping', 90, inner({ y: 85 })),
    ];
    expect([...insideRows(list)].map((e) => e.ref)).toEqual(['@b']);
  });

  it('tells like names with no context apart by their ids, and says no id where it tells nothing', () => {
    const lines = renderFolded([
      element('@a', 'button', 'Aa', 40, { id: 'theme_light' }),
      element('@b', 'button', 'Aa', 40, { id: 'theme_dark', x: 300 }),
      element('@c', 'button', 'Save', 80, { id: 'save' }),
      element('@d', 'text', 'More', 90, { id: 'title' }),
      element('@e', 'text', 'More', 95, { id: 'title' }),
    ]).split('\n');
    expect(lines.slice(1)).toEqual([
      '@a button "Aa" 200,40 — id=theme_light',
      '@b button "Aa" 300,40 — id=theme_dark',
      '@c button "Save" 200,80',
      '@d text "More" 200,90',
      '@e text "More" 200,95',
    ]);
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
    expect(
      diffText({ added: [must(list[0], 'an element')], removed: [], changed: [] }, 9),
    ).toContain(`— the ${secret} one`);
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
    must(list[4], 'the fifth').x = 300;
    expect(renderFolded(list).split('\n').slice(1)).toEqual([
      '@t text "Settings" 200,40',
      'cell x=200 clickable: ref "label" y',
      '@a "One" 100',
      '@b "Two \\"2\\"" 152',
      '@c "Three" 204',
      '@far cell "Four" 300,256 clickable',
    ]);
  });

  it('leaves two rows as they are, and gives rows only their context tells apart a column for it', () => {
    const plain = renderFolded([row('@a', 'One', 100), row('@b', 'Two', 152)]);
    expect(plain).not.toContain('x=200');
    const told = [
      row('@a', 'Add', 100),
      { ...row('@b', 'Add', 152), refContext: 'Milk' },
      { ...row('@c', 'Add', 204), refContext: 'Eggs' },
    ];
    expect(renderFolded(told).split('\n').slice(1)).toEqual([
      'cell x=200 clickable: ref "label" y — context',
      '@a "Add" 100',
      '@b "Add" 152 — Milk',
      '@c "Add" 204 — Eggs',
    ]);
    expect(renderFolded(told.slice(1))).toContain('@b cell "Add" 200,152 clickable — Milk');
    expect(renderFolded([element('@i', 'button', '', 100, { id: 'close' })])).toContain('id=close');
  });

  it('hides a secret in folded rows too', () => {
    const list = [row('@a', 's3cret', 100), row('@b', 'Two', 152), row('@c', 'Three', 204)];
    const text = renderFolded(list, (s) => s.replace('s3cret', '•••'));
    expect(text).toContain('@a "•••" 100');
    expect(text).not.toContain('s3cret');
  });
});

describe('what only holds what is listed', () => {
  const at = (x: number, y: number, width: number, height: number) => ({
    rect: { x, y, width, height },
    x: x + width / 2,
    y: y + height / 2,
  });
  const hidden = (list: ScreenElement[]) => [...insideRows(list)].map((e) => e.ref);

  it('is left out where it has an id and no words, as a view around a button, and stays where it holds nothing', () => {
    const list = [
      element('@view', 'other', '', 0, { id: 'PlaceViewController', ...at(0, 0, 400, 800) }),
      element('@share', 'button', 'Share', 0, { flags: ['clickable'], ...at(20, 500, 50, 50) }),
      element('@chart', 'other', '', 0, { id: 'chart', ...at(0, 900, 400, 200) }),
    ];
    expect(hidden(list)).toEqual(['@view']);
    expect(renderFolded(list)).toContain('@chart other "" id=chart');
  });

  it('is left out where its words are those of the pictures it holds and no more, as a grid', () => {
    const list = [
      element('@grid', 'text', 'Photo, 10 October, Photo, 13 March', 0, at(0, 100, 400, 300)),
      element('@p1', 'image', 'Photo, 10 October', 0, at(0, 100, 130, 130)),
      element('@p2', 'image', 'Photo, 13 March', 0, at(135, 100, 130, 130)),
    ];
    expect(hidden(list)).toEqual(['@grid']);
  });

  it('stays where it says more than what it holds: a paragraph around its links', () => {
    const list = [
      element('@p', 'text', 'It stands in Istanbul near the Bosphorus', 0, at(0, 100, 400, 60)),
      element('@l1', 'link', 'Istanbul', 0, { flags: ['clickable'], ...at(90, 100, 60, 20) }),
      element('@l2', 'link', 'Bosphorus', 0, { flags: ['clickable'], ...at(250, 100, 80, 20) }),
    ];
    expect(hidden(list)).toEqual([]);
  });

  it('is left out where it is a panel that takes a touch around controls, and what it holds is then said itself', () => {
    const list = [
      element('@panel', 'tappable', 'Back Clear Languages', 0, {
        flags: ['clickable'],
        ...at(0, 0, 400, 800),
      }),
      element('@back', 'button', 'Back', 0, { flags: ['clickable'], ...at(0, 40, 50, 50) }),
      element('@clear', 'button', 'Clear', 0, { flags: ['clickable'], ...at(300, 40, 50, 50) }),
      element('@words', 'text', 'Languages', 0, at(100, 400, 200, 40)),
      // a card of two plain texts is a row, not a panel
      element('@card', 'tappable', 'Tower Istanbul', 0, {
        flags: ['clickable'],
        ...at(0, 900, 400, 100),
      }),
      element('@name', 'text', 'Tower', 0, at(20, 910, 100, 30)),
      element('@place', 'text', 'Istanbul', 0, at(20, 950, 100, 30)),
    ];
    expect(hidden(list)).toEqual(['@panel', '@name', '@place']);
  });
});
