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
  withStableRefs,
  type UiElement,
} from '../src/screen/index.js';
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
