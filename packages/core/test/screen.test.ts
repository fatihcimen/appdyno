import { describe, expect, it } from 'vitest';
import {
  alertButton,
  buildScreen,
  diffScreens,
  diffText,
  elementLine,
  elementsOf,
  fold,
  refHash,
  screenElements,
  withStableRefs,
  type UiElement,
} from '../src/screen/index.js';
import { wireTree } from './fake-agent.js';

const ios = { platform: 'ios' as const, appId: 'com.example.app' };
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
    expect(twins[1]).toBe(`${twins[0]}-2`);
  });

  it('two identities with the same short form both take the long form, whatever their order', () => {
    const short = new Map<string, string>();
    let pair: [string, string] | undefined;
    for (let n = 0; !pair; n++) {
      const label = `x${n}`;
      const h = refHash(`button"${label}"`).slice(-4);
      if (short.has(h)) pair = [short.get(h)!, label];
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
    const android = { platform: 'android' as const };
    const read = (els: UiElement[]) => screenElements(withStableRefs(els, android), android);
    const a = read([win, ...card('Süt', 200, 1), ...card('Yumurta', 400, 4)]);
    const b = read([win, ...card('Yumurta', 200, 1), ...card('Ekmek', 400, 4)]);
    const ekle = (l: typeof a, ctx: string) =>
      l.find((e) => e.label === 'Ekle' && e.refContext === ctx)!.ref;
    expect(ekle(a, 'Yumurta')).toBe(ekle(b, 'Yumurta'));
    expect(ekle(a, 'Süt')).not.toBe(ekle(a, 'Yumurta'));
    expect(elementLine(a.find((e) => e.refContext === 'Süt')!)).toMatch(/ — Süt$/);
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
        `+ ${elementLine(d.added[0]!)}`,
        `- ${d.removed[0]!.ref} "C"`,
        `~ ${elementLine(d.changed[0]!.now)} (was "B")`,
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
  it('drops the keyboard, overlays and the system bars, keeps system dialogs', () => {
    const tree = wireTree([{ t: 'Uygulama', b: [0, 100, 500, 200] }]);
    tree.windows.push(
      {
        type: 2,
        pkg: 'com.google.android.inputmethod.latin',
        layer: 5,
        b: [0, 1600, 1080, 2400],
        active: false,
        focused: false,
      },
      {
        type: 3,
        pkg: 'com.android.systemui',
        layer: 6,
        b: [0, 0, 1080, 80],
        active: false,
        focused: false,
      },
      {
        type: 1,
        pkg: 'com.google.android.permissioncontroller',
        layer: 7,
        b: [0, 800, 1080, 1600],
        active: true,
        focused: true,
      },
    );
    tree.nodes.push(
      { p: -1, w: 1, c: 'android.widget.FrameLayout', t: 'klavye', b: [0, 1600, 1080, 2400], f: 1 },
      { p: -1, w: 2, c: 'android.widget.TextView', t: '12:00', b: [0, 0, 100, 80], f: 1 },
      { p: -1, w: 3, c: 'android.widget.FrameLayout', b: [0, 800, 1080, 1600], f: 1 },
      {
        p: 4,
        w: 3,
        c: 'android.widget.Button',
        id: 'com.google.android.permissioncontroller:id/permission_allow_button',
        t: 'İzin ver',
        b: [100, 1000, 900, 1100],
        f: 1 | 2 | 16,
      },
    );
    const els = elementsOf(tree);
    expect(els.map((e) => e.text).filter(Boolean)).toEqual(['Uygulama', 'İzin ver']);
    expect(els.at(-1)!.parent).toBe(2);
    expect(alertButton(els, 'android', 'allow')).toEqual({ label: 'İzin ver', x: 500, y: 1050 });
    const s = buildScreen(tree, { platform: 'android', appId: 'dev.app' });
    expect(s.foreground).toBe('com.google.android.permissioncontroller');
    expect(s.list.map((e) => e.label)).toContain('İzin ver');
  });

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
    const s = buildScreen(tree, { platform: 'android' });
    expect(s.list).toHaveLength(1);
    expect(s.list[0]).toMatchObject({
      role: 'textField',
      label: 'Telefon',
      id: 'phone',
      flags: ['focused'],
    });
    expect(s.window).toEqual({ w: 1080, h: 2400 });
  });

  it('knows the screen in landscape, the app window beside a navigation bar on the left', () => {
    const tree = wireTree([], {
      windows: [
        { type: 1, pkg: 'dev.app', layer: 1, b: [128, 0, 2400, 1080], active: true, focused: true },
      ],
    });
    tree.nodes[0]!.b = [128, 0, 2400, 1080];
    expect(buildScreen(tree, { platform: 'android' }).window).toEqual({ w: 2400, h: 1080 });
  });

  it('takes no dialog for the screen', () => {
    const tree = wireTree([]);
    tree.nodes[0]!.b = [54, 900, 1026, 1500];
    expect(buildScreen(tree, { platform: 'android' }).window).toBeUndefined();
  });

  it('leaves out an element mostly off the screen (a pager page)', () => {
    const tree = wireTree([
      { t: 'görünen', b: [0, 100, 500, 200] },
      { t: 'diğer sayfa', b: [2000, 100, 2500, 200] },
    ]);
    expect(buildScreen(tree, { platform: 'android' }).list.map((e) => e.label)).toEqual([
      'görünen',
    ]);
  });
});

describe('system alerts', () => {
  /** An app screen with its own "Tamam" button and a system Alert (the home screen app's) over it. */
  const promptOver = (buttons: string[], alertPkg = 'com.apple.springboard'): UiElement[] => [
    { ...root, pkg: 'com.example.app' },
    {
      type: 'Button',
      label: 'Tamam',
      ref: '@e2',
      parent: 0,
      pkg: 'com.example.app',
      rect: { x: 0, y: 0, width: 50, height: 50 },
    },
    {
      type: 'Alert',
      label: 'Konum',
      ref: '@e3',
      pkg: alertPkg,
      rect: { x: 50, y: 300, width: 300, height: 200 },
    },
    ...buttons.map((label, i): UiElement => ({
      type: 'Button',
      label,
      ref: `@b${i}`,
      parent: 2,
      pkg: alertPkg,
      rect: { x: 50, y: 400 + i * 50, width: 300, height: 44 },
    })),
  ];

  it('answers an iOS system alert by the words the caller gives (Turkish here)', () => {
    // words are matched on the folded label (fold: no accents, dotless ı as i)
    const tr = {
      allow: /^(izin ver|uygulamayi kullanirken izin ver|bir kez izin ver)$/,
      deny: /^izin verme$/,
    };
    const els = promptOver(['Uygulamayı Kullanırken İzin Ver', 'İzin Verme']);
    expect(alertButton(els, 'ios', 'allow', tr)).toEqual({
      label: 'Uygulamayı Kullanırken İzin Ver',
      x: 200,
      y: 422,
    });
    expect(alertButton(els, 'ios', 'deny', tr)?.label).toBe('İzin Verme');
    expect(alertButton(els.slice(0, 2), 'ios', 'allow')).toBeUndefined();
  });

  it('answers an iOS system alert in English by default and by place in any language', () => {
    expect(alertButton(promptOver(['Don’t Allow', 'Allow']), 'ios', 'allow')?.label).toBe('Allow');
    // two buttons (notifications, tracking): deny first, allow last
    const two = promptOver(['Nicht erlauben', 'Erlauben']);
    expect(alertButton(two, 'ios', 'allow')?.label).toBe('Erlauben');
    expect(alertButton(two, 'ios', 'deny')?.label).toBe('Nicht erlauben');
    // three (location, photos): once, while using, don't
    const three = promptOver([
      'Einmal erlauben',
      'Beim Verwenden der App erlauben',
      'Nicht erlauben',
    ]);
    expect(alertButton(three, 'ios', 'allow')?.label).toBe('Beim Verwenden der App erlauben');
    expect(alertButton(three, 'ios', 'deny')?.label).toBe('Nicht erlauben');
  });

  it("never answers an app's own alert on iOS", () => {
    expect(
      alertButton(promptOver(['Don’t Allow', 'Allow'], 'com.example.app'), 'ios', 'allow'),
    ).toBeUndefined();
  });

  it('on Android only the permission controller, never a dialog button of the app or the system', () => {
    const win: UiElement = {
      type: 'android.widget.FrameLayout',
      ref: '@e1',
      rect: { x: 0, y: 0, width: 1080, height: 2400 },
    };
    const btn = (identifier: string, text: string): UiElement => ({
      type: 'android.widget.Button',
      ref: '@e2',
      text,
      identifier,
      parent: 0,
      rect: { x: 0, y: 1000, width: 200, height: 100 },
    });
    expect(
      alertButton([win, btn('android:id/button1', 'TAMAM')], 'android', 'allow'),
    ).toBeUndefined();
    expect(
      alertButton([win, btn('com.example:id/button1', 'İzin ver')], 'android', 'allow'),
    ).toBeUndefined();
    expect(
      alertButton(
        [win, btn('com.android.permissioncontroller:id/permission_deny_button', 'İzin verme')],
        'android',
        'deny',
      ),
    ).toMatchObject({ label: 'İzin verme' });
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
