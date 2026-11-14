import { describe, expect, it } from 'vitest';
import { must } from '../src/must.js';
import {
  buildScreen,
  diffScreens,
  diffText,
  elementLine,
  fold,
  personNeeded,
  refHash,
  screenElements,
  selectIn,
  withStableRefs,
  type UiElement,
} from '../src/screen/index.js';
import type { WireNode } from '@appdyno/protocol';
import { wireTree } from '@appdyno/testing/fake-agent.js';
import { plainScreen } from './plain-screen.js';

const ios = { port: plainScreen, appId: 'com.example.app' };
const button = (label: string, y: number, ref: string, identifier?: string): UiElement => ({
  type: 'Button',
  label,
  ref,
  parent: 0,
  ...(identifier && { identifier }),
  rect: { x: 10, y, width: 200, height: 44 },
});
const root: UiElement = {
  type: 'Window',
  ref: '@e1',
  rect: { x: 0, y: 0, width: 402, height: 874 },
};
const refs = (els: UiElement[]) =>
  Object.fromEntries(screenElements(withStableRefs(els, ios), ios).map((e) => [e.label, e.ref]));

describe('stable refs', () => {
  it('name the same element after a re-read that numbered it differently', () => {
    const a = refs([root, button('Kampanyalar', 100, '@e2'), button('Sepete ekle', 160, '@e3')]);
    const b = refs([
      root,
      button('Yeni', 40, '@e2'),
      button('Kampanyalar', 100, '@e3'),
      button('Sepete ekle', 160, '@e4'),
    ]);
    expect(a['Sepete ekle']).toMatch(/^@[a-z0-9]{4}$/);
    expect(b['Sepete ekle']).toBe(a['Sepete ekle']);
    expect(b.Kampanyalar).toBe(a.Kampanyalar);
  });

  it('keep an element with a unique id when its text changes; identical ones get an ordinal', () => {
    const before = refs([root, button('₺39,90', 100, '@e2', 'basket_total')]);
    const after = refs([root, button('₺45,90', 100, '@e2', 'basket_total')]);
    expect(after['₺45,90']).toBe(before['₺39,90']);
    const twins = screenElements(
      withStableRefs([root, button('Ekle', 100, '@e2'), button('Ekle', 160, '@e3')], ios),
      ios,
    ).map((e) => e.ref);
    expect(twins[1]).toBe(`${String(twins[0])}-2`);
  });

  it('keep a field with no id while its placeholder comes and its text is typed, by what is around it', () => {
    const bar: UiElement = {
      ...root,
      type: 'Other',
      ref: '@e2',
      parent: 0,
      rect: { x: 0, y: 100, width: 402, height: 50 },
    };
    const field = (words: Partial<UiElement>): UiElement[] => [
      root,
      bar,
      {
        type: 'Button',
        label: 'search purple',
        ref: '@e3',
        parent: 1,
        rect: { x: 0, y: 100, width: 50, height: 50 },
      },
      {
        type: 'TextField',
        ref: '@e4',
        parent: 1,
        editable: true,
        rect: { x: 60, y: 100, width: 300, height: 50 },
        ...words,
      },
    ];
    const refOf = (words: Partial<UiElement>) =>
      screenElements(withStableRefs(field(words), ios), ios).find((e) => e.role === 'textField')
        ?.ref;
    const empty = refOf({});
    expect(empty).toMatch(/^@[a-z0-9]{4}$/);
    expect(refOf({ placeholder: 'Search in locals' })).toBe(empty);
    expect(refOf({ label: 'kahve', placeholder: 'Search in locals' })).toBe(empty);
  });

  it('two identities with the same short form both take the long form, whatever their order', () => {
    const short = new Map<string, string>();
    let pair: [string, string] | undefined;
    for (let n = 0; !pair; n++) {
      const label = `x${n}`;
      const h = refHash(`button"${label}"`).slice(-4);
      const before = short.get(h);
      if (before !== undefined) pair = [before, label];
      else short.set(h, label);
    }
    const of = (labels: string[]) =>
      refs([root, ...labels.map((l, i) => button(l, 100 + i * 60, `@e${i + 2}`))]);
    const ab = of(pair);
    expect(ab[pair[0]]).toMatch(/^@[a-z0-9]{7}$/);
    expect(ab[pair[1]]).toMatch(/^@[a-z0-9]{7}$/);
    expect(ab[pair[0]]).not.toBe(ab[pair[1]]);
    expect(of([pair[1], pair[0]])).toEqual(ab);
  });

  it('give identical buttons in cards the card name, kept across a scroll', () => {
    const card = (name: string, y: number, base: number): UiElement[] => [
      {
        type: 'android.widget.LinearLayout',
        ref: `n${base}`,
        parent: 0,
        rect: { x: 0, y, width: 1080, height: 120 },
      },
      {
        type: 'android.widget.TextView',
        text: name,
        ref: `n${base + 1}`,
        parent: base,
        rect: { x: 20, y, width: 500, height: 100 },
      },
      {
        type: 'android.widget.Button',
        text: 'Ekle',
        ref: `n${base + 2}`,
        parent: base,
        clickable: true,
        rect: { x: 800, y, width: 200, height: 100 },
      },
    ];
    const win: UiElement = {
      type: 'android.widget.FrameLayout',
      ref: 'n0',
      rect: { x: 0, y: 0, width: 1080, height: 2400 },
    };
    const android = { port: plainScreen };
    const read = (els: UiElement[]) => screenElements(withStableRefs(els, android), android);
    const a = read([win, ...card('Süt', 200, 1), ...card('Yumurta', 400, 4)]);
    const b = read([win, ...card('Yumurta', 200, 1), ...card('Ekmek', 400, 4)]);
    const ekle = (l: typeof a, ctx: string) =>
      must(
        l.find((e) => e.label === 'Ekle' && e.refContext === ctx),
        ctx,
      ).ref;
    expect(ekle(a, 'Yumurta')).toBe(ekle(b, 'Yumurta'));
    expect(ekle(a, 'Süt')).not.toBe(ekle(a, 'Yumurta'));
    expect(
      elementLine(
        must(
          a.find((e) => e.refContext === 'Süt'),
          'Süt',
        ),
      ),
    ).toMatch(/ — Süt$/);
  });
});

describe('screen diff', () => {
  const list = (els: UiElement[]) => screenElements(withStableRefs([root, ...els], ios), ios);
  it('lists added, removed and changed elements by ref', () => {
    const prev = list([
      button('A', 100, '@e2'),
      button('B', 160, '@e3', 'total'),
      button('C', 220, '@e4'),
    ]);
    const next = list([
      button('A', 100, '@e2'),
      button('B2', 160, '@e3', 'total'),
      button('D', 280, '@e4'),
    ]);
    const d = diffScreens(prev, next);
    expect(d.added.map((e) => e.label)).toEqual(['D']);
    expect(d.removed.map((e) => e.label)).toEqual(['C']);
    expect(d.changed.map((c) => [c.was.label, c.now.label])).toEqual([['B', 'B2']]);
    expect(diffText(d, next.length)).toBe(
      [
        'screen changed: +1 -1 ~1 (3 elements; ref role "label" x,y flags)',
        `+ ${elementLine(must(d.added[0], 'an added'))}`,
        `- ${must(d.removed[0], 'a removed').ref} "C"`,
        `~ ${elementLine(must(d.changed[0], 'a changed').now)} (was "B")`,
      ].join('\n'),
    );
    expect(diffText(diffScreens(next, next), 3)).toBe('screen unchanged (3 elements)');
  });

  it('gives up on a diff as long as the screen (another screen)', () => {
    const prev = list([button('A', 100, '@e2'), button('B', 160, '@e3')]);
    const next = list([
      button('X', 100, '@e2'),
      button('Y', 160, '@e3'),
      button('Z', 220, '@e4'),
      button('W', 280, '@e5'),
    ]);
    expect(diffText(diffScreens(prev, next), next.length)).toBeUndefined();
  });
});

describe('wire tree to screen', () => {
  it('names an empty field by its placeholder and keeps flags', () => {
    const tree = wireTree([
      {
        c: 'android.widget.EditText',
        h: 'Telefon',
        id: 'dev.app:id/phone',
        b: [0, 100, 1000, 200],
        f: 1 | 4 | 8 | 16 | 128,
      },
    ]);
    const s = buildScreen(tree, { port: plainScreen });
    expect(s.list).toHaveLength(1);
    expect(s.list[0]).toMatchObject({
      role: 'textField',
      label: 'Telefon',
      id: 'phone',
      flags: ['focused'],
    });
    expect(s.window).toEqual({ w: 1080, h: 2400 });
  });

  it('says a web element has the focus only where it is a field, as XCUI says every one of a page has it', () => {
    const tree = wireTree([
      { c: 'WebView', b: [0, 100, 1080, 2000] },
      { p: 1, c: 'Link', d: 'Bosphorus', b: [0, 200, 300, 260], f: 1 | 2 | 8 | 16 },
      { p: 1, c: 'TextField', h: 'Search', b: [0, 300, 1000, 380], f: 1 | 8 | 16 | 128 },
    ]);
    const flags = buildScreen(tree, { port: plainScreen }).list.map((e) => [e.label, e.flags]);
    expect(flags).toEqual([
      ['Bosphorus', ['clickable', 'web']],
      ['Search', ['focused', 'web']],
    ]);
  });

  it('lists a named control once, not the nameless icon inside it at the same point', () => {
    const tree = wireTree([
      {
        c: 'android.widget.FrameLayout',
        d: 'More options',
        b: [960, 840, 1074, 950],
        f: 1 | 2 | 16,
      },
      { p: 1, c: 'android.widget.ImageButton', b: [980, 860, 1054, 930], f: 1 | 16 },
      // a field inside a named row stays, nameless as it is
      { c: 'android.widget.LinearLayout', d: 'Name', b: [0, 300, 1080, 400], f: 1 | 2 | 16 },
      { p: 3, c: 'android.widget.EditText', b: [0, 300, 1080, 400], f: 1 | 4 | 16 | 128 },
    ]);
    const list = buildScreen(tree, { port: plainScreen }).list.map((e) => `${e.role} "${e.label}"`);
    expect(list).toContain('tappable "More options"');
    expect(list.filter((l) => l.endsWith('""')).map((l) => l.split(' ')[0])).toEqual(['textField']);
  });

  it('gives a ref to a nameless control inside a named one, which the list leaves out', () => {
    const tree = wireTree([
      { c: 'android.view.View', b: [60, 640, 880, 790], f: 1 | 2 | 16 },
      { p: 1, c: 'android.widget.TextView', t: 'Headlines', b: [260, 690, 700, 740] },
      { p: 1, c: 'android.view.View', b: [740, 650, 860, 780], f: 1 | 2 | 16 },
      { p: 3, c: 'android.view.View', d: 'Headlines', b: [760, 680, 830, 750] },
      { p: 3, c: 'android.widget.CheckBox', b: [750, 665, 850, 765], f: 1 | 16 },
    ]);
    const s = buildScreen(tree, { port: plainScreen });
    const box = s.elements.find((e) => e.type === 'android.widget.CheckBox');
    expect(box?.ref).toMatch(/^@[a-z0-9]{4}/);
    expect(s.list.map((e) => e.ref)).not.toContain(box?.ref);
  });

  it('says each name a row holds once, where it joins them', () => {
    const tree = wireTree([
      { c: 'android.view.View', b: [60, 640, 880, 790], f: 1 | 2 | 16 },
      { p: 1, c: 'android.widget.TextView', t: 'Headlines', b: [260, 690, 700, 740] },
      { p: 1, c: 'android.view.View', d: 'Headlines', b: [760, 680, 830, 750] },
      { c: 'android.widget.LinearLayout', b: [0, 250, 1080, 380], f: 1 | 2 | 16 },
      { p: 4, c: 'android.widget.ImageView', d: 'Search Wikipedia', b: [40, 280, 110, 350] },
      { p: 4, c: 'android.widget.TextView', t: 'Search Wikipedia', b: [130, 280, 800, 350] },
      { p: 4, c: 'android.widget.ImageView', d: 'Voice input search', b: [940, 280, 1010, 350] },
      // what the app itself names twice stays as it says it, and so do words apart
      { c: 'android.widget.Button', d: 'More More', b: [0, 1000, 1080, 1100], f: 1 | 2 | 16 },
      { c: 'android.widget.LinearLayout', b: [0, 1200, 1080, 1300], f: 1 | 2 | 16 },
      ...['Wins', '1', 'Losses', '1'].map((t, n) => ({
        p: 9,
        t,
        b: [n * 200, 1220, n * 200 + 150, 1280] as [number, number, number, number],
      })),
      // a value is no name: equal ones side by side, as a score, are each a value of their own
      ...['3', 'A', '€5'].flatMap((t, r) => {
        const at = 14 + r * 3;
        const y = 1400 + r * 200;
        return [
          { c: 'android.widget.LinearLayout', b: [0, y, 1080, y + 100], f: 1 | 2 | 16 },
          { p: at, t, b: [0, y + 20, 150, y + 80] },
          { p: at, t, b: [200, y + 20, 350, y + 80] },
        ] as Partial<WireNode>[];
      }),
    ]);
    const labels = buildScreen(tree, { port: plainScreen }).list.map((e) => e.label);
    expect(labels).toContain('Search Wikipedia Voice input search');
    expect(labels).toContain('More More');
    expect(labels).toContain('Wins 1 Losses 1');
    expect(labels).toContain('3 3');
    expect(labels).toContain('A A');
    expect(labels).toContain('€5 €5');
    expect(labels.filter((l) => l.includes('Headlines Headlines'))).toEqual([]);
  });

  it('matches a selector past the cut of a long label, and the cut label a flow kept', () => {
    const words =
      'The area around Petra has been inhabited from as early as 7000 BC, and the Nabataeans might have settled in what would become the capital city of their kingdom';
    const tree = wireTree([{ c: 'android.view.View', d: words, b: [0, 300, 1080, 600] }]);
    const { list } = buildScreen(tree, { port: plainScreen });
    const label = must(list[0], 'the paragraph').label;
    expect(label).toMatch(/…$/);
    expect(label.length).toBeLessThan(words.length);
    for (const text of ['Nabataeans', 'capital city', '7000 BC', label, words])
      expect(selectIn(list, { text }).map((e) => e.label)).toEqual([label]);
  });

  it('takes no dialog for the screen', () => {
    const tree = wireTree([]);
    must(tree.nodes[0], 'the root').b = [54, 900, 1026, 1500];
    expect(buildScreen(tree, { port: plainScreen }).window).toBeUndefined();
  });

  it('leaves out an element mostly off the screen (a pager page)', () => {
    const tree = wireTree([
      { t: 'görünen', b: [0, 100, 500, 200] },
      { t: 'diğer sayfa', b: [2000, 100, 2500, 200] },
    ]);
    expect(buildScreen(tree, { port: plainScreen }).list.map((e) => e.label)).toEqual(['görünen']);
  });
});

describe('fold', () => {
  it('matches text without a locale: case, accents, dotted and dotless i', () => {
    expect(fold('INFO')).toBe('info');
    expect(fold('İstanbul')).toBe('istanbul');
    expect(fold('ıslak')).toBe('islak');
    expect(fold('Gönder')).toBe('gonder');
  });
});

describe('what an alert wants of a person', () => {
  const alert = (...texts: string[]) => ({ texts, buttons: [] });

  it('names Face ID, a passcode and the rest, in either language it knows', () => {
    expect(personNeeded(alert('Do you want to use Face ID?'))).toBe('Face ID');
    expect(personNeeded(alert('Enter your passcode'))).toBe('a passcode');
    expect(personNeeded(alert('Parolanızı girin'))).toBe('a passcode');
    expect(personNeeded(alert('Sign in with your Apple Account'))).toBe('an Apple Account');
    expect(personNeeded({ texts: [], buttons: [{ label: 'Allow Paste', x: 0, y: 0 }] })).toBe(
      'Allow Paste',
    );
    expect(personNeeded(alert('Confirm your purchase'))).toBe('a purchase');
  });

  it('says nothing of an alert an agent can answer, or of none', () => {
    expect(personNeeded(alert('Allow "Maps" to use your location?'))).toBeUndefined();
    expect(personNeeded(undefined)).toBeUndefined();
  });
});

describe('rows not laid out yet', () => {
  /** A shop's card: its texts, as a list holds rows it has not placed yet, all at one spot near the top. */
  const card = (shop: number, at: (n: number) => UiElement['rect']): UiElement[] => [
    { type: 'Cell', ref: `@c${shop}`, parent: 0, rect: at(0) },
    ...['Kahve Seti', '540,00 TL', '2li'].map((label, n): UiElement => ({
      type: 'StaticText',
      label: `${label} ${shop}`,
      ref: `@t${shop}-${n}`,
      parent: 1 + shop * 4,
      rect: at(n + 1),
    })),
  ];
  const piled = (n: number) => ({ x: 9 + n, y: 200, width: 80, height: 15 });
  const placed = (shop: number) => (n: number) => ({
    x: 16,
    y: 300 + shop * 100 + n * 20,
    width: 300,
    height: 18,
  });

  it('are left out, where many unrelated elements share one point, and rows in their places stay', () => {
    const els = [root, ...card(0, placed(0)), ...[1, 2, 3, 4].flatMap((s) => card(s, piled))];
    const labels = screenElements(els, ios).map((e) => e.label);
    expect(labels).toContain('Kahve Seti 0');
    expect(labels.filter((l) => /[1-4]$/.test(l))).toEqual([]);
  });

  it('are not a row and what it holds, at one point', () => {
    const els = [root, ...card(0, piled)];
    expect(screenElements(els, ios).map((e) => e.label)).toContain('Kahve Seti 0');
  });
});

describe('what a navigation bar at the top covers', () => {
  const full = { x: 0, y: 0, width: 402, height: 874 };
  const under = (label: string, parent: number, y = 70): UiElement => ({
    ...button(label, y, `@${label.replace(/\W/g, '')}`),
    parent,
  });
  // the window; the navigation screen, with its bar, the bar's Back and its list; a sheet over it, another's
  const els: UiElement[] = [
    root,
    { type: 'Other', ref: '@nav', parent: 0, rect: full },
    {
      type: 'NavigationBar',
      ref: '@bar',
      parent: 1,
      rect: { x: 0, y: 62, width: 402, height: 54 },
    },
    { ...under('Back', 2), rect: { x: 16, y: 66, width: 44, height: 44 } },
    under('Row under the bar', 1),
    under('Row below the bar', 1, 130),
    { type: 'Other', ref: '@sheet', parent: 0, rect: { ...full, y: 59, height: 815 } },
    under('Close the sheet', 6),
  ];
  const withBar = { ...ios, port: { ...plainScreen, topBars: () => [2] } };

  it("leaves out what of the bar's own screen lies under it, and keeps the bar's own and a sheet's there", () => {
    expect(screenElements(els, withBar).map((e) => e.label)).toEqual([
      'Back',
      'Row below the bar',
      'Close the sheet',
    ]);
    expect(screenElements(els, ios).map((e) => e.label)).toContain('Row under the bar');
  });
});
