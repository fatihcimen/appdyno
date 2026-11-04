import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildScreen,
  elementsOf,
  screenElements,
  windowRect,
  withStableRefs,
  type UiElement,
} from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
import { wireTree } from '../../core/test/fake-agent.js';
import { androidScreen } from '../src/platform-screen.js';

const window = (type: number, b: [number, number, number, number], pkg = 'dev.app') => ({
  type,
  pkg,
  layer: 1,
  b,
  active: true,
  focused: true,
});
const treeOf = (windows: Tree['windows']): Tree => ({
  windows,
  nodes: [],
  truncated: false,
  elapsedMs: 1,
  hash: 'h',
});

describe('system alerts', () => {
  it('finds the permission controller by its id, in any language', () => {
    const allow: UiElement = {
      type: 'android.widget.Button',
      ref: '@e5',
      identifier: 'com.google.android.permissioncontroller:id/permission_allow_button',
      text: 'İzin ver',
      rect: { x: 100, y: 1000, width: 800, height: 100 },
    };
    expect(androidScreen.alertButton([allow], 'allow')).toEqual({
      label: 'İzin ver',
      x: 500,
      y: 1050,
    });
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
      androidScreen.alertButton([win, btn('android:id/button1', 'TAMAM')], 'allow'),
    ).toBeUndefined();
    expect(
      androidScreen.alertButton([win, btn('com.example:id/button1', 'İzin ver')], 'allow'),
    ).toBeUndefined();
    expect(
      androidScreen.alertButton(
        [win, btn('com.android.permissioncontroller:id/permission_deny_button', 'İzin verme')],
        'deny',
      ),
    ).toMatchObject({ label: 'İzin verme' });
  });

  it('reads the system dialog, leaving the app and the system bars out', () => {
    const tree = treeOf([
      window(1, [0, 0, 1080, 2400]),
      window(3, [0, 0, 1080, 80], 'com.android.systemui'),
      window(1, [0, 800, 1080, 1600], 'com.android.permissioncontroller'),
    ]);
    const el = (pkg: string, text: string, clickable: boolean): UiElement => ({
      type: 'android.widget.TextView',
      ref: `@${text}`,
      pkg,
      text,
      clickable,
      rect: { x: 0, y: 1000, width: 200, height: 100 },
    });
    expect(
      androidScreen.systemAlert(tree, [
        el('dev.app', 'mine', false),
        el('com.android.systemui', '12:00', false),
        el('com.android.permissioncontroller', 'Konum?', false),
        el('com.android.permissioncontroller', 'İzin ver', true),
      ]),
    ).toEqual({ texts: ['Konum?'], buttons: [{ label: 'İzin ver', x: 100, y: 1050 }] });
    expect(androidScreen.systemAlert(treeOf([window(1, [0, 0, 1080, 2400])]), [])).toBeUndefined();
  });

  it("leaves out a system window with no focus: a Samsung's edge panel handle, always there", () => {
    const { windows } = JSON.parse(
      readFileSync(join(import.meta.dirname, 'fixtures/install/samsung-warning.json'), 'utf8'),
    ) as Tree;
    const handle: UiElement = {
      type: 'android.widget.FrameLayout',
      ref: '@h',
      pkg: 'com.sec.android.app.launcher',
      label: 'Edge panels',
      rect: { x: 1038, y: 458, width: 42, height: 342 },
    };
    expect(androidScreen.systemAlert(treeOf(windows), [handle])).toBeUndefined();
    const focused = window(3, [100, 800, 980, 1400], 'com.example.maker.dialog');
    const asks = { ...handle, pkg: focused.pkg, label: 'Allow it?' };
    expect(androidScreen.systemAlert(treeOf([focused]), [asks])?.texts).toEqual(['Allow it?']);
  });
});

describe('what wants a person', () => {
  /** Nodes of a focused window of `pkg`, by their ids, as an emulator's prompts had them. */
  const prompt = (pkg: string, ids: string[], texts: string[] = []) => {
    const tree: Tree = {
      ...treeOf([{ ...window(3, [0, 0, 1080, 2400], pkg) }]),
      nodes: [
        ...ids.map((id) => ({ p: -1, w: 0, c: 'android.view.View', id, b: [0, 0, 9, 9], f: 17 })),
        ...texts.map((t) => ({
          p: -1,
          w: 0,
          c: 'android.widget.TextView',
          t,
          b: [0, 0, 9, 9],
          f: 17,
        })),
      ] as Tree['nodes'],
    };
    return androidScreen.personPrompt(tree, elementsOf(tree));
  };

  it('a fingerprint or a face, by the system prompt in any language', () => {
    const ids = ['biometric_scrollview', 'biometric_icon'].map(
      (n) => `com.android.systemui:id/${n}`,
    );
    expect(prompt('com.android.systemui', ids)).toBe('a fingerprint or a face');
  });

  it('a credential first, as its page has a biometric id too', () => {
    const ids = ['biometric_scrollview', 'lockPassword'].map((n) => `com.android.systemui:id/${n}`);
    expect(prompt('com.android.systemui', ids)).toBe('a passcode');
    expect(prompt('com.android.settings', ['com.android.settings:id/password_entry'])).toBe(
      'a passcode',
    );
  });

  it('none on a page of the permission controller, whatever its words', () => {
    const pkg = 'com.google.android.permissioncontroller';
    expect(prompt(pkg, [], ['Set a screen lock password'])).toBeUndefined();
  });

  it('what a system alert asks, by its words', () => {
    expect(prompt('android', [], ['Enter the password'])).toBe('a passcode');
  });
});

describe('what the screen shows', () => {
  it('has a keyboard when an input method window is up', () => {
    expect(androidScreen.keyboardOpen(treeOf([window(1, [0, 0, 1080, 2400])]))).toBe(false);
    expect(androidScreen.keyboardOpen(treeOf([window(2, [0, 1600, 1080, 2400])]))).toBe(true);
  });

  it('takes the first app window that leaves room for the status bar, else a tall one by density', () => {
    expect(androidScreen.statusBand(treeOf([window(1, [0, 96, 1080, 2400])]), 420)).toBe(96);
    expect(androidScreen.statusBand(treeOf([window(1, [0, 0, 1080, 2400])]), 320)).toBe(112);
    expect(androidScreen.statusBand(treeOf([]))).toBe(56);
  });
});

describe('what a tester sees of a tree', () => {
  const app = { port: androidScreen, appId: 'dev.app' };
  const root: UiElement = {
    type: 'android.widget.FrameLayout',
    ref: 'n0',
    pkg: 'dev.app',
    rect: { x: 0, y: 0, width: 1080, height: 2400 },
  };
  const node = (text: string, identifier: string, over: Partial<UiElement> = {}): UiElement => ({
    type: 'android.widget.TextView',
    text,
    identifier,
    ref: `n-${text}`,
    parent: 0,
    pkg: identifier.split(':')[0]!,
    rect: { x: 0, y: 100, width: 500, height: 100 },
    ...over,
  });
  const seen = (els: UiElement[], opts: Parameters<typeof screenElements>[1] = app) =>
    screenElements(withStableRefs([root, ...els], opts), opts).map((e) => e.label);

  it("leaves out the system UI's nodes, and another app's while the app is in front", () => {
    const clock = node('12:00', 'com.android.systemui:id/clock');
    const other = node('reklam', 'other.app:id/ad');
    expect(seen([clock, other, node('kendi', 'dev.app:id/own')])).toEqual(['kendi']);
    // an app not on the screen has nothing to keep apart from
    expect(seen([clock, other], { port: androidScreen, appId: 'not.here' })).toEqual(['reklam']);
  });

  it("keeps the framework's nodes, a system dialog's and a prompt's", () => {
    expect(seen([node('Tamam', 'android:id/button1')])).toEqual(['Tamam']);
    const dialog = node('İzin', 'other.app:id/allow', {
      pkg: 'com.google.android.permissioncontroller',
    });
    expect(seen([dialog])).toEqual(['İzin']);
    const prompt = node('Parmak', 'com.android.systemui:id/title', { prompt: true });
    expect(seen([prompt])).toEqual(['Parmak']);
  });

  it("keeps the app's node inside another's, and none inside the system UI", () => {
    const host = node('reklam', 'other.app:id/ad', { ref: 'n1' });
    const own = node('kendi', 'dev.app:id/own', { parent: 1 });
    expect(seen([host, own])).toEqual(['kendi']);
    const bar = node('saat', 'com.android.systemui:id/bar', { ref: 'n1' });
    expect(seen([bar, own])).toEqual([]);
  });

  it('does not list a nameless Other by its id', () => {
    const other = node('', 'dev.app:id/card', { type: 'Other' });
    expect(seen([other])).toEqual([]);
  });

  it('takes a wide root beside a navigation bar for the window, and no bar for one', () => {
    const wide: UiElement = { ...root, rect: { x: 128, y: 0, width: 2272, height: 1080 } };
    expect(windowRect([wide], androidScreen)).toEqual(wide.rect);
    const tall: UiElement = { ...root, rect: { x: 50, y: 0, width: 300, height: 874 } };
    const nav: UiElement = {
      type: 'NavigationBar',
      ref: 'n1',
      parent: 0,
      rect: { x: 0, y: 40, width: 402, height: 44 },
    };
    expect(windowRect([tall, nav], androidScreen)).toBeUndefined();
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
    const s = buildScreen(tree, { port: androidScreen, appId: 'dev.app' });
    expect(s.foreground).toBe('com.google.android.permissioncontroller');
    expect(s.list.map((e) => e.label)).toContain('İzin ver');
  });

  it('keeps a system UI window that holds the focus: a biometric prompt is on the screen', () => {
    const tree = wireTree([]);
    tree.windows = [
      {
        type: 3,
        pkg: 'com.android.systemui',
        layer: 1,
        b: [0, 0, 1080, 2400],
        active: true,
        focused: true,
      },
    ];
    tree.nodes = [
      { p: -1, w: 0, c: 'android.widget.FrameLayout', b: [0, 0, 1080, 2400], f: 1 },
      {
        p: 0,
        w: 0,
        c: 'android.widget.TextView',
        id: 'com.android.systemui:id/title',
        t: 'Fixture sign-in',
        b: [100, 1500, 980, 1600],
        f: 1,
      },
      {
        p: 0,
        w: 0,
        c: 'android.widget.Button',
        id: 'com.android.systemui:id/button_negative',
        t: 'Cancel',
        b: [100, 2000, 400, 2100],
        f: 1 | 2 | 16,
      },
    ];
    const s = buildScreen(tree, { port: androidScreen, appId: 'dev.app' });
    expect(s.list.map((e) => e.label)).toEqual(['Fixture sign-in', 'Cancel']);
  });

  it('knows the screen in landscape, the app window beside a navigation bar on the left', () => {
    const tree = wireTree([], {
      windows: [
        { type: 1, pkg: 'dev.app', layer: 1, b: [128, 0, 2400, 1080], active: true, focused: true },
      ],
    });
    tree.nodes[0]!.b = [128, 0, 2400, 1080];
    expect(buildScreen(tree, { port: androidScreen }).window).toEqual({ w: 2400, h: 1080 });
  });
});
