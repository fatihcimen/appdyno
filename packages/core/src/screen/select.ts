import type { Tree } from '@appdyno/protocol';
import { alertButton } from './diff.js';
import type { UiElement } from './elements.js';
import { fold } from './fold.js';
import type { Platform, ScreenElement } from './model.js';

/** Names an element by what it shows instead of where it is. `index` picks one of several matches. */
export type Selector = { text?: string; id?: string; role?: string; index?: number };

const bareId = (id: string) => id.replace(/^.*:id\//, '');

/** The elements a selector names; where some match the text exactly, only those. */
export function selectIn(list: ScreenElement[], sel: Selector): ScreenElement[] {
  const w = sel.text && fold(sel.text);
  const role = sel.role && fold(sel.role);
  const id = sel.id && bareId(sel.id);
  const hits = list.filter(
    (e) =>
      (!w || fold(e.label).includes(w)) && (!id || e.id === id) && (!role || fold(e.role) === role),
  );
  const exact = w ? hits.filter((e) => fold(e.label) === w) : hits;
  return exact.length > 0 ? exact : hits;
}

const pairs = (s: string) => {
  const f = fold(s);
  return new Set(Array.from(f, (c, i) => c + (f[i + 1] ?? '')));
};

/** The elements most like the wanted text (shared letter pairs), for a refusal to offer. */
export function nearest(list: ScreenElement[], want: string | undefined, n = 5): ScreenElement[] {
  const named = list.filter((e) => e.label || e.id);
  if (!want) return named.slice(0, n);
  const a = pairs(want);
  const like = (name: string) => {
    const b = pairs(name);
    return ([...a].filter((p) => b.has(p)).length * 2) / (a.size + b.size || 1);
  };
  const score = (e: ScreenElement) => Math.max(like(e.label), like(e.id ?? ''));
  return named
    .map((e) => ({ e, s: score(e) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, n)
    .map((x) => x.e);
}

/** What `find` reports and `assert` checks of an element, beyond its place on the list. */
export type Attributes = {
  /** The whole text (a list's label is cut short). */
  text: string;
  enabled: boolean;
  checked: boolean;
  focused: boolean;
  /** What a field, slider or switch holds. */
  value?: string;
  bounds: { x: number; y: number; w: number; h: number };
};

export function attributesOf(elements: UiElement[], e: ScreenElement): Attributes {
  const el = elements.find((x) => x.ref === e.ref);
  const holds = /textField|slider|switch|checkbox|radio/.test(e.role);
  return {
    text: el?.text || el?.label || e.label,
    enabled: el?.enabled !== false,
    checked: !!el?.checked,
    focused: !!el?.focused,
    ...(holds && el?.text && !el.password && { value: el.text }),
    bounds: { x: e.rect.x, y: e.rect.y, w: e.rect.width, h: e.rect.height },
  };
}

export type AlertButton = { label: string; x: number; y: number };
export type SystemAlert = {
  /** Its title and message. */
  texts: string[];
  buttons: AlertButton[];
};

const ANDROID_SYSTEM_DIALOGS =
  /^(android|com\.(google\.)?android\.(permissioncontroller|packageinstaller))$/;
const INPUT_METHOD = 2;
const SYSTEM = 3;
const SYSTEM_UI = 'com.android.systemui';

/**
 * The system alert on the screen, whatever it asks: Android's system windows and its permission and
 * chooser dialogs, iOS's alerts of the home screen app. A dialog of an app, the app under test's or any
 * other, is the app's own and is not one.
 */
export function systemAlert(
  tree: Tree,
  elements: UiElement[],
  platform: Platform,
): SystemAlert | undefined {
  let inside: UiElement[];
  if (platform === 'android') {
    const pkgs = new Set(
      tree.windows
        .filter(
          (w) =>
            w.pkg &&
            w.pkg !== SYSTEM_UI &&
            (w.type === SYSTEM || ANDROID_SYSTEM_DIALOGS.test(w.pkg)),
        )
        .map((w) => w.pkg!),
    );
    inside = elements.filter((e) => e.pkg && pkgs.has(e.pkg));
  } else {
    const root = elements.findIndex(
      (e) => /alert$/i.test(e.type) && e.pkg === 'com.apple.springboard',
    );
    if (root < 0) return undefined;
    const under = (i: number) => {
      for (let q = elements[i]!.parent; q !== undefined; q = elements[q]!.parent)
        if (q === root) return true;
      return false;
    };
    inside = elements.filter((_, i) => under(i));
  }
  const at = (e: UiElement) => ({
    x: Math.round(e.rect!.x + e.rect!.width / 2),
    y: Math.round(e.rect!.y + e.rect!.height / 2),
  });
  const words = (e: UiElement) => (e.label || e.text || '').trim();
  const pressable = (e: UiElement) => (platform === 'ios' ? /button$/i.test(e.type) : e.clickable);
  const buttons = inside
    .filter((e) => e.rect && e.visible !== false && pressable(e) && words(e))
    .map((e) => ({ label: words(e), ...at(e) }));
  const texts = [
    ...new Set(inside.filter((e) => e.visible !== false && !pressable(e) && words(e)).map(words)),
  ];
  return buttons.length > 0 || texts.length > 0 ? { texts, buttons } : undefined;
}

/** The button of an open alert an answer names: `allow`, `deny` (in the device's language) or its label. */
export function alertAnswer(
  alert: SystemAlert,
  elements: UiElement[],
  platform: Platform,
  answer: string,
): { hit?: AlertButton; many?: string[] } {
  const asked = answer.toLowerCase();
  if (asked === 'allow' || asked === 'deny') {
    const hit = alertButton(elements, platform, asked);
    if (hit) return { hit };
  }
  const w = fold(answer);
  const exact = alert.buttons.filter((b) => fold(b.label) === w);
  const hits = exact.length > 0 ? exact : alert.buttons.filter((b) => fold(b.label).includes(w));
  if (hits.length === 1) return { hit: hits[0]! };
  return hits.length > 1 ? { many: hits.map((b) => b.label) } : {};
}

/** Whether a keyboard is on the screen: an input method window (Android), its element (iOS). */
export const keyboardOpen = (tree: Tree, platform: Platform) =>
  platform === 'android'
    ? tree.windows.some((w) => w.type === INPUT_METHOD)
    : tree.nodes.some((n) => /keyboard$/i.test(n.c));
