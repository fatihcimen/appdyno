import { describe, expect, it } from 'vitest';
import type { UiElement } from '@appdyno/core';
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
