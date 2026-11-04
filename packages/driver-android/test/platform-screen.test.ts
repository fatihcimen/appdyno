import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { screenElements, windowRect, withStableRefs, type UiElement } from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
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
  const app = { platform: 'android' as const, appId: 'dev.app' };
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
    expect(seen([clock, other], { platform: 'android', appId: 'not.here' })).toEqual(['reklam']);
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
    expect(windowRect([wide], 'android')).toEqual(wide.rect);
    const tall: UiElement = { ...root, rect: { x: 50, y: 0, width: 300, height: 874 } };
    const nav: UiElement = {
      type: 'NavigationBar',
      ref: 'n1',
      parent: 0,
      rect: { x: 0, y: 40, width: 402, height: 44 },
    };
    expect(windowRect([tall, nav], 'android')).toBeUndefined();
  });
});
