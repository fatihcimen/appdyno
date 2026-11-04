import type { UiElement } from './elements.js';
import { fold } from './fold.js';

export type AlertAction = 'allow' | 'deny';

/**
 * The words of a system prompt's allow and deny buttons (the device's language), matched on the label
 * as `fold` gives it. Without a match a driver picks the button by its place in the prompt.
 */
export type AlertWords = { allow: RegExp; deny: RegExp };

export type AlertButton = { label: string; x: number; y: number };

export type SystemAlert = {
  /** Its title and message. */
  texts: string[];
  buttons: AlertButton[];
};

const centreOf = (e: UiElement) => ({
  x: Math.round(e.rect!.x + e.rect!.width / 2),
  y: Math.round(e.rect!.y + e.rect!.height / 2),
});

/** A permission prompt's button, to tap. */
export const alertButtonOf = (e: UiElement | undefined): AlertButton | undefined =>
  e?.rect && { label: (e.label || e.text || e.name || '').trim(), ...centreOf(e) };

/** An alert from the elements inside it: what can be pressed is its buttons, the rest its words. */
export function alertOf(
  inside: UiElement[],
  pressable: (e: UiElement) => boolean,
): SystemAlert | undefined {
  const words = (e: UiElement) => (e.label || e.text || '').trim();
  const buttons = inside
    .filter((e) => e.rect && e.visible !== false && pressable(e) && words(e))
    .map((e) => ({ label: words(e), ...centreOf(e) }));
  const texts = [
    ...new Set(inside.filter((e) => e.visible !== false && !pressable(e) && words(e)).map(words)),
  ];
  return buttons.length > 0 || texts.length > 0 ? { texts, buttons } : undefined;
}

/** What an alert asks that only a person can give, by the words on it, as `fold` gives them. */
const FOR_A_PERSON: [string, RegExp][] = [
  ['Face ID', /face id/],
  ['Touch ID', /touch id|parmak izi/],
  ['a fingerprint', /fingerprint/],
  ['a passcode', /passcode|password|sifre|parola/],
  ['an Apple Account', /apple (account|id|hesab)/],
  ['Allow Paste', /allow paste|would like to paste/],
  ['a VPN', /\bvpn\b/],
  ['a profile', /configuration profile|install profile/],
  ['a purchase', /purchase|satin al/],
];

/** What this alert wants of a person, if it wants one. */
export function personNeeded(alert: SystemAlert | undefined): string | undefined {
  const words = fold(
    [...(alert?.texts ?? []), ...(alert?.buttons ?? []).map((b) => b.label)].join(' '),
  );
  return FOR_A_PERSON.find(([, match]) => match.test(words))?.[0];
}

/** The button of an open alert an answer names: `allow`, `deny` (in the device's language) or its label. */
export function alertAnswer(
  alert: SystemAlert,
  promptButton: (action: AlertAction) => AlertButton | undefined,
  answer: string,
): { hit?: AlertButton; many?: string[] } {
  const asked = answer.toLowerCase();
  if (asked === 'allow' || asked === 'deny') {
    const hit = promptButton(asked);
    if (hit) return { hit };
  }
  const w = fold(answer);
  const exact = alert.buttons.filter((b) => fold(b.label) === w);
  const hits = exact.length > 0 ? exact : alert.buttons.filter((b) => fold(b.label).includes(w));
  if (hits.length === 1) return { hit: hits[0]! };
  return hits.length > 1 ? { many: hits.map((b) => b.label) } : {};
}
