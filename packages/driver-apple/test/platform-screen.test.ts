import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { screenElements, windowRect, withStableRefs, type UiElement } from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
import { iosScreen } from '../src/platform-screen.js';

const root: UiElement = {
  type: 'Window',
  ref: '@e1',
  rect: { x: 0, y: 0, width: 402, height: 874 },
};

describe('the audit', () => {
  it('is asked of contrast only what the runner has, as a type it has not refuses all of it', () => {
    const runner = readFileSync(join(import.meta.dirname, '../../../ios/Runner/DeviceAudit.swift'));
    expect(iosScreen.contrastAudits.length).toBeGreaterThan(0);
    for (const type of iosScreen.contrastAudits) expect(String(runner)).toContain(`("${type}", .`);
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
    expect(iosScreen.alertButton(els, 'allow', tr)).toEqual({
      label: 'Uygulamayı Kullanırken İzin Ver',
      x: 200,
      y: 422,
    });
    expect(iosScreen.alertButton(els, 'deny', tr)?.label).toBe('İzin Verme');
    expect(iosScreen.alertButton(els.slice(0, 2), 'allow')).toBeUndefined();
  });

  it('answers an iOS system alert in English by default and by place in any language', () => {
    expect(iosScreen.alertButton(promptOver(['Don’t Allow', 'Allow']), 'allow')?.label).toBe(
      'Allow',
    );
    // two buttons (notifications, tracking): deny first, allow last
    const two = promptOver(['Nicht erlauben', 'Erlauben']);
    expect(iosScreen.alertButton(two, 'allow')?.label).toBe('Erlauben');
    expect(iosScreen.alertButton(two, 'deny')?.label).toBe('Nicht erlauben');
    // three (location, photos): once, while using, don't
    const three = promptOver([
      'Einmal erlauben',
      'Beim Verwenden der App erlauben',
      'Nicht erlauben',
    ]);
    expect(iosScreen.alertButton(three, 'allow')?.label).toBe('Beim Verwenden der App erlauben');
    expect(iosScreen.alertButton(three, 'deny')?.label).toBe('Nicht erlauben');
    // a location prompt's precise switch comes last, and twice: seen on an iPhone in Turkish
    const precise = promptOver([
      'Bir Kez İzin Ver',
      'Uygulamayı Kullanırken İzin Ver',
      'İzin Verme',
      'Tam Konum: Açık',
      'Tam Konum: Açık',
    ]);
    expect(iosScreen.alertButton(precise, 'deny')?.label).toBe('İzin Verme');
    expect(iosScreen.alertButton(precise, 'allow')?.label).toBe('Uygulamayı Kullanırken İzin Ver');
  });

  it("never answers an app's own alert on iOS", () => {
    expect(
      iosScreen.alertButton(promptOver(['Don’t Allow', 'Allow'], 'com.example.app'), 'allow'),
    ).toBeUndefined();
  });

  it('reads what is inside the alert, and nothing without one', () => {
    const tree = { windows: [], nodes: [] } as unknown as Tree;
    expect(iosScreen.systemAlert(tree, promptOver(['Allow']))).toEqual({
      texts: [],
      buttons: [{ label: 'Allow', x: 200, y: 422 }],
    });
    expect(iosScreen.systemAlert(tree, [root])).toBeUndefined();
  });
});

describe('what the screen shows', () => {
  const nodes = (c: string) => ({ nodes: [{ c }] }) as unknown as Tree;

  it('has a keyboard when its element is up', () => {
    expect(iosScreen.keyboardOpen(nodes('Keyboard'))).toBe(true);
    expect(iosScreen.keyboardOpen(nodes('Button'))).toBe(false);
  });

  it('finds the keyboard by its element', () => {
    const open = { nodes: [{ c: 'Keyboard', b: [0, 590, 402, 816] }] } as unknown as Tree;
    expect(iosScreen.keyboardArea(open)).toEqual({ x: 0, y: 590, width: 402, height: 226 });
    expect(iosScreen.keyboardArea(nodes('Button'))).toBeUndefined();
  });

  it('leaves a status band as tall as it gets', () => {
    expect(iosScreen.statusBand(nodes('Button'))).toBe(64);
  });
});

describe('what a tester sees of a tree', () => {
  const ios = { port: iosScreen };
  const seen = (els: UiElement[]) =>
    screenElements(withStableRefs([root, ...els], ios), ios).map((e) => e.label || e.id);
  const bar = (height: number): UiElement => ({
    type: 'StatusBar',
    label: '12:00',
    ref: '@s',
    rect: { x: 0, y: 0, width: 402, height },
  });

  it('leaves out a root in the status bar band, and only there', () => {
    expect(seen([bar(50)])).toEqual([]);
    expect(seen([bar(51)])).toEqual(['12:00']);
  });

  it('lists an Other named only by its id', () => {
    const other: UiElement = {
      type: 'Other',
      identifier: 'card',
      ref: '@o',
      parent: 0,
      rect: { x: 10, y: 100, width: 200, height: 44 },
    };
    expect(seen([other])).toEqual(['card']);
  });

  it('takes the width of a bar for the screen when no root tells it', () => {
    const offset: UiElement = { ...root, rect: { x: 50, y: 0, width: 300, height: 874 } };
    const nav: UiElement = {
      type: 'NavigationBar',
      ref: '@n',
      parent: 0,
      rect: { x: 0, y: 40, width: 402, height: 44 },
    };
    expect(windowRect([offset, nav], iosScreen)).toEqual({
      x: 0,
      y: -1e9,
      width: 402,
      height: 2e9,
    });
    expect(windowRect([offset], iosScreen)).toBeUndefined();
  });

  it('has no navigation bar beside a window in landscape', () => {
    const wide: UiElement = { ...root, rect: { x: 60, y: 0, width: 800, height: 400 } };
    expect(windowRect([wide], iosScreen)).toBeUndefined();
  });
});

describe('what covers the app', () => {
  const bar = (y: number, x = 0): UiElement => ({
    type: 'NavigationBar',
    ref: `@n${y}`,
    parent: 0,
    rect: { x, y, width: 402, height: 54 },
  });

  it('is the status bar, above the navigation bar at the top, and no bar further down', () => {
    expect(iosScreen.appTop?.([root, bar(62)])).toBe(62);
    // landscape hides the status bar; a sheet's bar, or one beside a sidebar, says nothing of it
    expect(iosScreen.appTop?.([root, bar(0)])).toBeUndefined();
    expect(iosScreen.appTop?.([root, bar(300)])).toBeUndefined();
    expect(iosScreen.appTop?.([root, bar(62, 320)])).toBeUndefined();
  });

  it('is the keyboard, in the windows past the first that hold it', () => {
    const t = JSON.parse(
      readFileSync(join(import.meta.dirname, 'fixtures/ios-screens/form-number-pad.json'), 'utf8'),
    ) as Tree;
    const els = t.nodes.map((n, i): UiElement => ({
      type: n.c,
      ...(n.d && { label: n.d }),
      ...(n.id && { identifier: n.id }),
      ref: `@n${i}`,
      rect: { x: n.b[0], y: n.b[1], width: n.b[2] - n.b[0], height: n.b[3] - n.b[1] },
      ...(n.p >= 0 && { parent: n.p }),
    }));
    // the app's own bar above the keys, in the window that holds them, as a Done over a number pad
    els.push({
      type: 'Button',
      label: 'Done',
      ref: '@done',
      parent: 9,
      clickable: true,
      rect: { x: 330, y: 528, width: 60, height: 40 },
    });
    const listed = screenElements(els, { port: iosScreen }).map((e) => e.label || e.id || '');
    expect(listed).toContain('Send');
    expect(listed).toContain('Done');
    expect(listed.filter((l) => /^\d$|Delete|Dictate|inputView|LayoutStar/.test(l))).toEqual([]);
  });
});
